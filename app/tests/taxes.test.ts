import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { auditLog, territory } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { LocalFileStorage } from "@/platform/storage";
import { createAsset } from "@/modules/assets";
import { getDeadlineDetail, listDeadlines } from "@/modules/deadlines";
import { createDocument, listDocumentCategories } from "@/modules/documents";
import { importIstat } from "@/modules/territory";
import {
  adviserSummary,
  closeObligation,
  createObligation,
  createObligationDeadline,
  createReturn,
  createTaxType,
  getObligationDetail,
  listObligations,
  listReturns,
  listTaxTypes,
  recordPayment,
  removePayment,
  reopenObligation,
  setTaxTypeArchived,
  summaryCsv,
  territoryChoices,
  updateObligation,
  updateReturn,
  updateTaxType,
  yearsWithData,
} from "@/modules/taxes";
import { createTestDb, type TestDb } from "./helpers/test-db";
import { makePdf } from "./helpers/sample-pdf";

const actor = { type: "owner", id: "o1" } as const;
const owner = { displayName: "Proprietario Prova", email: "prova@example.test" };
const TODAY = "2026-06-15";

describe("tributi e pagamenti", () => {
  let t: TestDb;
  let dir: string;
  let storage: LocalFileStorage;
  let assetA: string;
  let assetB: string;
  let municipalityId: string;
  let proofId: string;
  let typeId: string;
  let obligationId: string;

  const run = <T>(work: Parameters<typeof runInUnitOfWork<T>>[2]) => runInUnitOfWork(t.db, actor, work);
  const okValue = <V>(r: { ok: boolean; value?: V }): V => {
    if (!r.ok) throw new Error(`atteso successo: ${JSON.stringify(r)}`);
    return r.value as V;
  };
  const detail = () => getObligationDetail(t.db, obligationId, TODAY).then((d) => d!);

  beforeAll(async () => {
    t = await createTestDb();
    dir = await mkdtemp(join(tmpdir(), "tax-test-"));
    storage = new LocalFileStorage(dir);
    await run((uow) => importIstat(uow, [{ regionCode: "90", regionName: "Regione di prova", provinceCode: "900", provinceName: "Provincia di prova", provinceSigla: "PP", municipalityCode: "900001", municipalityName: "Comune Uno", cadastralCode: "Z101" }]));
    municipalityId = (await t.db.select().from(territory).where(eq(territory.kind, "municipality")))[0]!.id;
    assetA = okValue(await run((uow) => createAsset(uow, owner, { kind: "dwelling", name: "Appartamento A", territoryId: municipalityId }))).id;
    assetB = okValue(await run((uow) => createAsset(uow, owner, { kind: "garage", name: "Box B", territoryId: municipalityId }))).id;
    const categoryId = (await listDocumentCategories(t.db))[0]!.id;
    proofId = okValue(await run((uow) => createDocument(uow, { title: "Ricevuta di prova", categoryId }, { name: "ricevuta.pdf", bytes: makePdf("ricevuta") }, storage))).id;
  }, 60_000);
  afterAll(async () => {
    await t.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("i tipi di tributo li scrive il proprietario: nome unico, ambito tra quelli dei suoi immobili, archiviabili", async () => {
    typeId = okValue(await run((uow) => createTaxType(uow, { name: "Imposta locale sugli immobili", kind: "tax", territoryId: municipalityId, source: "Sito del Comune" }))).id;
    expect(await run((uow) => createTaxType(uow, { name: " imposta LOCALE sugli immobili " }))).toMatchObject({ ok: false, errors: { name: ["Esiste già un tipo con questo nome"] } });
    expect(await run((uow) => createTaxType(uow, { name: "Altro", territoryId: "00000000-0000-4000-8000-000000000000" }))).toMatchObject({ ok: false, errors: { territoryId: expect.any(Array) } });
    expect(await territoryChoices(t.db)).toEqual([{ id: municipalityId, label: expect.stringContaining("Comune Uno") }]);

    const secondId = okValue(await run((uow) => createTaxType(uow, { name: "Tariffa rifiuti", kind: "levy" }))).id;
    expect((await listTaxTypes(t.db)).map((x) => x.name)).toEqual(["Imposta locale sugli immobili", "Tariffa rifiuti"]);
    expect((await listTaxTypes(t.db))[0]).toMatchObject({ kind: "tax", source: "Sito del Comune", territoryLabel: expect.stringContaining("Comune Uno") });

    expect(await run((uow) => updateTaxType(uow, secondId, { name: "Tariffa rifiuti urbani", kind: "levy" }))).toMatchObject({ ok: true });
    await run((uow) => setTaxTypeArchived(uow, secondId, true));
    expect((await listTaxTypes(t.db)).map((x) => x.id)).not.toContain(secondId);
    expect((await listTaxTypes(t.db, true)).map((x) => x.id)).toContain(secondId);
    // Un tipo archiviato non si usa per voci nuove.
    expect(await run((uow) => createObligation(uow, { assetId: assetA, taxTypeId: secondId, year: 2026 }))).toMatchObject({ ok: false, errors: { taxTypeId: expect.any(Array) } });
    await run((uow) => setTaxTypeArchived(uow, secondId, false));
  });

  it("una voce lega bene, tipo e anno; l'importo atteso e la scadenza sono facoltativi e scritti a mano", async () => {
    expect(await run((uow) => createObligation(uow, { assetId: assetA, taxTypeId: typeId, year: "abc" }))).toMatchObject({ ok: false, errors: { year: expect.any(Array) } });
    expect(await run((uow) => createObligation(uow, { assetId: "00000000-0000-4000-8000-000000000000", taxTypeId: typeId, year: 2026 }))).toMatchObject({ ok: false, errors: { assetId: expect.any(Array) } });
    expect(await run((uow) => createObligation(uow, { assetId: assetA, taxTypeId: typeId, year: 2026, createDeadline: true }))).toMatchObject({ ok: false, errors: { dueOn: ["Per creare la scadenza serve la data"] } });

    obligationId = okValue(await run((uow) => createObligation(uow, { assetId: assetA, taxTypeId: typeId, year: 2026, label: "Acconto", dueOn: "2026-06-16", expected: "450,00", askAdviser: true, note: "Verificare la riduzione", createDeadline: true }))).id;
    const d = await detail();
    expect(d).toMatchObject({ assetName: "Appartamento A", typeName: "Imposta locale sugli immobili", year: 2026, label: "Acconto", expectedCents: 45_000, paidCents: 0, state: "unpaid", remainingCents: 45_000, overdue: false, askAdviser: true, deadlineLinked: true });

    const deadlines = await listDeadlines(t.db);
    expect(deadlines.find((x) => x.title === "Imposta locale sugli immobili 2026 – Acconto (Appartamento A)")).toMatchObject({ category: "fiscal", assetId: assetA });

    // Una seconda voce senza importo atteso e senza scadenza; la scadenza si crea dopo solo se c'e' una data.
    const second = okValue(await run((uow) => createObligation(uow, { assetId: assetB, taxTypeId: typeId, year: 2026 }))).id;
    expect(await run((uow) => createObligationDeadline(uow, second))).toMatchObject({ ok: false, errors: { dueOn: expect.any(Array) } });
    await run((uow) => updateObligation(uow, second, { assetId: assetB, taxTypeId: typeId, year: 2026, dueOn: "2026-12-16" }));
    expect(await run((uow) => createObligationDeadline(uow, second))).toMatchObject({ ok: true });
    expect(await run((uow) => createObligationDeadline(uow, second))).toMatchObject({ ok: false, errors: { _: ["La voce ha già una scadenza collegata"] } });

    expect((await listObligations(t.db, { year: 2026 }, TODAY)).map((o) => o.assetName).sort()).toEqual(["Appartamento A", "Box B"]);
    expect(await listObligations(t.db, { year: 2025 }, TODAY)).toEqual([]);
    expect((await listObligations(t.db, { assetId: assetB }, TODAY)).map((o) => o.id)).toEqual([second]);
  });

  it("i pagamenti parziali non chiudono la scadenza; quando raggiungono l'importo indicato si', con la prova collegata", async () => {
    const deadlineId = (await detail()).deadlineId!;
    expect(await run((uow) => recordPayment(uow, obligationId, { paidOn: "2026-06-10", amount: "0" }))).toMatchObject({ ok: false, errors: { amount: expect.any(Array) } });
    expect(await run((uow) => recordPayment(uow, obligationId, { paidOn: "2026-06-10", amount: "abc" }))).toMatchObject({ ok: false, errors: { amount: expect.any(Array) } });
    expect(await run((uow) => recordPayment(uow, obligationId, { paidOn: "2026-06-10", amount: "10", documentId: "00000000-0000-4000-8000-000000000000" }))).toMatchObject({ ok: false, errors: { documentId: expect.any(Array) } });

    await run((uow) => recordPayment(uow, obligationId, { paidOn: "2026-06-10", amount: "200,00", method: "bank_transfer", reference: "CRO-SEGRETO-123" }));
    let d = await detail();
    expect(d).toMatchObject({ paidCents: 20_000, state: "partial", remainingCents: 25_000, payments: 1, paymentsWithoutProof: 1 });
    expect((await getDeadlineDetail(t.db, deadlineId, TODAY))!.occurrences[0]!.status).toBe("open");

    await run((uow) => recordPayment(uow, obligationId, { paidOn: "2026-06-12", amount: "250,00", method: "card", documentId: proofId }));
    d = await detail();
    expect(d).toMatchObject({ paidCents: 45_000, state: "settled", remainingCents: 0, payments: 2, paymentsWithoutProof: 1 });
    expect(d.paymentList.map((p) => [p.paidOn, p.amountCents, p.method, p.documentTitle])).toEqual([
      ["2026-06-10", 20_000, "bank_transfer", null],
      ["2026-06-12", 25_000, "card", "Ricevuta di prova"],
    ]);
    expect((await getDeadlineDetail(t.db, deadlineId, TODAY))!.occurrences[0]).toMatchObject({ status: "done", completedOn: "2026-06-12" });
  });

  it("un pagamento registrato per errore si toglie e la situazione si ricalcola", async () => {
    const wrong = (await detail()).paymentList[0]!;
    expect(await run((uow) => removePayment(uow, wrong.id))).toMatchObject({ ok: true });
    expect(await detail()).toMatchObject({ paidCents: 25_000, state: "partial", payments: 1, paymentsWithoutProof: 0 });
    // La scadenza che il pagamento aveva chiuso torna aperta: la voce non risulta piu' coperta.
    expect((await getDeadlineDetail(t.db, (await detail()).deadlineId!, TODAY))!.occurrences[0]!.status).toBe("open");
    expect(await run((uow) => removePayment(uow, wrong.id))).toMatchObject({ ok: false });
    await run((uow) => recordPayment(uow, obligationId, { paidOn: "2026-06-10", amount: "200,00", method: "bank_transfer", reference: "CRO-SEGRETO-123" }));
    expect((await getDeadlineDetail(t.db, (await detail()).deadlineId!, TODAY))!.occurrences[0]).toMatchObject({ status: "done" });
  });

  it("una voce chiusa non accetta pagamenti, richiede un motivo del proprietario e si puo' riaprire", async () => {
    const second = (await listObligations(t.db, { assetId: assetB }, TODAY))[0]!;
    expect(await run((uow) => closeObligation(uow, second.id, { reason: " " }, TODAY))).toMatchObject({ ok: false, errors: { reason: expect.any(Array) } });
    expect(await run((uow) => closeObligation(uow, second.id, { reason: "Indicazione scritta del consulente" }, TODAY))).toMatchObject({ ok: true });
    const closed = (await getObligationDetail(t.db, second.id, TODAY))!;
    expect(closed).toMatchObject({ status: "closed", state: "closed", closedOn: TODAY, closedNote: "Indicazione scritta del consulente", overdue: false });
    expect((await getDeadlineDetail(t.db, closed.deadlineId!, TODAY))!.occurrences[0]).toMatchObject({ status: "done", completedOn: TODAY });
    expect(await run((uow) => recordPayment(uow, second.id, { paidOn: "2026-06-10", amount: "10" }))).toMatchObject({ ok: false, errors: { _: ["La voce è chiusa: riaprila per registrare un pagamento"] } });
    await run((uow) => reopenObligation(uow, second.id));
    expect(await getObligationDetail(t.db, second.id, TODAY)).toMatchObject({ status: "open", state: "unpaid", closedOn: null, closedNote: null });
    expect((await getDeadlineDetail(t.db, closed.deadlineId!, TODAY))!.occurrences[0]!.status).toBe("open");
  });

  it("una voce con la data superata e senza pagamento completo e' segnalata, senza giudizi", async () => {
    const late = okValue(await run((uow) => createObligation(uow, { assetId: assetA, taxTypeId: typeId, year: 2025, dueOn: "2026-01-31", expected: "80,00" }))).id;
    expect(await getObligationDetail(t.db, late, TODAY)).toMatchObject({ overdue: true, state: "unpaid" });
    await run((uow) => recordPayment(uow, late, { paidOn: "2026-06-01", amount: "80,00" }));
    expect(await getObligationDetail(t.db, late, TODAY)).toMatchObject({ overdue: false, state: "settled" });
  });

  it("le dichiarazioni hanno scadenza, protocollo e ricevuta; presentarle chiude la scadenza collegata", async () => {
    const returnId = okValue(await run((uow) => createReturn(uow, { title: "Comunicazione annuale", year: 2026, assetId: assetA, dueOn: "2026-06-30", askAdviser: true, createDeadline: true }))).id;
    expect(await run((uow) => createReturn(uow, { title: " ", year: 2026 }))).toMatchObject({ ok: false, errors: { title: expect.any(Array) } });
    expect(await run((uow) => createReturn(uow, { title: "Senza data", year: 2026, createDeadline: true }))).toMatchObject({ ok: false, errors: { dueOn: expect.any(Array) } });
    expect((await listReturns(t.db, { year: 2026 }, TODAY))[0]).toMatchObject({ title: "Comunicazione annuale", assetName: "Appartamento A", state: "to_file" });
    expect((await listReturns(t.db, { year: 2026 }, "2026-07-01"))[0]!.state).toBe("overdue");

    await run((uow) => updateReturn(uow, returnId, { title: "Comunicazione annuale", year: 2026, assetId: assetA, dueOn: "2026-06-30", filedOn: "2026-06-20", protocol: "PROT-9", documentId: proofId, askAdviser: true }));
    const filed = (await listReturns(t.db, { year: 2026 }, TODAY))[0]!;
    expect(filed).toMatchObject({ state: "filed", protocol: "PROT-9", documentTitle: "Ricevuta di prova" });
    expect((await getDeadlineDetail(t.db, filed.deadlineId!, TODAY))!.occurrences[0]).toMatchObject({ status: "done", completedOn: "2026-06-20" });
    expect(await run((uow) => updateReturn(uow, returnId, { title: "Comunicazione annuale", year: 2026, documentId: "00000000-0000-4000-8000-000000000000" }))).toMatchObject({ ok: false, errors: { documentId: expect.any(Array) } });
  });

  it("il riepilogo per il consulente riporta i dati cosi' come sono, con cio' che manca e cio' da chiedere", async () => {
    expect(await yearsWithData(t.db)).toEqual([2026, 2025]);
    const summary = await adviserSummary(t.db, 2026, TODAY);
    expect(summary.items).toHaveLength(2);
    expect(summary.totals).toMatchObject({ expectedCents: 45_000, paidCents: 45_000, withoutExpected: 1 });
    expect(summary.withoutProof).toBe(1);
    expect(summary.toAsk.obligations.map((o) => o.assetName)).toEqual(["Appartamento A"]);
    expect(summary.toAsk.returns.map((r) => r.title)).toEqual(["Comunicazione annuale"]);

    await run((uow) => updateObligation(uow, obligationId, { assetId: assetA, taxTypeId: typeId, year: 2026, label: "Acconto", dueOn: "2026-06-16", expected: "450,00", askAdviser: true, note: "=HYPERLINK(\"http://x\")" }));
    const csv = summaryCsv(await adviserSummary(t.db, 2026, TODAY));
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe("Riepilogo tributi e pagamenti;2026");
    expect(lines).toContain("Immobile;Tributo;Dettaglio;Scadenza;Importo atteso (€);Pagato (€);Differenza (€);Situazione registrata;Pagamenti senza prova;Da chiedere al consulente;Nota");
    const row = lines.find((l) => l.startsWith("Appartamento A;"))!;
    expect(row).toContain("450");
    expect(row).toContain("Pagamenti registrati pari all'importo indicato");
    expect(row).toContain(`'=HYPERLINK(""http://x"")`);
    // L'avvertenza iniziale dice che l'importo non e' un calcolo; nelle righe di dati non compare nessun giudizio.
    expect(lines.filter((l) => !l.startsWith("Gli importi attesi")).join(" ")).not.toMatch(/dovut[oa]|corrett[oa]|conforme|in regola/i);
  });

  it("l'audit registra azioni e identificativi, mai testi, importi o riferimenti", async () => {
    const rows = await t.db.select().from(auditLog).where(sql`${auditLog.action} like 'tax.%'`);
    expect(new Set(rows.map((r) => r.action)).size).toBeGreaterThan(10);
    const text = JSON.stringify(rows);
    for (const secret of ["Imposta locale", "Sito del Comune", "CRO-SEGRETO-123", "Verificare la riduzione", "Indicazione scritta", "PROT-9", "Comunicazione annuale", "Appartamento A"]) expect(text, secret).not.toContain(secret);
    expect((await t.db.execute(sql`select audit_log_verify() as v`) as unknown as { rows: { v: unknown }[] }).rows[0]!.v).toBeNull();
  });
});
