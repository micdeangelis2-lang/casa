import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { territory } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { LocalFileStorage } from "@/platform/storage";
import { createAsset } from "@/modules/assets";
import { createDocument, listDocumentCategories } from "@/modules/documents";
import { createParty } from "@/modules/directory";
import { addManualItem, listDossierCategories } from "@/modules/dossier";
import { buildNotarySheet, getNotarySheet, mentionsEncumbrance, notaryPackageHref, sumQuotas, type SheetInput } from "@/modules/notary";
import { importIstat } from "@/modules/territory";
import { conclusiveClaims } from "./helpers/neutral";
import { createTestDb, type TestDb } from "./helpers/test-db";
import { makePdf } from "./helpers/sample-pdf";
import messages from "../messages/it.json";

const TODAY = "2026-06-15";

const base = (): SheetInput => ({
  today: TODAY,
  asset: { id: "a1", kind: "dwelling", name: "Casa", territoryLabel: "Comune", locality: null, address: "Via Prova 1", postalCode: null, useType: null, inCondominium: false, notes: null, rights: [], cadastral: [], attributes: {} },
  parties: [],
  documents: [],
  categories: [
    { id: "c1", code: "title_deed", name: "Titolo" },
    { id: "c2", code: "cadastral", name: "Catasto" },
    { id: "c3", code: "other", name: "Altro" },
  ],
  dossierItems: [],
  related: [],
});

describe("scheda per il notaio: calcolo", () => {
  it("somma le quote con frazioni esatte", () => {
    expect(sumQuotas([{ quotaNumerator: 1, quotaDenominator: 3 }, { quotaNumerator: 1, quotaDenominator: 6 }])).toEqual({ numerator: 1, denominator: 2 });
    expect(sumQuotas([{ quotaNumerator: 1, quotaDenominator: 2 }, { quotaNumerator: 1, quotaDenominator: 2 }])).toEqual({ numerator: 1, denominator: 1 });
  });

  it("riconosce le parole di ipoteche e vincoli anche con accenti", () => {
    expect(mentionsEncumbrance("Nota di Ipoteca volontaria")).toBe(true);
    expect(mentionsEncumbrance("Atto di servitù")).toBe(true);
    expect(mentionsEncumbrance("Planimetria")).toBe(false);
  });

  it("senza dati segnala le lacune e nessuna ipoteca", () => {
    const sheet = buildNotarySheet({ ...base(), asset: { ...base().asset, address: null } });
    const codes = sheet.gaps.map((g) => g.code);
    expect(codes).toEqual(expect.arrayContaining(["noAddress", "noRights", "noCadastral", "categoryEmpty", "provenanceNotRegistered"]));
    expect(sheet.encumbrances).toEqual([]);
    expect(sheet.documentGroups.map((g) => g.category.id)).toEqual(["c1", "c2"]);
  });

  it("quote parziali, dati dei titolari, storico catastale, documenti non verificati e scaduti", () => {
    const input = base();
    input.asset.rights = [
      { holder: { id: "p1", displayName: "Maria" }, rightType: "co_ownership", quotaNumerator: 1, quotaDenominator: 3, validFrom: null, validTo: null, notes: "Per successione" },
      { holder: { id: "p2", displayName: "Luca" }, rightType: "co_ownership", quotaNumerator: 1, quotaDenominator: 3, validFrom: null, validTo: null, notes: null },
      { holder: { id: "p3", displayName: "Ex" }, rightType: "co_ownership", quotaNumerator: 1, quotaDenominator: 3, validFrom: null, validTo: "2020-01-01", notes: null },
    ];
    input.parties = [{ id: "p1", displayName: "Maria", taxCode: "AAAAAA00A00A000A", address: "Via 1", pec: null, email: null, phone: null }];
    input.asset.cadastral = [
      { sheet: "5", parcel: "10", subunit: null, cadastralCategory: "A/2", cadastralClass: null, consistency: null, incomeCents: null, validFrom: "2019-01-01", validTo: null, notes: null },
      { sheet: "5", parcel: "10", subunit: "3", cadastralCategory: "A/3", cadastralClass: null, consistency: null, incomeCents: 10000, validFrom: "2010-01-01", validTo: "2018-12-31", notes: null },
    ];
    input.documents = [
      { id: "d1", title: "Atto", categoryId: "c1", issuedOn: null, validTo: null, verificationStatus: "to_verify" },
      { id: "d2", title: "Visura", categoryId: "c2", issuedOn: null, validTo: "2026-01-01", verificationStatus: "verified_by_owner" },
      { id: "d3", title: "Nota di ipoteca", categoryId: "c3", issuedOn: null, validTo: null, verificationStatus: "verified_by_owner" },
    ];
    input.dossierItems = [{ title: "Vincolo storico", categoryName: "Titolo", status: "missing", documentCount: 0 }];
    const sheet = buildNotarySheet(input);
    const byCode = (code: string) => sheet.gaps.filter((g) => g.code === code);

    expect(sheet.quotaTotals).toEqual([{ rightType: "co_ownership", numerator: 2, denominator: 3, whole: false }]);
    expect(byCode("quotaPartial")[0]!.params.sum).toBe("2/3");
    expect(byCode("holderDataMissing")).toEqual([{ code: "holderDataMissing", params: { name: "Luca", fields: "taxCode,address" } }]);
    expect(sheet.holders.map((h) => h.current)).toEqual([true, true, false]);
    expect(sheet.cadastralCurrent).toHaveLength(1);
    expect(sheet.cadastralHistory).toHaveLength(1);
    expect(byCode("cadastralIncomplete")[0]!.params.fields).toBe("subunit");
    expect(sheet.documentTotals).toEqual({ total: 3, unverified: 1, expired: 1 });
    expect(byCode("provenanceNotRegistered")).toHaveLength(0);
    expect(byCode("categoryEmpty")).toHaveLength(0);
    expect(sheet.encumbrances.map((e) => [e.source, e.title])).toEqual([["document", "Nota di ipoteca"], ["dossier", "Vincolo storico"]]);
    expect(sheet.dossierOpen).toHaveLength(1);
  });

  it("pertinenze senza titolari o catasto e categorie scelte dall'utente", () => {
    const input = { ...base(), focusCategoryIds: ["c3"], related: [{ id: "g1", name: "Box", kind: "box", direction: "linkedFrom" as const, declaredBasis: null, validationStatus: "declared", rightsCount: 0, currentCadastralCount: 0 }] };
    const sheet = buildNotarySheet(input);
    expect(sheet.gaps.filter((g) => g.code === "categoryEmpty").map((g) => g.params.name)).toEqual(["Altro"]);
    expect(sheet.gaps.map((g) => g.code)).toEqual(expect.arrayContaining(["relatedNoRights", "relatedNoCadastral"]));
  });

  it("il collegamento al pacchetto porta destinatario, livello, beni, categorie e contatto", () => {
    const href = notaryPackageHref({ assetIds: ["a", "b"], categoryIds: ["c"], contactId: "k" });
    const url = new URL(href, "http://x");
    expect(url.pathname).toBe("/condivisione/nuovo");
    expect(url.searchParams.getAll("immobile")).toEqual(["a", "b"]);
    expect(url.searchParams.get("destinatario")).toBe("notary");
    expect(url.searchParams.get("livello")).toBe("reserved");
    expect(url.searchParams.get("contatto")).toBe("k");
    expect(url.searchParams.get("mostra")).toBe("1");
  });

  it("i messaggi della scheda non suonano come un verdetto", () => {
    const found: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (typeof node === "string") conclusiveClaims(node).forEach((s) => found.push(`${path}: ${s}`));
      else if (node && typeof node === "object") Object.entries(node).forEach(([k, v]) => walk(v, `${path}.${k}`));
    };
    walk(messages.notaio, "notaio");
    expect(found).toEqual([]);
  });
});

describe("scheda per il notaio: dai moduli", () => {
  let t: TestDb;
  let dir: string;
  let storage: LocalFileStorage;
  const actor = { type: "owner", id: "o1" } as const;
  const owner = { displayName: "Proprietario Prova", email: "prova@example.test" };
  const run = <V>(work: Parameters<typeof runInUnitOfWork<V>>[2]) => runInUnitOfWork(t.db, actor, work);
  const okValue = <V>(r: { ok: boolean; value?: V }): V => {
    if (!r.ok) throw new Error(`atteso successo: ${JSON.stringify(r)}`);
    return r.value as V;
  };

  beforeAll(async () => {
    t = await createTestDb();
    dir = await mkdtemp(join(tmpdir(), "notary-test-"));
    storage = new LocalFileStorage(dir);
    await run((uow) => importIstat(uow, [{ regionCode: "90", regionName: "Regione di prova", provinceCode: "900", provinceName: "Provincia di prova", provinceSigla: "PP", municipalityCode: "900001", municipalityName: "Comune Uno", cadastralCode: "Z101" }]));
  }, 60_000);
  afterAll(async () => {
    await t.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("compone titolari, catasto, documenti, pertinenze e voci del dossier e non esiste per un bene inesistente", async () => {
    const municipalityId = (await t.db.select().from(territory).where(eq(territory.kind, "municipality")))[0]!.id;
    const partyId = okValue(await run((uow) => createParty(uow, { displayName: "Maria Rossi", taxCode: "RSSMRA80A41H501Z", address: "Via Roma 1" }))).id;
    const main = okValue(
      await run((uow) =>
        createAsset(uow, owner, {
          kind: "dwelling",
          name: "Appartamento Notaio",
          territoryId: municipalityId,
          address: "Via Prova 3",
          rights: [{ holder: { type: "party", partyId }, rightType: "co_ownership", quotaNumerator: 1, quotaDenominator: 2, notes: "Successione" }],
          cadastral: [{ sheet: "5", parcel: "120", subunit: "7", cadastralCategory: "A/2" }],
        }),
      ),
    ).id;
    const box = okValue(await run((uow) => createAsset(uow, owner, { kind: "box", name: "Box Notaio", territoryId: municipalityId, links: [{ mainAssetId: main, declaredBasis: "stesso atto" }] }))).id;

    const categories = await listDocumentCategories(t.db);
    const catId = (code: string) => categories.find((c) => c.code === code)!.id;
    okValue(await run((uow) => createDocument(uow, { title: "Atto di provenienza", categoryId: catId("title_deed"), assetIds: [main] }, { name: "atto.pdf", bytes: makePdf("atto") }, storage)));
    okValue(await run((uow) => createDocument(uow, { title: "Nota ipoteca", categoryId: catId("other"), assetIds: [main] }, { name: "ip.pdf", bytes: makePdf("ipoteca") }, storage)));
    const dossierCat = (await listDossierCategories(t.db))[0]!.id;
    okValue(await run((uow) => addManualItem(uow, main, { categoryId: dossierCat, title: "Vincolo da cercare" })));

    const sheet = (await getNotarySheet(t.db, main, { today: TODAY }))!;
    expect(sheet.asset.name).toBe("Appartamento Notaio");
    expect(sheet.holders[0]!.party).toMatchObject({ taxCode: "RSSMRA80A41H501Z", address: "Via Roma 1" });
    expect(sheet.cadastralCurrent).toHaveLength(1);
    expect(sheet.related.map((r) => [r.name, r.direction, r.rightsCount])).toEqual([["Box Notaio", "linkedFrom", 0]]);
    expect(sheet.encumbrances.map((e) => e.title).sort()).toEqual(["Nota ipoteca", "Vincolo da cercare"]);
    const codes = sheet.gaps.map((g) => g.code);
    expect(codes).toContain("quotaPartial");
    expect(codes).toContain("relatedNoRights");
    expect(codes).not.toContain("provenanceNotRegistered");
    expect(codes).toContain("documentsToVerify");
    expect(sheet.dossierOpen).toHaveLength(1);

    const boxSheet = (await getNotarySheet(t.db, box, { today: TODAY }))!;
    expect(boxSheet.related.map((r) => [r.name, r.direction])).toEqual([["Appartamento Notaio", "linkedTo"]]);
    expect(await getNotarySheet(t.db, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});
