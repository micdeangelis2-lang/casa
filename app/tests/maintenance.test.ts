import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { auditLog, territory } from "@/platform/db/schema";
import { todayInItaly } from "@/platform/clock";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { LocalFileStorage } from "@/platform/storage";
import { addDays } from "@/shared/dates";
import { createAsset } from "@/modules/assets";
import { completeOccurrence, getDeadlineDetail, listDeadlines } from "@/modules/deadlines";
import { createParty } from "@/modules/directory";
import { createDocument, listDocumentCategories } from "@/modules/documents";
import { importIstat } from "@/modules/territory";
import {
  addInvoice,
  addProgress,
  addQuote,
  createInspectionPlan,
  createWarranty,
  createWork,
  getWorkDetail,
  listInspectionPlans,
  listWarranties,
  listWorks,
  removeEntry,
  setInvoicePaid,
  setPlanArchived,
  setQuoteStatus,
  setWarrantyArchived,
  setWorkStatus,
  updateWork,
} from "@/modules/maintenance";
import { createTestDb, type TestDb } from "./helpers/test-db";
import { makePdf } from "./helpers/sample-pdf";

const actor = { type: "owner", id: "o1" } as const;
const owner = { displayName: "Proprietario Prova", email: "prova@example.test" };
const TODAY = "2026-06-15";

describe("manutenzioni e lavori", () => {
  let t: TestDb;
  let dir: string;
  let storage: LocalFileStorage;
  let assetId: string;
  let supplierId: string;
  let documentId: string;
  let workId: string;

  const run = <T>(work: Parameters<typeof runInUnitOfWork<T>>[2]) => runInUnitOfWork(t.db, actor, work);
  const okValue = <V>(r: { ok: boolean; value?: V }): V => {
    if (!r.ok) throw new Error(`atteso successo: ${JSON.stringify(r)}`);
    return r.value as V;
  };
  const detail = () => getWorkDetail(t.db, workId, TODAY).then((d) => d!);

  beforeAll(async () => {
    t = await createTestDb();
    dir = await mkdtemp(join(tmpdir(), "maint-test-"));
    storage = new LocalFileStorage(dir);
    await run((uow) => importIstat(uow, [{ regionCode: "90", regionName: "Regione di prova", provinceCode: "900", provinceName: "Provincia di prova", provinceSigla: "PP", municipalityCode: "900001", municipalityName: "Comune Uno", cadastralCode: "Z101" }]));
    const municipalityId = (await t.db.select().from(territory).where(eq(territory.kind, "municipality")))[0]!.id;
    assetId = okValue(await run((uow) => createAsset(uow, owner, { kind: "dwelling", name: "Appartamento A", territoryId: municipalityId }))).id;
    supplierId = okValue(await run((uow) => createParty(uow, { displayName: "Idraulico Esempio", roles: ["supplier"] }))).id;
    const categoryId = (await listDocumentCategories(t.db))[0]!.id;
    documentId = okValue(await run((uow) => createDocument(uow, { title: "Preventivo caldaia", categoryId }, { name: "preventivo.pdf", bytes: makePdf("preventivo") }, storage))).id;
  }, 60_000);
  afterAll(async () => {
    await t.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("un intervento si registra per un immobile, con fornitore e importo previsto; la scadenza si crea solo se c'e' la data", async () => {
    expect(await run((uow) => createWork(uow, { assetId, title: " " }))).toMatchObject({ ok: false, errors: { title: expect.any(Array) } });
    expect(await run((uow) => createWork(uow, { assetId: "00000000-0000-4000-8000-000000000000", title: "X" }))).toMatchObject({ ok: false, errors: { assetId: expect.any(Array) } });
    expect(await run((uow) => createWork(uow, { assetId, title: "X", supplierPartyId: "00000000-0000-4000-8000-000000000000" }))).toMatchObject({ ok: false, errors: { supplierPartyId: expect.any(Array) } });
    expect(await run((uow) => createWork(uow, { assetId, title: "X", createDeadline: true }))).toMatchObject({ ok: false, errors: { scheduledOn: expect.any(Array) } });

    workId = okValue(await run((uow) => createWork(uow, { assetId, title: "Sostituzione caldaia", description: "Caldaia a condensazione", supplierPartyId: supplierId, scheduledOn: "2026-09-10", budget: "3.500,00", createDeadline: true }))).id;
    const d = await detail();
    expect(d).toMatchObject({ assetName: "Appartamento A", supplierName: "Idraulico Esempio", status: "planned", budgetCents: 350_000 });
    expect(d.deadlineId).not.toBeNull();
    expect((await listDeadlines(t.db)).find((x) => x.title === "Sostituzione caldaia (Appartamento A)")).toMatchObject({ category: "technical", assetId });
  });

  it("l'elenco nasconde gli interventi conclusi o annullati salvo richiesta; lo stato compila le date mancanti", async () => {
    const second = okValue(await run((uow) => createWork(uow, { assetId, title: "Tinteggiatura scale" }))).id;
    expect((await listWorks(t.db)).map((w) => w.title)).toEqual(expect.arrayContaining(["Sostituzione caldaia", "Tinteggiatura scale"]));
    expect(await run((uow) => setWorkStatus(uow, second, "finito", TODAY))).toMatchObject({ ok: false, errors: { status: expect.any(Array) } });
    await run((uow) => setWorkStatus(uow, second, "in_progress", TODAY));
    expect(await getWorkDetail(t.db, second, TODAY)).toMatchObject({ status: "in_progress", startedOn: TODAY, completedOn: null });
    await run((uow) => setWorkStatus(uow, second, "completed", "2026-06-20"));
    expect(await getWorkDetail(t.db, second, TODAY)).toMatchObject({ status: "completed", startedOn: TODAY, completedOn: "2026-06-20" });
    expect((await listWorks(t.db)).map((w) => w.title)).not.toContain("Tinteggiatura scale");
    expect((await listWorks(t.db, { includeClosed: true })).map((w) => w.title)).toContain("Tinteggiatura scale");
    expect((await listWorks(t.db, { status: "completed" })).map((w) => w.title)).toEqual(["Tinteggiatura scale"]);
    expect(await run((uow) => updateWork(uow, second, { assetId, title: "Tinteggiatura scale", status: "completed" }, "2026-07-01"))).toMatchObject({ ok: true });
    expect(await getWorkDetail(t.db, second, TODAY)).toMatchObject({ completedOn: "2026-07-01" });
  });

  it("i preventivi fanno avanzare l'intervento solo in avanti e non si valutano", async () => {
    expect(await run((uow) => addQuote(uow, workId, { amount: "abc" }))).toMatchObject({ ok: false, errors: { amount: expect.any(Array) } });
    expect(await run((uow) => addQuote(uow, workId, { amount: "10", documentId: "00000000-0000-4000-8000-000000000000" }))).toMatchObject({ ok: false, errors: { documentId: expect.any(Array) } });

    await run((uow) => addQuote(uow, workId, { amount: "3.800,00", supplierPartyId: supplierId, quotedOn: "2026-05-01", validUntil: "2026-06-01", documentId }));
    expect(await detail()).toMatchObject({ status: "quoted" });
    expect((await detail()).quotes[0]).toMatchObject({ amountCents: 380_000, status: "received", expired: true, documentTitle: "Preventivo caldaia", supplierName: "Idraulico Esempio" });

    await run((uow) => addQuote(uow, workId, { amount: "3.400,00", quotedOn: "2026-05-05", validUntil: "2026-09-01" }));
    const quotes = (await detail()).quotes;
    expect(await run((uow) => setQuoteStatus(uow, quotes[1]!.id, "boh"))).toMatchObject({ ok: false });
    await run((uow) => setQuoteStatus(uow, quotes[1]!.id, "accepted"));
    await run((uow) => setQuoteStatus(uow, quotes[0]!.id, "rejected"));
    const d = await detail();
    expect(d.status).toBe("approved");
    expect(d.financials).toMatchObject({ acceptedQuotesCents: 340_000, budgetCents: 350_000 });
    expect(d.quotes.map((q) => [q.status, q.expired])).toEqual([["rejected", false], ["accepted", false]]);
    // Il lavoro gia' avviato non torna indietro per un nuovo preventivo.
    await run((uow) => setWorkStatus(uow, workId, "in_progress", TODAY));
    await run((uow) => addQuote(uow, workId, { amount: "100" }));
    expect((await detail()).status).toBe("in_progress");
    const extra = (await detail()).quotes.at(-1)!.id;
    await run((uow) => removeEntry(uow, "quote", extra));
    expect((await detail()).quotes).toHaveLength(2);
  });

  it("avanzamenti e fatture: percentuale facoltativa, data di oggi se manca, fattura pagata o da pagare", async () => {
    expect(await run((uow) => addProgress(uow, workId, { note: "x", percent: "150" }, TODAY))).toMatchObject({ ok: false, errors: { percent: expect.any(Array) } });
    await run((uow) => addProgress(uow, workId, { note: "Smontata la vecchia caldaia" }, TODAY));
    await run((uow) => addProgress(uow, workId, { note: "Installata la nuova", percent: "80", recordedOn: "2026-06-20" }, TODAY));
    expect((await detail()).progress.map((p) => [p.recordedOn, p.percent, p.note])).toEqual([
      [TODAY, null, "Smontata la vecchia caldaia"],
      ["2026-06-20", 80, "Installata la nuova"],
    ]);
    expect((await listWorks(t.db)).find((w) => w.id === workId)).toMatchObject({ lastPercent: 80, acceptedQuotesCents: 340_000 });

    await run((uow) => addInvoice(uow, workId, { number: "FT-12", issuedOn: "2026-06-25", amount: "1.000,00", documentId }));
    await run((uow) => addInvoice(uow, workId, { issuedOn: "2026-07-05", amount: "2.400,00", paidOn: "2026-07-06" }));
    let d = await detail();
    expect(d.financials).toMatchObject({ invoicedCents: 340_000, paidCents: 240_000, unpaidInvoicesCents: 100_000 });
    expect(await run((uow) => setInvoicePaid(uow, d.invoices[0]!.id, "ieri"))).toMatchObject({ ok: false, errors: { paidOn: expect.any(Array) } });
    await run((uow) => setInvoicePaid(uow, d.invoices[0]!.id, "2026-07-10"));
    expect((await detail()).financials).toMatchObject({ paidCents: 340_000, unpaidInvoicesCents: 0 });
    await run((uow) => setInvoicePaid(uow, d.invoices[0]!.id, null));
    d = await detail();
    expect(d.financials.unpaidInvoicesCents).toBe(100_000);

    expect(await run((uow) => removeEntry(uow, "progress", d.progress[0]!.id))).toMatchObject({ ok: true });
    expect(await run((uow) => removeEntry(uow, "invoice", "00000000-0000-4000-8000-000000000000"))).toMatchObject({ ok: false });
    expect(await run((uow) => removeEntry(uow, "altro", d.progress[0]!.id))).toMatchObject({ ok: false });
    expect((await detail()).progress).toHaveLength(1);
  });

  it("le garanzie hanno inizio e fine; la scadenza collegata si crea, e si archivia con la garanzia", async () => {
    expect(await run((uow) => createWarranty(uow, { assetId, title: "Garanzia caldaia" }))).toMatchObject({ ok: false, errors: { endsOn: expect.any(Array) } });
    const id = okValue(await run((uow) => createWarranty(uow, { assetId, workId, title: "Garanzia caldaia", startsOn: "2026-07-05", endsOn: "2028-07-05", supplierPartyId: supplierId, documentId, createDeadline: true }))).id;
    const items = await listWarranties(t.db, { assetId }, TODAY);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "Garanzia caldaia", assetName: "Appartamento A", supplierName: "Idraulico Esempio", workTitle: "Sostituzione caldaia", documentTitle: "Preventivo caldaia", state: "upcoming" });
    expect((await detail()).warranties.map((w) => w.title)).toEqual(["Garanzia caldaia"]);
    const deadline = (await listDeadlines(t.db)).find((d) => d.title.startsWith("Scadenza garanzia: Garanzia caldaia"))!;
    expect(deadline).toMatchObject({ category: "contractual", level: "contract" });

    await run((uow) => setWarrantyArchived(uow, id, true));
    expect(await listWarranties(t.db, { assetId }, TODAY)).toEqual([]);
    expect(await listWarranties(t.db, { assetId, includeArchived: true }, TODAY)).toHaveLength(1);
    expect((await listDeadlines(t.db)).map((d) => d.id)).not.toContain(deadline.id);
    await run((uow) => setWarrantyArchived(uow, id, false));
    expect((await listDeadlines(t.db)).map((d) => d.id)).toContain(deadline.id);
  });

  it("un piano di ispezione e' una scadenza ricorrente: prossima data e ultima eseguita vengono dalle scadenze", async () => {
    const first = addDays(todayInItaly(), 30);
    expect(await run((uow) => createInspectionPlan(uow, { assetId, title: "Controllo impianto termico", intervalMonths: "0", firstDueOn: first }))).toMatchObject({ ok: false, errors: { intervalMonths: expect.any(Array) } });
    const planId = okValue(await run((uow) => createInspectionPlan(uow, { assetId, title: "Controllo impianto termico", intervalMonths: "12", firstDueOn: first, supplierPartyId: supplierId }))).id;
    let plan = (await listInspectionPlans(t.db, { assetId })).find((p) => p.id === planId)!;
    expect(plan).toMatchObject({ assetName: "Appartamento A", supplierName: "Idraulico Esempio", intervalMonths: 12, nextDueOn: first, lastDoneOn: null });

    const occurrence = (await getDeadlineDetail(t.db, plan.deadlineId!, todayInItaly()))!.occurrences.find((o) => o.dueOn === first)!;
    const done = addDays(todayInItaly(), 1);
    expect(await run((uow) => completeOccurrence(uow, occurrence.id, { completedOn: done, completionKind: "owner", reference: "Rapporto n. 1" }))).toMatchObject({ ok: true });
    plan = (await listInspectionPlans(t.db, { assetId })).find((p) => p.id === planId)!;
    expect(plan.lastDoneOn).toBe(done);
    expect(plan.nextDueOn === null || plan.nextDueOn > first).toBe(true);

    await run((uow) => setPlanArchived(uow, planId, true));
    expect((await listInspectionPlans(t.db, { assetId })).map((p) => p.id)).not.toContain(planId);
    expect((await listInspectionPlans(t.db, { assetId, includeArchived: true })).map((p) => p.id)).toContain(planId);
  });

  it("l'audit registra azioni e identificativi, mai testi o importi", async () => {
    const rows = await t.db.select().from(auditLog).where(sql`${auditLog.action} like 'maintenance.%'`);
    expect(new Set(rows.map((r) => r.action)).size).toBeGreaterThan(10);
    const text = JSON.stringify(rows);
    for (const secret of ["Sostituzione caldaia", "Caldaia a condensazione", "Smontata la vecchia", "Installata la nuova", "Garanzia caldaia", "Controllo impianto", "Idraulico Esempio", "FT-12"]) expect(text, secret).not.toContain(secret);
    expect((await t.db.execute(sql`select audit_log_verify() as v`) as unknown as { rows: { v: unknown }[] }).rows[0]!.v).toBeNull();
  });
});
