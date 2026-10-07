import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { eq, sql } from "drizzle-orm";
import { auditLog, lettingRent, lettingRentPayment, territory } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { LocalFileStorage } from "@/platform/storage";
import { createAsset } from "@/modules/assets";
import { createBudget, createCondominium, createFiscalYear, createTable, generateInstallments, getCondominiumDetail, recordPayment as recordInstallmentPayment, saveShares } from "@/modules/condominium";
import { getDeadlineDetail } from "@/modules/deadlines";
import { createDocument, listDocumentCategories } from "@/modules/documents";
import { economyEntries, getDossier } from "@/modules/economy";
import { addRentReceipt, createLetting, generateRentSchedule, getLettingDetail, lettingLedger, recordRentPayment, removeRentReceipt } from "@/modules/lettings";
import { createObligation, createTaxType, getObligationDetail, recordPayment as recordTaxPayment, taxLedger } from "@/modules/taxes";
import { importIstat } from "@/modules/territory";
import { createTestDb, type TestDb } from "./helpers/test-db";
import { makePdf } from "./helpers/sample-pdf";

const actor = { type: "owner", id: "o1" } as const;
const owner = { displayName: "Proprietario Prova", email: "prova@example.test" };
const TODAY = "2026-06-15";

describe("prove di pagamento e incassi", () => {
  let t: TestDb;
  let dir: string;
  let storage: LocalFileStorage;
  let assetId: string;
  let assetB: string;
  let proofId: string;
  const run = <T>(work: Parameters<typeof runInUnitOfWork<T>>[2]) => runInUnitOfWork(t.db, actor, work);
  const okValue = <V>(r: { ok: boolean; value?: V }): V => {
    if (!r.ok) throw new Error(`atteso successo: ${JSON.stringify(r)}`);
    return r.value as V;
  };

  beforeAll(async () => {
    t = await createTestDb();
    dir = await mkdtemp(join(tmpdir(), "proofs-test-"));
    storage = new LocalFileStorage(dir);
    await run((uow) => importIstat(uow, [{ regionCode: "90", regionName: "Regione di prova", provinceCode: "900", provinceName: "Provincia di prova", provinceSigla: "PP", municipalityCode: "900001", municipalityName: "Comune Uno", cadastralCode: "Z101" }]));
    const municipalityId = (await t.db.select().from(territory).where(eq(territory.kind, "municipality")))[0]!.id;
    assetId = okValue(await run((uow) => createAsset(uow, owner, { kind: "dwelling", name: "Appartamento A", territoryId: municipalityId, inCondominium: true }))).id;
    assetB = okValue(await run((uow) => createAsset(uow, owner, { kind: "dwelling", name: "Appartamento B", territoryId: municipalityId, inCondominium: true }))).id;
    const categoryId = (await listDocumentCategories(t.db))[0]!.id;
    proofId = okValue(await run((uow) => createDocument(uow, { title: "Ricevuta di prova", categoryId }, { name: "ricevuta.pdf", bytes: makePdf("ricevuta") }, storage))).id;
  }, 60_000);
  afterAll(async () => {
    await t.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("canoni: piu' incassi con data, modalita' e documento; il totale e la scadenza seguono; il registro ha una riga per incasso", async () => {
    const lettingId = okValue(await run((uow) => createLetting(uow, { assetId, type: "residential", title: "Locazione prova incassi", startsOn: "2026-06-01", endsOn: "2030-05-31", monthlyRent: "650,00" }))).id;
    await run((uow) => generateRentSchedule(uow, lettingId, { firstDueOn: "2026-06-01", months: "2", amount: "650,00", createDeadlines: true }));
    const detail = async () => (await getLettingDetail(t.db, lettingId, TODAY))!;
    const june = (await detail()).rents[0]!;

    expect(await run((uow) => addRentReceipt(uow, june.id, { amount: "0", paidOn: "2026-06-03" }, TODAY))).toMatchObject({ ok: false, errors: { amount: expect.any(Array) } });
    expect(await run((uow) => addRentReceipt(uow, june.id, { amount: "10", documentId: "00000000-0000-4000-8000-000000000000" }, TODAY))).toMatchObject({ ok: false, errors: { documentId: expect.any(Array) } });
    expect(await run((uow) => addRentReceipt(uow, "00000000-0000-4000-8000-000000000000", { amount: "10" }, TODAY))).toMatchObject({ ok: false });

    await run((uow) => addRentReceipt(uow, june.id, { amount: "300,00", paidOn: "2026-06-03", method: "SEGRETO-contanti" }, TODAY));
    expect((await detail()).rents[0]).toMatchObject({ paidCents: 30_000, state: "overdue", paidOn: "2026-06-03", documentId: null });
    expect((await getDeadlineDetail(t.db, june.deadlineId!, TODAY))!.occurrences[0]!.status).toBe("open");

    await run((uow) => addRentReceipt(uow, june.id, { amount: "350,00", paidOn: "2026-06-09", method: "bonifico", documentId: proofId }, TODAY));
    const after = (await detail()).rents[0]!;
    expect(after).toMatchObject({ paidCents: 65_000, state: "paid", paidOn: "2026-06-09", documentId: proofId, documentTitle: "Ricevuta di prova" });
    expect(after.receipts.map((r) => [r.paidOn, r.amountCents, r.method, r.documentTitle])).toEqual([
      ["2026-06-03", 30_000, "SEGRETO-contanti", null],
      ["2026-06-09", 35_000, "bonifico", "Ricevuta di prova"],
    ]);
    expect((await getDeadlineDetail(t.db, june.deadlineId!, TODAY))!.occurrences[0]).toMatchObject({ status: "done", completedOn: "2026-06-09" });

    // Il registro dei movimenti ha un movimento per incasso, ciascuno con la sua prova (o senza).
    const ledger = (await lettingLedger(t.db, "2026-06-01", "2026-06-30")).sort((a, b) => a.date.localeCompare(b.date));
    expect(ledger.map((e) => [e.date, e.amountCents, e.documentId])).toEqual([["2026-06-03", 30_000, null], ["2026-06-09", 35_000, proofId]]);

    // Togliere un incasso riapre la scadenza che il canone coperto aveva chiuso.
    await run((uow) => removeRentReceipt(uow, after.receipts[1]!.id, TODAY));
    expect((await detail()).rents[0]).toMatchObject({ paidCents: 30_000, paidOn: "2026-06-03", documentId: null });
    expect((await getDeadlineDetail(t.db, june.deadlineId!, TODAY))!.occurrences[0]!.status).toBe("open");
    expect(await run((uow) => removeRentReceipt(uow, after.receipts[1]!.id, TODAY))).toMatchObject({ ok: false });

    // «Imposta il totale» sostituisce gli incassi con uno solo; con zero li toglie tutti.
    await run((uow) => recordRentPayment(uow, june.id, { paid: "650,00", paidOn: "2026-06-10", documentId: proofId }, TODAY));
    expect((await detail()).rents[0]!.receipts).toHaveLength(1);
    await run((uow) => recordRentPayment(uow, june.id, { paid: "0" }, TODAY));
    expect((await detail()).rents[0]).toMatchObject({ paidCents: 0, paidOn: null, documentId: null, receipts: [] });

    // L'audit non riporta la modalita' scritta dal proprietario.
    const audits = await t.db.select().from(auditLog).where(eq(auditLog.entityId, lettingId));
    expect(audits.some((a) => a.action === "letting.rent.receipt.add")).toBe(true);
    expect(JSON.stringify(audits.map((a) => a.diff))).not.toContain("SEGRETO");
  });

  it("la migrazione porta gli importi pagati gia' registrati negli incassi", async () => {
    const migration = await readFile(resolve(__dirname, "../drizzle/0017_payment_proofs.sql"), "utf8");
    const backfill = migration.slice(migration.indexOf('INSERT INTO "letting_rent_payment"'));
    const lettingId = okValue(await run((uow) => createLetting(uow, { assetId: assetB, type: "residential", title: "Locazione dati vecchi", startsOn: "2026-01-01", endsOn: "2030-12-31" }))).id;
    const [rent] = await t.db.insert(lettingRent).values({ lettingId, dueOn: "2026-01-01", amountCents: 50_000, paidCents: 50_000, paidOn: "2026-01-05", documentId: proofId }).returning();
    const [unpaid] = await t.db.insert(lettingRent).values({ lettingId, dueOn: "2026-02-01", amountCents: 50_000 }).returning();
    await t.db.execute(sql.raw(backfill));
    const rows = await t.db.select().from(lettingRentPayment).where(eq(lettingRentPayment.rentId, rent!.id));
    expect(rows).toMatchObject([{ paidOn: "2026-01-05", amountCents: 50_000, documentId: proofId }]);
    expect(await t.db.select().from(lettingRentPayment).where(eq(lettingRentPayment.rentId, unpaid!.id))).toEqual([]);
  });

  it("un canone con importo pagato ma senza incassi (archivio precedente) conta come un incasso e non si perde aggiungendone un altro", async () => {
    const lettingId = okValue(await run((uow) => createLetting(uow, { assetId, type: "residential", title: "Locazione archivio vecchio", startsOn: "2026-01-01", endsOn: "2030-12-31" }))).id;
    const [rent] = await t.db.insert(lettingRent).values({ lettingId, dueOn: "2026-04-01", amountCents: 70_000, paidCents: 40_000, paidOn: "2026-04-04" }).returning();
    const inApril = (await lettingLedger(t.db, "2026-04-01", "2026-04-30")).filter((e) => e.refId === lettingId);
    expect(inApril.map((e) => [e.date, e.amountCents])).toEqual([["2026-04-04", 40_000]]);

    await run((uow) => addRentReceipt(uow, rent!.id, { amount: "300,00", paidOn: "2026-04-10" }, TODAY));
    const detail = (await getLettingDetail(t.db, lettingId, TODAY))!.rents[0]!;
    expect(detail.paidCents).toBe(70_000);
    expect(detail.receipts.map((r) => [r.paidOn, r.amountCents])).toEqual([["2026-04-04", 40_000], ["2026-04-10", 30_000]]);
  });

  it("tributi: natura scelta dal proprietario, sanzioni e interessi dichiarati (non negativi, entro l'importo), nel registro e nel dossier", async () => {
    const typeId = okValue(await run((uow) => createTaxType(uow, { name: "Tributo prova", kind: "tax" }))).id;
    const obligationId = okValue(await run((uow) => createObligation(uow, { assetId, taxTypeId: typeId, year: 2026, label: "Saldo" }))).id;
    expect(await run((uow) => recordTaxPayment(uow, obligationId, { paidOn: "2026-06-10", amount: "100", kind: "boh" }))).toMatchObject({ ok: false, errors: { kind: expect.any(Array) } });
    expect(await run((uow) => recordTaxPayment(uow, obligationId, { paidOn: "2026-06-10", amount: "100", penalty: "-5" }))).toMatchObject({ ok: false, errors: { penalty: expect.any(Array) } });
    expect(await run((uow) => recordTaxPayment(uow, obligationId, { paidOn: "2026-06-10", amount: "100", penalty: "80", interest: "30" }))).toMatchObject({ ok: false, errors: { penalty: ["Sanzioni e interessi dichiarati superano l'importo pagato"] } });

    await run((uow) => recordTaxPayment(uow, obligationId, { paidOn: "2026-06-10", amount: "100,00" }));
    await run((uow) => recordTaxPayment(uow, obligationId, { paidOn: "2026-06-11", amount: "130,00", kind: "late_payment_correction", penalty: "20,00", interest: "10,00", documentId: proofId }));
    const list = (await getObligationDetail(t.db, obligationId, TODAY))!.paymentList;
    expect(list.map((p) => [p.kind, p.penaltyCents, p.interestCents])).toEqual([["ordinary", null, null], ["late_payment_correction", 2_000, 1_000]]);

    const ledger = await taxLedger(t.db, "2026-06-01", "2026-06-30");
    expect(ledger.map((e) => e.taxDetail)).toEqual([
      { kind: "ordinary", penaltyCents: null, interestCents: null },
      { kind: "late_payment_correction", penaltyCents: 2_000, interestCents: 1_000 },
    ]);
    const dossier = await getDossier(t.db, 2026, TODAY);
    expect(dossier.movements.filter((m) => m.area === "taxes").map((m) => m.taxDetail?.kind)).toEqual(["ordinary", "late_payment_correction"]);

    const audits = await t.db.select().from(auditLog).where(eq(auditLog.entityId, obligationId));
    expect(audits.filter((a) => a.action === "tax.payment.record").map((a) => (a.diff as { kind?: string }).kind)).toContain("late_payment_correction");
  });

  it("condominio: la prova di una rata si collega, si conserva e arriva nel registro e nel dossier", async () => {
    const condoId = okValue(await run((uow) => createCondominium(uow, { name: "Condominio prove" }))).id;
    for (const a of [assetId, assetB]) await t.db.execute(sql`insert into condo_membership (condominium_id, asset_id) values (${condoId}, ${a}) on conflict do nothing`);
    await run((uow) => createTable(uow, condoId, { name: "Generale" }));
    const tableId = (await getCondominiumDetail(t.db, condoId))!.tables[0]!.id;
    okValue(await run((uow) => saveShares(uow, tableId, [{ assetId, value: "600" }, { assetId: assetB, value: "400" }])));
    okValue(await run((uow) => createFiscalYear(uow, condoId, { label: "2026", startsOn: "2026-01-01", endsOn: "2026-12-31" })));
    const yearId = (await getCondominiumDetail(t.db, condoId))!.years[0]!.id;
    okValue(await run((uow) => createBudget(uow, yearId, { kind: "ordinary", title: "Preventivo prove", total: "1.000,00", millesimalTableId: tableId })));
    const budgetId = (await getCondominiumDetail(t.db, condoId))!.years[0]!.budgets[0]!.id;
    okValue(await run((uow) => generateInstallments(uow, budgetId, { count: 2, firstDueOn: "2026-03-01", everyMonths: 3 })));
    const rows = () => getCondominiumDetail(t.db, condoId).then((d) => d!.years[0]!.budgets[0]!.installments);
    const [first, second] = (await rows()).filter((i) => i.assetName === "Appartamento A");

    expect(await run((uow) => recordInstallmentPayment(uow, first!.id, { paid: "300", paidOn: "2026-03-02", documentId: "00000000-0000-4000-8000-000000000000" }, TODAY))).toMatchObject({ ok: false, errors: { documentId: expect.any(Array) } });
    await run((uow) => recordInstallmentPayment(uow, first!.id, { paid: "300", paidOn: "2026-03-02", documentId: proofId }, TODAY));
    await run((uow) => recordInstallmentPayment(uow, second!.id, { paid: "300", paidOn: "2026-06-02" }, TODAY));
    expect((await rows()).find((i) => i.id === first!.id)).toMatchObject({ documentId: proofId, documentTitle: "Ricevuta di prova" });

    // Correggere l'importo senza indicare un documento conserva quello gia' collegato.
    await run((uow) => recordInstallmentPayment(uow, first!.id, { paid: "250", paidOn: "2026-03-02" }, TODAY));
    expect((await rows()).find((i) => i.id === first!.id)!.documentId).toBe(proofId);

    const entries = (await economyEntries(t.db, "2026-01-01", "2026-12-31")).filter((e) => e.area === "condominium");
    expect(entries.map((e) => [e.date, e.documentId])).toEqual([["2026-03-02", proofId], ["2026-06-02", null]]);
    const dossier = await getDossier(t.db, 2026, TODAY);
    const proofs = dossier.movements.filter((m) => m.area === "condominium").map((m) => m.proof);
    expect(proofs).toEqual(["present", "missing"]);
    expect(dossier.gaps.filter((g) => g.kind === "payment_no_proof" && g.subject.startsWith("Rata"))).toHaveLength(1);

    // Senza importo pagato non resta nessuna prova.
    await run((uow) => recordInstallmentPayment(uow, first!.id, { paid: "0" }, TODAY));
    expect((await rows()).find((i) => i.id === first!.id)!.documentId).toBeNull();
  });
});
