import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { auditLog, territory } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { createAsset, listAssets } from "@/modules/assets";
import { createDeadline, listOccurrences } from "@/modules/deadlines";
import { createParty, listParties } from "@/modules/directory";
import { createPolicy, listPolicies } from "@/modules/insurance";
import { addRent, createLetting, getLettingDetail } from "@/modules/lettings";
import { closeObligation, createObligation, createTaxType, getObligationDetail, listObligations, recordPayment } from "@/modules/taxes";
import { importIstat } from "@/modules/territory";
import { fail } from "@/shared/result";
import { importPorts, importTemplate, previewImport, runImport, type ImportKind, type ImportLabels } from "@/modules/import";
import { ImportAbort, executeImport } from "@/modules/import/application/run";
import { IMPORT_KINDS, isExampleRow } from "@/modules/import/domain/columns";
import { columnsFor } from "@/modules/import/application/classify";
import { parseFlexibleDate } from "@/modules/import/domain/dates";
import { obligationKey, paymentKey } from "@/modules/import/domain/taxes";
import { policyKey } from "@/modules/import/domain/policies";
import { deadlineKey } from "@/modules/import/domain/deadlines";
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
const lines = (rows: string[]) => rows.join("\r\n");

describe("importazione: altri tipi di file", () => {
  let t: TestDb;
  let casaUno: string;
  let casaDue: string;
  let lettingId: string;
  let acconto: string;
  const run = <V>(work: Parameters<typeof runInUnitOfWork<V>>[2]) => runInUnitOfWork(t.db, actor, work);
  const okValue = <V>(r: { ok: boolean; value?: V }): V => {
    if (!r.ok) throw new Error(`atteso successo: ${JSON.stringify(r)}`);
    return r.value as V;
  };
  const audits = async () => (await t.db.select().from(auditLog).orderBy(asc(auditLog.seq))).length;
  const lastSummary = async () => (await t.db.select().from(auditLog).orderBy(asc(auditLog.seq))).filter((a) => a.action === "import.run").at(-1)!;
  const preview = async (kind: ImportKind, text: string) => {
    const r = await previewImport(t.db, kind, text, labels);
    if (!r.ok) throw new Error(r.message);
    return r;
  };
  const statuses = async (kind: ImportKind, text: string) => (await preview(kind, text)).rows.map((r) => r.status);

  beforeAll(async () => {
    t = await createTestDb();
    await run((uow) =>
      importIstat(uow, [{ regionCode: "90", regionName: "Regione di prova", provinceCode: "900", provinceName: "Provincia di prova", provinceSigla: "PP", municipalityCode: "900001", municipalityName: "Comune Uno", cadastralCode: "Z101" }]),
    );
    const municipalityId = (await t.db.select().from(territory).where(eq(territory.kind, "municipality")))[0]!.id;
    casaUno = okValue(await run((uow) => createAsset(uow, owner, { kind: "dwelling", name: "Casa Uno", territoryId: municipalityId }))).id;
    casaDue = okValue(await run((uow) => createAsset(uow, owner, { kind: "garage", name: "Casa Due", territoryId: municipalityId }))).id;
    okValue(await run((uow) => createParty(uow, { displayName: "Compagnia Prova", roles: ["supplier"] })));
    // Scadenza gia' presente.
    okValue(await run((uow) => createDeadline(uow, { title: "Scadenza già presente", category: "other", level: "contract", calc: { type: "manual" }, firstDueOn: "2099-03-15" })));
    // Locazioni: una normale, due con lo stesso titolo; un canone gia' presente.
    lettingId = okValue(await run((uow) => createLetting(uow, { assetId: casaUno, type: "residential", title: "Locazione Prova" }))).id;
    okValue(await run((uow) => createLetting(uow, { assetId: casaUno, type: "residential", title: "Locazione Doppia" })));
    okValue(await run((uow) => createLetting(uow, { assetId: casaDue, type: "residential", title: "Locazione Doppia" })));
    okValue(await run((uow) => addRent(uow, lettingId, { dueOn: "2099-01-31", amount: "500,00" })));
    // Tributi: una voce aperta con un pagamento, una voce chiusa.
    const typeId = okValue(await run((uow) => createTaxType(uow, { name: "Imposta Prova" }))).id;
    acconto = okValue(await run((uow) => createObligation(uow, { assetId: casaUno, taxTypeId: typeId, year: 2026, label: "Acconto", expected: "400,00" }))).id;
    okValue(await run((uow) => recordPayment(uow, acconto, { paidOn: "2099-03-01", amount: "55,00" })));
    const chiusa = okValue(await run((uow) => createObligation(uow, { assetId: casaDue, taxTypeId: typeId, year: 2025, label: "Chiusa" }))).id;
    okValue(await run((uow) => closeObligation(uow, chiusa, { reason: "Motivo di prova" })));
    // Polizza gia' presente.
    okValue(await run((uow) => createPolicy(uow, { title: "Polizza esistente", policyNumber: "N-1", startsOn: "2099-01-01" })));
  });
  afterAll(async () => {
    await t.close();
  });

  it("date: gg/mm/aaaa e aaaa-mm-gg; vuota non e' un errore; date impossibili si", () => {
    expect(parseFlexibleDate("31/12/2099")).toEqual({ value: "2099-12-31" });
    expect(parseFlexibleDate("1/2/2099")).toEqual({ value: "2099-02-01" });
    expect(parseFlexibleDate("01.02.2099")).toEqual({ value: "2099-02-01" });
    expect(parseFlexibleDate("2099-2-1")).toEqual({ value: "2099-02-01" });
    expect(parseFlexibleDate(" ")).toEqual({});
    for (const bad of ["31/02/2099", "2099/01/01", "01/01/99", "ieri", "2099-13-01"]) expect(parseFlexibleDate(bad)).toEqual({ invalid: true });
  });

  it("riga di esempio: riconosciuta solo se la colonna di testo del modello inizia con ESEMPIO", () => {
    const columns = columnsFor("contacts");
    expect(isExampleRow({ displayName: "ESEMPIO – Mario Rossi" }, columns)).toBe(true);
    expect(isExampleRow({ displayName: "  ESEMPIO" }, columns)).toBe(true);
    expect(isExampleRow({ displayName: "Esempio Rossi" }, columns)).toBe(false);
    expect(isExampleRow({ displayName: "ESEMPIOX" }, columns)).toBe(false);
    expect(isExampleRow({ displayName: "Mario ESEMPIO" }, columns)).toBe(false);
    expect(isExampleRow({}, columns)).toBe(false);
  });

  it("modello importato cosi' com'e': ogni tipo salta la riga di esempio e non scrive nulla", async () => {
    const before = {
      parties: (await listParties(t.db, { includeArchived: true })).length,
      assets: (await listAssets(t.db, { includeArchived: true })).length,
      occurrences: (await listOccurrences(t.db, "all", { includeArchived: true })).length,
      obligations: (await listObligations(t.db)).length,
      policies: (await listPolicies(t.db, true)).length,
      rents: (await getLettingDetail(t.db, lettingId))!.rents.length,
    };
    for (const kind of IMPORT_KINDS) {
      const text = importTemplate(kind);
      const p = await preview(kind, text);
      expect(p.counts).toEqual({ total: 1, ready: 0, duplicate: 0, error: 0, skipped: 1 });
      expect(p.rows[0]).toMatchObject({ status: "skipped", label: expect.stringContaining("ESEMPIO") });
      const r = await runImport(t.db, actor, owner, kind, text, labels);
      expect(r).toMatchObject({ ok: true, counts: { ready: 0, skipped: 1 } });
    }
    expect({
      parties: (await listParties(t.db, { includeArchived: true })).length,
      assets: (await listAssets(t.db, { includeArchived: true })).length,
      occurrences: (await listOccurrences(t.db, "all", { includeArchived: true })).length,
      obligations: (await listObligations(t.db)).length,
      policies: (await listPolicies(t.db, true)).length,
      rents: (await getLettingDetail(t.db, lettingId))!.rents.length,
    }).toEqual(before);
    expect((await lastSummary()).diff).toMatchObject({ kind: "policies", skipped: 1, imported: 0 });
  });

  it("riga di esempio mescolata a righe vere: solo quella di esempio e' saltata", async () => {
    const csv = lines(["Nome", "ESEMPIO – Mario Rossi (riga fittizia, da cancellare)", "Contatto Vero"]);
    expect((await preview("contacts", csv)).counts).toEqual({ total: 2, ready: 1, duplicate: 0, error: 0, skipped: 1 });
    expect(await runImport(t.db, actor, owner, "contacts", csv, labels)).toMatchObject({ ok: true, counts: { ready: 1, skipped: 1 } });
    expect((await listParties(t.db, { includeArchived: true })).map((p) => p.displayName)).toEqual(expect.arrayContaining(["Contatto Vero"]));
    expect((await listParties(t.db, { includeArchived: true })).some((p) => p.displayName.startsWith("ESEMPIO"))).toBe(false);
  });

  // ------------------------------------------------------------------------------------------------- scadenze
  const DEADLINES = lines([
    "Titolo;Categoria;Livello;Immobile;Data;Priorità;Note",
    "Rinnovo contratto;contractual;contract;Casa Uno;31/12/2099;Alta;da ricordare",
    "Controllo impianto;Tecnica;Nazionale;;2099-06-30;;",
    "Rinnovo contratto;contractual;contract;casa uno;31/12/2099;;",
    "Scadenza già presente;other;contract;;15/03/2099;;",
    "Senza data;other;contract;;;;",
    "Data impossibile;other;contract;;31/02/2099;;",
    "Categoria strana;boh;contract;;01/01/2099;;",
    "Immobile ignoto;other;contract;Nessuna Casa;01/01/2099;;",
    "Priorità strana;other;contract;;01/01/2099;urgentissima;",
  ]);

  it("scadenze: anteprima con pronte, duplicate ed errori per colonna, senza scrivere", async () => {
    const before = { audits: await audits(), n: (await listOccurrences(t.db, "all", { includeArchived: true })).length };
    const p = await preview("deadlines", DEADLINES);
    expect(p.rows.map((r) => r.status)).toEqual(["ready", "ready", "duplicate", "duplicate", "error", "error", "error", "error", "error"]);
    expect(p.rows[2]!.message).toContain("riga 2");
    expect(p.rows[3]!.message).toContain("Già presente");
    expect(p.rows.slice(4).map((r) => r.column)).toEqual(["Data", "Data", "Categoria", "Immobile", "Priorità"]);
    expect((await listOccurrences(t.db, "all", { includeArchived: true })).length).toBe(before.n);
    expect(await audits()).toBe(before.audits);
  });

  it("scadenze: l'importazione crea solo scadenze manuali con data; l'audit ha soli conteggi", async () => {
    const r = await runImport(t.db, actor, owner, "deadlines", DEADLINES, labels);
    expect(r).toMatchObject({ ok: true, counts: { total: 9, ready: 2, duplicate: 2, error: 5 } });
    const all = await listOccurrences(t.db, "all", { includeArchived: true });
    const rinnovo = all.find((o) => o.title === "Rinnovo contratto")!;
    expect(rinnovo).toMatchObject({ dueOn: "2099-12-31", assetId: casaUno, priority: "high", origin: "manual", category: "contractual", level: "contract" });
    expect(all.find((o) => o.title === "Controllo impianto")).toMatchObject({ dueOn: "2099-06-30", assetId: null, category: "technical", level: "national", priority: "normal" });
    expect(all.filter((o) => o.title === "Rinnovo contratto")).toHaveLength(1);
    const summary = await lastSummary();
    expect(summary.diff).toEqual({ kind: "deadlines", total: 9, imported: 2, duplicates: 2, errors: 5, skipped: 0 });
    expect(JSON.stringify(summary)).not.toContain("Rinnovo");
    expect((await statuses("deadlines", DEADLINES)).slice(0, 4)).toEqual(["duplicate", "duplicate", "duplicate", "duplicate"]);
    expect(deadlineKey(" Rinnovo  Contratto ", "2099-12-31", casaUno)).toBe(deadlineKey("rinnovo contratto", "2099-12-31", casaUno));
  });

  // ---------------------------------------------------------------------------------------------------- canoni
  const RENTS = lines([
    "Locazione;Scadenza;Importo;Data incasso;Importo incassato",
    "Locazione Prova;28/02/2099;1.234,56;05/03/2099;1.234,56",
    "Locazione Prova;31/03/2099;500,00;;",
    "Locazione Prova;31/01/2099;500,00;;",
    "Locazione Prova;2099-03-31;500,00;;",
    "Locazione Inesistente;30/04/2099;500,00;;",
    "Locazione Doppia;30/04/2099;500,00;;",
    "Locazione Prova;30/04/2099;abc;;",
    "Locazione Prova;30/05/2099;100,00;01/06/2099;",
    "Locazione Prova;;100,00;;",
  ]);

  it("canoni: duplicato = stessa locazione e scadenza (anche con l'indice univoco); errori per colonna", async () => {
    const p = await preview("rents", RENTS);
    expect(p.rows.map((r) => r.status)).toEqual(["ready", "ready", "duplicate", "duplicate", "error", "error", "error", "error", "error"]);
    expect(p.rows[2]!.message).toContain("Già presente");
    expect(p.rows[3]!.message).toContain("riga 3");
    expect(p.rows[4]).toMatchObject({ column: "Locazione", message: expect.stringContaining("non trovata") });
    expect(p.rows[5]).toMatchObject({ column: "Locazione", message: expect.stringContaining("Più locazioni") });
    expect(p.rows.slice(6).map((r) => r.column)).toEqual(["Importo", "Importo incassato", "Scadenza"]);
  });

  it("canoni: l'importazione registra canone e incasso; una seconda anteprima li vede già presenti", async () => {
    const r = await runImport(t.db, actor, owner, "rents", RENTS, labels);
    expect(r).toMatchObject({ ok: true, counts: { ready: 2, duplicate: 2, error: 5 } });
    const detail = (await getLettingDetail(t.db, lettingId))!;
    expect(detail.rents.map((x) => x.dueOn).sort()).toEqual(["2099-01-31", "2099-02-28", "2099-03-31"]);
    const paid = detail.rents.find((x) => x.dueOn === "2099-02-28")!;
    expect(paid).toMatchObject({ amountCents: 123456, paidCents: 123456, paidOn: "2099-03-05" });
    expect(detail.rents.find((x) => x.dueOn === "2099-03-31")).toMatchObject({ amountCents: 50000, paidCents: 0 });
    expect(JSON.stringify(await lastSummary())).not.toContain("Locazione Prova");
    expect((await statuses("rents", RENTS)).slice(0, 4)).toEqual(["duplicate", "duplicate", "duplicate", "duplicate"]);
  });

  // ---------------------------------------------------------------------------------------------- voci di tributo
  const TAXES = lines([
    "Immobile;Tipo di tributo;Anno;Etichetta;Importo atteso;Note",
    "Casa Uno;Imposta Prova;2026;Saldo;1.000,00;",
    "Casa Uno;Imposta Prova;2026;Acconto;;",
    "Casa Uno;imposta prova;2026;Saldo;;",
    "Casa Uno;Imposta Prova;2027;;;",
    "Casa Due;Imposta Prova;2026;;;nota",
    "Casa Uno;Tipo Inesistente;2026;X;;",
    "Casa Uno;Imposta Prova;abc;;;",
    "Casa Uno;Imposta Prova;2026;Rata;importo;",
    "Casa Tre;Imposta Prova;2026;;;",
  ]);

  it("voci di tributo: tipo e immobile esistenti, duplicato come l'indice univoco", async () => {
    const p = await preview("taxes", TAXES);
    expect(p.rows.map((r) => r.status)).toEqual(["ready", "duplicate", "duplicate", "ready", "ready", "error", "error", "error", "error"]);
    expect(p.rows[5]).toMatchObject({ column: "Tipo di tributo", message: expect.stringContaining("non crea i tipi") });
    expect(p.rows.slice(6).map((r) => r.column)).toEqual(["Anno", "Importo atteso", "Immobile"]);
    expect(obligationKey("a", "b", 2026, null)).not.toBe(obligationKey("a", "b", 2026, "Saldo"));
  });

  it("voci di tributo: l'importazione crea le voci (non i tipi) e l'audit non ha valori", async () => {
    const r = await runImport(t.db, actor, owner, "taxes", TAXES, labels);
    expect(r).toMatchObject({ ok: true, counts: { ready: 3, duplicate: 2, error: 4 } });
    const rows = await listObligations(t.db);
    expect(rows.filter((o) => o.assetId === casaUno && o.year === 2026).map((o) => o.label).sort()).toEqual(["Acconto", "Saldo"]);
    expect(rows.find((o) => o.label === "Saldo")).toMatchObject({ expectedCents: 100000, status: "open" });
    expect(rows.filter((o) => o.assetId === casaUno && o.year === 2027)).toHaveLength(1);
    expect(rows.find((o) => o.assetId === casaDue && o.year === 2026)).toMatchObject({ note: "nota" });
    expect(JSON.stringify(await lastSummary())).not.toContain("Imposta Prova");
    expect((await statuses("taxes", TAXES)).slice(0, 5)).toEqual(["duplicate", "duplicate", "duplicate", "duplicate", "duplicate"]);
  });

  // ------------------------------------------------------------------------------------------ pagamenti di tributo
  const PAYMENTS = lines([
    "Immobile;Tipo di tributo;Anno;Etichetta;Data pagamento;Importo pagato;Riferimento",
    "Casa Uno;Imposta Prova;2026;Acconto;10/03/2099;200,00;Rif 1",
    "Casa Uno;Imposta Prova;2026;Acconto;10/03/2099;200,00;",
    "Casa Uno;Imposta Prova;2026;Acconto;11/03/2099;150,50;",
    "Casa Uno;Imposta Prova;2026;Acconto;01/03/2099;55,00;",
    "Casa Uno;Imposta Prova;2026;Inesistente;11/03/2099;10,00;",
    "Casa Due;Imposta Prova;2025;Chiusa;11/03/2099;10,00;",
    "Casa Uno;Imposta Prova;2026;Acconto;;10,00;",
    "Casa Uno;Imposta Prova;2026;Acconto;12/03/2099;0;",
    "Casa Uno;Imposta Prova;2026;Acconto;12/03/2099;abc;",
  ]);

  it("pagamenti di tributo: voce identificata da immobile+tipo+anno+etichetta, chiusa o mancante in errore", async () => {
    const p = await preview("taxPayments", PAYMENTS);
    expect(p.rows.map((r) => r.status)).toEqual(["ready", "duplicate", "ready", "duplicate", "error", "error", "error", "error", "error"]);
    expect(p.rows[3]!.message).toContain("Già presente");
    expect(p.rows[4]).toMatchObject({ column: "Etichetta", message: expect.stringContaining("Nessuna voce") });
    expect(p.rows[5]!.message).toContain("chiusa");
    expect(p.rows.slice(6).map((r) => r.column)).toEqual(["Data pagamento", "Importo pagato", "Importo pagato"]);
    expect(paymentKey("o", "2099-01-01", 100)).toBe("o|2099-01-01|100");
  });

  it("pagamenti di tributo: l'importazione li registra sulla voce", async () => {
    const r = await runImport(t.db, actor, owner, "taxPayments", PAYMENTS, labels);
    expect(r).toMatchObject({ ok: true, counts: { ready: 2, duplicate: 2, error: 5 } });
    const detail = (await getObligationDetail(t.db, acconto))!;
    expect(detail.paidCents).toBe(5500 + 20000 + 15050);
    expect(detail.paymentList.map((x) => x.paidOn).sort()).toEqual(["2099-03-01", "2099-03-10", "2099-03-11"]);
    expect(detail.paymentList.find((x) => x.paidOn === "2099-03-10")!.reference).toBe("Rif 1");
    expect(JSON.stringify(await lastSummary())).not.toContain("Rif 1");
  });

  // ------------------------------------------------------------------------------------------------------ polizze
  const POLICIES = lines([
    "Titolo;Compagnia;Numero polizza;Data inizio;Data fine;Premio;Immobili;Note",
    "Polizza casa;Compagnia Prova;P-100;01/01/2099;31/12/2099;1.234,56;Casa Uno|Casa Due;nota",
    "Polizza box;;;;;;;",
    "Polizza esistente;;N-1;01/01/2099;;;;",
    "Polizza casa;compagnia prova;P-100;01/01/2099;;;;",
    "Polizza errata;Compagnia Ignota;;;;;;",
    "Polizza date;;;31/12/2099;01/01/2099;;;",
    "Polizza immobile;;;;;;Casa Uno|Nessuna;",
    "Polizza premio;;;;;abc;;",
  ]);

  it("polizze: compagnia dalla rubrica, immobili separati da |, duplicato per titolo+numero+inizio", async () => {
    const p = await preview("policies", POLICIES);
    expect(p.rows.map((r) => r.status)).toEqual(["ready", "ready", "duplicate", "duplicate", "error", "error", "error", "error"]);
    expect(p.rows.slice(4).map((r) => r.column)).toEqual(["Compagnia", "Data fine", "Immobili", "Premio"]);
    expect(policyKey("A  b", " N-1 ", "2099-01-01")).toBe(policyKey("a b", "n-1", "2099-01-01"));
  });

  it("polizze: l'importazione collega compagnia e immobili", async () => {
    const r = await runImport(t.db, actor, owner, "policies", POLICIES, labels);
    expect(r).toMatchObject({ ok: true, counts: { ready: 2, duplicate: 2, error: 4 } });
    const policies = await listPolicies(t.db, true);
    const casa = policies.find((p) => p.title === "Polizza casa")!;
    expect(casa).toMatchObject({ insurerName: "Compagnia Prova", policyNumber: "P-100", premiumCents: 123456, startsOn: "2099-01-01", endsOn: "2099-12-31", note: "nota" });
    expect(casa.assets.map((a) => a.name).sort()).toEqual(["Casa Due", "Casa Uno"]);
    expect(policies.find((p) => p.title === "Polizza box")!.assets).toHaveLength(0);
    expect(JSON.stringify(await lastSummary())).not.toContain("P-100");
  });

  // -------------------------------------------------------------------------------------------------- atomicita'
  const ATOMIC: { kind: ImportKind; csv: string; count: () => Promise<number> }[] = [
    {
      kind: "deadlines",
      csv: lines(["Titolo;Categoria;Livello;Data", "Atomica A;other;contract;01/01/2098", "Atomica B;other;contract;02/01/2098", "Atomica C;other;contract;03/01/2098"]),
      count: async () => (await listOccurrences(t.db, "all", { includeArchived: true })).length,
    },
    {
      kind: "rents",
      csv: lines(["Locazione;Scadenza;Importo;Importo incassato", "Locazione Prova;01/01/2098;10,00;10,00", "Locazione Prova;01/02/2098;10,00;10,00", "Locazione Prova;01/03/2098;10,00;10,00"]),
      count: async () => (await getLettingDetail(t.db, lettingId))!.rents.length,
    },
    {
      kind: "taxes",
      csv: lines(["Immobile;Tipo di tributo;Anno", "Casa Uno;Imposta Prova;2031", "Casa Uno;Imposta Prova;2032", "Casa Uno;Imposta Prova;2033"]),
      count: async () => (await listObligations(t.db)).length,
    },
    {
      kind: "taxPayments",
      csv: lines(["Immobile;Tipo di tributo;Anno;Etichetta;Data pagamento;Importo pagato", "Casa Uno;Imposta Prova;2026;Acconto;01/01/2098;1,00", "Casa Uno;Imposta Prova;2026;Acconto;02/01/2098;1,00", "Casa Uno;Imposta Prova;2026;Acconto;03/01/2098;1,00"]),
      count: async () => (await getObligationDetail(t.db, acconto))!.paymentList.length,
    },
    {
      kind: "policies",
      csv: lines(["Titolo", "Atomica A", "Atomica B", "Atomica C"]),
      count: async () => (await listPolicies(t.db, true)).length,
    },
  ];

  it.each(ATOMIC)("$kind: una riga rifiutata in scrittura annulla tutto, poi l'importazione riesce", async ({ kind, csv, count }) => {
    const before = { n: await count(), audits: await audits() };
    // La convalida a secco non puo' prevedere un rifiuto in scrittura: lo si simula alla seconda riga.
    await expect(
      run(async (uow) => {
        const real = importPorts(uow, owner);
        let n = 0;
        return executeImport(kind, csv, { ...real, create: async (k, payload) => (++n === 2 ? fail({ _: ["rifiutata"] }) : real.create(k, payload)) }, labels, uow.audit);
      }),
    ).rejects.toThrow(ImportAbort);
    expect(await count()).toBe(before.n);
    expect(await audits()).toBe(before.audits);

    const ok = await runImport(t.db, actor, owner, kind, csv, labels);
    expect(ok).toMatchObject({ ok: true, counts: { ready: 3 } });
    expect(await count()).toBe(before.n + 3);
  });

  it("file senza le colonne obbligatorie del tipo: errore leggibile, nessuna scrittura", async () => {
    const before = await audits();
    for (const kind of ["deadlines", "rents", "taxes", "taxPayments", "policies"] as const) {
      const r = await runImport(t.db, actor, owner, kind, lines(["Note", "x"]), labels);
      expect(r).toMatchObject({ ok: false });
    }
    expect(await audits()).toBe(before);
  });
});
