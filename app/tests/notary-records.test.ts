import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { assetEncumbrance, auditLog, territory } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { LocalFileStorage } from "@/platform/storage";
import { createAsset } from "@/modules/assets";
import { createParty } from "@/modules/directory";
import { createDocument, listDocumentCategories } from "@/modules/documents";
import { addEncumbrance, addProvenance, buildNotarySheet, getNotarySheet, listEncumbrances, listProvenances, removeEncumbrance, removeProvenance, type SheetInput } from "@/modules/notary";
import { importIstat } from "@/modules/territory";
import messages from "../messages/it.json";
import { conclusiveClaims } from "./helpers/neutral";
import { createTestDb, type TestDb } from "./helpers/test-db";
import { makePdf } from "./helpers/sample-pdf";

const actor = { type: "owner", id: "o1" } as const;
const owner = { displayName: "Proprietario Prova", email: "prova@example.test" };
const TODAY = "2026-06-15";
const MISSING = "00000000-0000-4000-8000-000000000000";

const base = (): SheetInput => ({
  today: TODAY,
  asset: { id: "a1", kind: "dwelling", name: "Casa", territoryLabel: "Comune", locality: null, address: "Via Prova 1", postalCode: null, useType: null, inCondominium: false, notes: null, rights: [], cadastral: [], attributes: {} },
  parties: [],
  documents: [],
  categories: [{ id: "c1", code: "title_deed", name: "Titolo" }],
  dossierItems: [],
  related: [],
});

describe("scheda per il notaio: provenienza e gravami registrati (calcolo)", () => {
  it("una provenienza registrata toglie la lacuna «provenienza non risulta» e segnala quella senza documento", () => {
    expect(buildNotarySheet(base()).gaps.map((g) => g.code)).toContain("provenanceNotRegistered");
    const input = { ...base(), provenances: [{ id: "p1", kind: "purchase", occurredOn: "2010-05-01", fromName: null, notaryName: null, deedReference: null, documentId: null, documentTitle: null, note: null }] };
    const codes = buildNotarySheet(input).gaps.map((g) => g.code);
    expect(codes).not.toContain("provenanceNotRegistered");
    expect(buildNotarySheet(input).gaps).toContainEqual({ code: "provenanceNoDocument", params: { count: 1 } });
  });

  it("i gravami registrati hanno la precedenza sulla ricerca per parola, che resta solo per i documenti non collegati", () => {
    const input: SheetInput = {
      ...base(),
      documents: [
        { id: "d1", title: "Nota di ipoteca", categoryId: "c1", issuedOn: null, validTo: null, verificationStatus: "verified_by_owner" },
        { id: "d2", title: "Atto di servitù", categoryId: "c1", issuedOn: null, validTo: null, verificationStatus: "verified_by_owner" },
      ],
      encumbranceRecords: [{ id: "e1", kind: "mortgage", title: "Ipoteca volontaria", registeredOn: "2015-01-01", endedOn: null, beneficiaryName: "Banca", amountCents: 10_000_000, reference: null, documentId: "d1", documentTitle: "Nota di ipoteca", note: null }],
    };
    const sheet = buildNotarySheet(input);
    expect(sheet.encumbranceRecords).toHaveLength(1);
    expect(sheet.encumbrances.map((e) => e.title)).toEqual(["Atto di servitù"]);
    expect(sheet.gaps.map((g) => g.code)).not.toContain("encumbranceNoDocument");
    expect(buildNotarySheet({ ...input, encumbranceRecords: [{ ...input.encumbranceRecords![0]!, documentId: null, documentTitle: null }] }).gaps).toContainEqual({ code: "encumbranceNoDocument", params: { count: 1 } });
  });

  it("i testi nuovi non affermano nulla di conclusivo", () => {
    expect(conclusiveClaims(JSON.stringify(messages.notaio.provenance) + JSON.stringify(messages.notaio.encumbrances))).toEqual([]);
  });
});

describe("scheda per il notaio: provenienza e gravami registrati (dati)", () => {
  let t: TestDb;
  let dir: string;
  let storage: LocalFileStorage;
  let assetId: string;
  let sellerId: string;
  let notaryId: string;
  let bankId: string;
  let docId: string;
  const run = <T>(work: Parameters<typeof runInUnitOfWork<T>>[2]) => runInUnitOfWork(t.db, actor, work);
  const okValue = <V>(r: { ok: boolean; value?: V }): V => {
    if (!r.ok) throw new Error(`atteso successo: ${JSON.stringify(r)}`);
    return r.value as V;
  };

  beforeAll(async () => {
    t = await createTestDb();
    dir = await mkdtemp(join(tmpdir(), "notary-records-"));
    storage = new LocalFileStorage(dir);
    await run((uow) => importIstat(uow, [{ regionCode: "90", regionName: "Regione di prova", provinceCode: "900", provinceName: "Provincia di prova", provinceSigla: "PP", municipalityCode: "900001", municipalityName: "Comune Uno", cadastralCode: "Z101" }]));
    const municipalityId = (await t.db.select().from(territory).where(eq(territory.kind, "municipality")))[0]!.id;
    assetId = okValue(await run((uow) => createAsset(uow, owner, { kind: "dwelling", name: "Casa Notaio", territoryId: municipalityId, address: "Via Prova 1" }))).id;
    sellerId = okValue(await run((uow) => createParty(uow, { displayName: "Venditore Esempio" }))).id;
    notaryId = okValue(await run((uow) => createParty(uow, { displayName: "Notaio Esempio", roles: ["notary"] }))).id;
    bankId = okValue(await run((uow) => createParty(uow, { displayName: "Banca Esempio" }))).id;
    const categoryId = (await listDocumentCategories(t.db))[0]!.id;
    docId = okValue(await run((uow) => createDocument(uow, { title: "Atto di acquisto", categoryId }, { name: "atto.pdf", bytes: makePdf("atto") }, storage))).id;
  }, 60_000);
  afterAll(async () => {
    await t.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("registra e toglie titoli di provenienza con le parti dalla rubrica; l'audit non riporta i valori", async () => {
    expect(await run((uow) => addProvenance(uow, { assetId, kind: "boh" }))).toMatchObject({ ok: false, errors: { kind: expect.any(Array) } });
    expect(await run((uow) => addProvenance(uow, { assetId: MISSING, kind: "purchase" }))).toMatchObject({ ok: false, errors: { assetId: expect.any(Array) } });
    expect(await run((uow) => addProvenance(uow, { assetId, kind: "purchase", fromPartyId: MISSING }))).toMatchObject({ ok: false, errors: { partyId: expect.any(Array) } });
    expect(await run((uow) => addProvenance(uow, { assetId, kind: "purchase", documentId: MISSING }))).toMatchObject({ ok: false, errors: { documentId: expect.any(Array) } });

    okValue(await run((uow) => addProvenance(uow, { assetId, kind: "purchase", occurredOn: "2012-03-04", fromPartyId: sellerId, notaryPartyId: notaryId, deedReference: "REP-SEGRETO-99", documentId: docId, note: "Nota riservata" })));
    const [p] = await listProvenances(t.db, assetId);
    expect(p).toMatchObject({ kind: "purchase", occurredOn: "2012-03-04", fromName: "Venditore Esempio", notaryName: "Notaio Esempio", documentTitle: "Atto di acquisto", deedReference: "REP-SEGRETO-99" });

    const audits = await t.db.select().from(auditLog).where(eq(auditLog.entityId, assetId));
    expect(audits.some((a) => a.action === "notary.provenance.add")).toBe(true);
    expect(JSON.stringify(audits.map((a) => a.diff))).not.toMatch(/SEGRETO|riservata/);

    expect(await run((uow) => removeProvenance(uow, p!.id))).toMatchObject({ ok: true });
    expect(await run((uow) => removeProvenance(uow, p!.id))).toMatchObject({ ok: false });
    expect(await listProvenances(t.db, assetId)).toEqual([]);
  });

  it("registra gravami con tipo, date coerenti, importo non negativo e documento; li usa la scheda del notaio al posto della ricerca per parola", async () => {
    expect(await run((uow) => addEncumbrance(uow, { assetId, kind: "mortgage", title: "  " }))).toMatchObject({ ok: false, errors: { title: expect.any(Array) } });
    expect(await run((uow) => addEncumbrance(uow, { assetId, kind: "ipoteca", title: "X" }))).toMatchObject({ ok: false, errors: { kind: expect.any(Array) } });
    expect(await run((uow) => addEncumbrance(uow, { assetId, kind: "mortgage", title: "X", registeredOn: "2020-01-01", endedOn: "2019-01-01" }))).toMatchObject({ ok: false, errors: { endedOn: expect.any(Array) } });
    expect(await run((uow) => addEncumbrance(uow, { assetId, kind: "mortgage", title: "X", amount: "-5" }))).toMatchObject({ ok: false, errors: { amount: expect.any(Array) } });
    expect(await run((uow) => addEncumbrance(uow, { assetId, kind: "mortgage", title: "X", beneficiaryPartyId: MISSING }))).toMatchObject({ ok: false });
    await expect(t.db.insert(assetEncumbrance).values({ assetId, kind: "mortgage", title: "X", amountCents: -1 })).rejects.toThrow();

    okValue(await run((uow) => addEncumbrance(uow, { assetId, kind: "mortgage", title: "Ipoteca volontaria", registeredOn: "2015-01-01", beneficiaryPartyId: bankId, amount: "100.000,00", reference: "NOTA-SEGRETA-1", documentId: docId })));
    okValue(await run((uow) => addEncumbrance(uow, { assetId, kind: "easement", title: "Servitù di passaggio" })));
    const list = await listEncumbrances(t.db, assetId);
    expect(list.map((e) => [e.kind, e.title, e.beneficiaryName, e.amountCents, e.documentTitle])).toEqual([
      ["mortgage", "Ipoteca volontaria", "Banca Esempio", 10_000_000, "Atto di acquisto"],
      ["easement", "Servitù di passaggio", null, null, null],
    ]);

    const sheet = (await getNotarySheet(t.db, assetId, { today: TODAY }))!;
    expect(sheet.encumbranceRecords.map((e) => e.title)).toEqual(["Ipoteca volontaria", "Servitù di passaggio"]);
    expect(sheet.gaps).toContainEqual({ code: "encumbranceNoDocument", params: { count: 1 } });

    const audits = await t.db.select().from(auditLog).where(eq(auditLog.entityId, assetId));
    expect(JSON.stringify(audits.map((a) => a.diff))).not.toContain("SEGRETA");

    expect(await run((uow) => removeEncumbrance(uow, list[1]!.id))).toMatchObject({ ok: true });
    expect(await run((uow) => removeEncumbrance(uow, MISSING))).toMatchObject({ ok: false });
    expect((await listEncumbrances(t.db, assetId)).map((e) => e.title)).toEqual(["Ipoteca volontaria"]);
  });
});
