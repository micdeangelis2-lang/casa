import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc } from "drizzle-orm";
import { auditLog } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { createParty, listParties, validatePartyInput } from "@/modules/directory";
import { listAssets, getAssetDetail, validateAssetInput } from "@/modules/assets";
import { fail } from "@/shared/result";
import { importIstat } from "@/modules/territory";
import { importTemplate, previewImport, runImport, type ImportKind, type ImportLabels } from "@/modules/import";
import { ImportAbort, executeImport } from "@/modules/import/application/run";
import type { ImportPorts } from "@/modules/import/application/ports";
import { parseQuota } from "@/modules/import/domain/quota";
import { parseCsv } from "@/modules/import/domain/csv-reader";
import { CONTACT_COLUMNS, contactDuplicateReason, contactKeys } from "@/modules/import/domain/contacts";
import { assetErrorColumn } from "@/modules/import/domain/assets";
import { IMPORT_KINDS, mapColumns } from "@/modules/import/domain/columns";
import { columnsFor } from "@/modules/import/application/classify";
import messages from "../messages/it.json";
import { createTestDb, type TestDb } from "./helpers/test-db";

const actor = { type: "owner", id: "o1" } as const;
const owner = { displayName: "Proprietario Prova", email: "prova@example.test" };
const labels: ImportLabels = {
  roles: messages.directory.role,
  kinds: messages.assets.kind,
  uses: messages.assets.use,
  rights: messages.assets.right,
  categories: messages.deadlines.category,
  levels: messages.rules.level,
  priorities: messages.deadlines.priority,
};

const CONTACTS = [
  "Nome;Ruoli;Codice fiscale;Email;Telefono",
  "Anna Verdi;tenant|Fornitore;;anna@esempio.test;111",
  "Studio Bianchi;accountant;BNCSTD80A01H501X;;",
  "Anna Verdi bis;tenant;;ANNA@esempio.test;",
  "Senza ruolo valido;pirata;;;",
  "Email sbagliata;;;non-una-email;",
].join("\r\n");

describe("importazione CSV", () => {
  let t: TestDb;
  const run = <T>(work: Parameters<typeof runInUnitOfWork<T>>[2]) => runInUnitOfWork(t.db, actor, work);
  const audits = async () => (await t.db.select().from(auditLog).orderBy(asc(auditLog.seq))).length;

  beforeAll(async () => {
    t = await createTestDb();
    await run((uow) =>
      importIstat(uow, [
        { regionCode: "90", regionName: "Regione di prova", provinceCode: "900", provinceName: "Provincia di prova", provinceSigla: "PP", municipalityCode: "900001", municipalityName: "Comune Uno", cadastralCode: "Z101" },
        { regionCode: "90", regionName: "Regione di prova", provinceCode: "901", provinceName: "Altra provincia", provinceSigla: "QQ", municipalityCode: "901001", municipalityName: "Comune Uno", cadastralCode: "Z102" },
        { regionCode: "90", regionName: "Regione di prova", provinceCode: "901", provinceName: "Altra provincia", provinceSigla: "QQ", municipalityCode: "901002", municipalityName: "Comune Due", cadastralCode: "Z103" },
      ]),
    );
  });
  afterAll(async () => {
    await t.close();
  });

  const preview = async (kind: ImportKind, text: string) => {
    const r = await previewImport(t.db, kind, text, labels);
    if (!r.ok) throw new Error(r.message);
    return r;
  };

  it("contatti: anteprima senza scrittura, con pronte, duplicate ed errori", async () => {
    const before = await audits();
    const p = await preview("contacts", CONTACTS);
    expect(p.counts).toEqual({ total: 5, ready: 2, duplicate: 1, error: 2, skipped: 0 });
    expect(p.rows.map((r) => r.status)).toEqual(["ready", "ready", "duplicate", "error", "error"]);
    expect(p.rows[2]!.message).toContain("riga 2");
    expect(p.rows[3]).toMatchObject({ column: "Ruoli" });
    expect(p.rows[4]).toMatchObject({ column: "Email" });
    expect(await listParties(t.db, { includeArchived: true })).toHaveLength(0);
    expect(await audits()).toBe(before);
  });

  it("contatti: l'importazione scrive le righe pronte e l'audit non contiene valori", async () => {
    const r = await runImport(t.db, actor, owner, "contacts", CONTACTS, labels);
    expect(r).toMatchObject({ ok: true, counts: { ready: 2, duplicate: 1, error: 2 } });
    const parties = await listParties(t.db, { includeArchived: true });
    expect(parties.map((p) => p.displayName).sort()).toEqual(["Anna Verdi", "Studio Bianchi"]);
    expect(parties.find((p) => p.displayName === "Anna Verdi")!.roles.sort()).toEqual(["supplier", "tenant"]);
    const rows = await t.db.select().from(auditLog).orderBy(asc(auditLog.seq));
    const summary = rows.find((a) => a.action === "import.run")!;
    expect(summary.diff).toEqual({ kind: "contacts", total: 5, imported: 2, duplicates: 1, errors: 2, skipped: 0 });
    expect(JSON.stringify(summary)).not.toContain("esempio.test");
    expect(JSON.stringify(summary)).not.toContain("Anna");
  });

  it("contatti: una seconda anteprima vede tutto come già presente", async () => {
    const p = await preview("contacts", CONTACTS);
    expect(p.counts).toMatchObject({ ready: 0, duplicate: 3, error: 2 });
  });

  it("immobili: Comune per nome e sigla, ambiguo, mancante; titolare e catasto", async () => {
    const holder = await run((uow) => createParty(uow, { displayName: "Titolare Prova", roles: ["co_owner"] }));
    expect(holder.ok).toBe(true);
    const csv = [
      "Tipo;Denominazione;Indirizzo;Comune;Provincia;Titolare;Quota;Diritto;Foglio;Particella;Rendita",
      "Appartamento;Casa A;Via Prova 1;Comune Uno;PP;Titolare Prova;50%;Comproprietà;12;34;1.234,56",
      "garage;Garage B;Via Prova 2;Comune Due;;;;;;;",
      "garage;Garage C;Via Prova 3;Comune Uno;;;;;;;",
      "garage;Garage D;Via Prova 4;Inesistente;;;;;;;",
      "garage;Garage E;Via Prova 5;Comune Due;;;1/2;;;;",
      "pippo;Garage F;Via Prova 6;Comune Due;;;;;;;",
      "garage;Casa A;Via Prova 9;Comune Uno;QQ;;;;;;",
      "garage;Casa A;Via Prova 9;Comune Uno;QQ;;;;;;",
    ].join("\r\n");
    const p = await preview("assets", csv);
    expect(p.rows.map((r) => r.status)).toEqual(["ready", "ready", "error", "error", "error", "error", "ready", "duplicate"]);
    expect(p.rows[2]!.message).toContain("sigla della Provincia");
    expect(p.rows[3]!.message).toContain("non trovato");
    expect(p.rows[4]).toMatchObject({ column: "Titolare" });
    expect(p.rows[5]).toMatchObject({ column: "Tipo" });
    expect(await listAssets(t.db, { includeArchived: true })).toHaveLength(0);

    const r = await runImport(t.db, actor, owner, "assets", csv, labels);
    expect(r).toMatchObject({ ok: true, counts: { ready: 3 } });
    const assets = await listAssets(t.db, { includeArchived: true });
    expect(assets.map((a) => a.name).sort()).toEqual(["Casa A", "Garage B", "Casa A"].sort());
    const a = assets.find((x) => x.name === "Casa A" && x.territoryLabel.includes("PP"))!;
    const detail = await getAssetDetail(t.db, a.id);
    expect(detail!.rights).toHaveLength(1);
    expect(detail!.rights[0]).toMatchObject({ quotaNumerator: 1, quotaDenominator: 2, rightType: "co_ownership" });
    expect(detail!.cadastral[0]).toMatchObject({ sheet: "12", parcel: "34", incomeCents: 123456 });

    const again = await preview("assets", csv);
    expect(again.rows.map((x) => x.status)).toEqual(["duplicate", "duplicate", "error", "error", "error", "error", "duplicate", "duplicate"]);
  });

  // Porte senza dati preesistenti, con le sole convalide dei moduli; la scrittura la fornisce il test.
  const dryRunPorts = (): Omit<ImportPorts, "create"> => ({
    existingParties: async () => [],
    validateParty: validatePartyInput,
    existingAssets: async () => [],
    validateAsset: validateAssetInput,
    findMunicipalities: async () => [],
    existingDeadlines: async () => [],
    validateDeadline: () => fail({ _: ["non usata"] }),
    existingLettings: async () => [],
    rentDatesOf: async () => [],
    validateRent: () => fail({ _: ["non usata"] }),
    validateRentPayment: () => fail({ _: ["non usata"] }),
    existingTaxTypes: async () => [],
    existingObligations: async () => [],
    paymentsOf: async () => [],
    validateObligation: () => fail({ _: ["non usata"] }),
    validateTaxPayment: () => fail({ _: ["non usata"] }),
    existingPolicies: async () => [],
    validatePolicy: () => fail({ _: ["non usata"] }),
  });

  it("importazione atomica: una riga rifiutata a metà non lascia nulla", async () => {
    const before = { parties: (await listParties(t.db, { includeArchived: true })).length, audits: await audits() };
    const csv = ["Nome", "Prima Riga Nuova", "Seconda Riga Nuova", "Terza Riga Nuova"].join("\r\n");
    // La scrittura reale della seconda riga viene fatta fallire: la convalida a secco non puo' prevedere un rifiuto in scrittura.
    await expect(
      run(async (uow) => {
        let n = 0;
        const ports: ImportPorts = {
          ...dryRunPorts(),
          create: async (kind, input) => (kind === "contacts" && ++n === 2 ? fail({ _: ["rifiutata"] }) : createParty(uow, input)),
        };
        return executeImport("contacts", csv, ports, labels, uow.audit);
      }),
    ).rejects.toThrow(ImportAbort);
    expect((await listParties(t.db, { includeArchived: true })).length).toBe(before.parties);
    expect(await audits()).toBe(before.audits);

    const ok = await runImport(t.db, actor, owner, "contacts", csv, labels);
    expect(ok).toMatchObject({ ok: true, counts: { ready: 3 } });
    expect((await listParties(t.db, { includeArchived: true })).length).toBe(before.parties + 3);
  });

  it("file non valido: errore leggibile, nessuna scrittura", async () => {
    const before = await audits();
    const r = await runImport(t.db, actor, owner, "contacts", 'Nome\r\n"aperta', labels);
    expect(r).toEqual({ ok: false, message: "Riga 2: virgolette aperte e mai chiuse." });
    const missing = await previewImport(t.db, "assets", "Denominazione\r\nX", labels);
    expect(missing).toMatchObject({ ok: false });
    expect(await audits()).toBe(before);
  });

  it("modello: intestazioni, riga di esempio, BOM e CRLF; si rilegge con il lettore", () => {
    for (const kind of IMPORT_KINDS) {
      const columns = columnsFor(kind);
      const text = importTemplate(kind);
      expect(text.startsWith(String.fromCharCode(0xfeff))).toBe(true);
      expect(text).toContain("\r\n");
      const parsed = parseCsv(text);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.headers).toEqual(columns.map((c) => c.header));
      expect(parsed.rows).toHaveLength(1);
      expect(mapColumns(parsed, columns).ok).toBe(true);
      expect(text).toContain("ESEMPIO");
    }
  });
});

describe("importazione: funzioni pure", () => {
  it("quote", () => {
    expect(parseQuota("50%")).toEqual({ numerator: 1, denominator: 2 });
    expect(parseQuota("1/2")).toEqual({ numerator: 1, denominator: 2 });
    expect(parseQuota("33,5 %")).toEqual({ numerator: 67, denominator: 200 });
    expect(parseQuota("100%")).toEqual({ numerator: 1, denominator: 1 });
    for (const bad of ["", "0%", "150%", "3/2", "1/0", "abc", "-1/2", "50"]) expect(parseQuota(bad)).toBeNull();
  });

  it("duplicati dei contatti: nome solo senza altri identificativi", () => {
    const a = contactKeys({ displayName: "Anna  Verdi", email: "A@x.test" });
    expect(contactDuplicateReason(contactKeys({ displayName: "Altro", email: "a@x.test" }), a)).toBe("stessa email");
    expect(contactDuplicateReason(contactKeys({ displayName: "Anna Verdi" }), a)).toBe("stesso nome");
    expect(contactDuplicateReason(contactKeys({ displayName: "Anna Verdi", email: "b@x.test" }), a)).toBeNull();
    expect(contactDuplicateReason(contactKeys({ displayName: "X", taxCode: "ab 12" }), contactKeys({ displayName: "Y", taxCode: "AB12" }))).toBe("stesso codice fiscale o partita IVA");
  });

  it("colonne: intestazioni riconosciute, ripetute o mancanti, righe corte", () => {
    const ok = parseCsv("NOME;e-mail;Boh\r\nA;a@x.test\r\n");
    if (!ok.ok) throw new Error(ok.message);
    const m = mapColumns(ok, CONTACT_COLUMNS);
    expect(m).toMatchObject({ ok: true, ignoredHeaders: ["Boh"] });
    if (m.ok) expect(m.records[0]!.columnCountError).toContain("2 colonne invece di 3");
    const twice = parseCsv("Nome;Denominazione\r\nA;B\r\n");
    if (!twice.ok) throw new Error(twice.message);
    expect(mapColumns(twice, CONTACT_COLUMNS)).toMatchObject({ ok: false });
    const none = parseCsv("Email\r\na@x.test\r\n");
    if (!none.ok) throw new Error(none.message);
    expect(mapColumns(none, CONTACT_COLUMNS)).toMatchObject({ ok: false });
  });

  it("percorsi di errore dei beni verso le colonne", () => {
    expect(assetErrorColumn("territoryId")).toBe("municipality");
    expect(assetErrorColumn("rights.0.quotaNumerator")).toBe("quota");
    expect(assetErrorColumn("rights.0.holder")).toBe("holder");
    expect(assetErrorColumn("cadastral.0.income")).toBe("income");
    expect(assetErrorColumn("cadastral.0.validFrom")).toBe("sheet");
    expect(assetErrorColumn("name")).toBe("name");
  });
});
