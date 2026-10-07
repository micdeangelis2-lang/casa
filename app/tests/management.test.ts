import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { territory } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { createAsset } from "@/modules/assets";
import { createParty } from "@/modules/directory";
import { addCode, addReport, createLetting, generateRentSchedule, getLettingDetail, recordRentPayment } from "@/modules/lettings";
import { addInvoice, createWork, setWorkStatus } from "@/modules/maintenance";
import { importIstat } from "@/modules/territory";
import { buildCalendar, buildStatement, compareDeclared, workStage } from "@/modules/management/domain/management";
import { createMandate, getManagementCalendar, getManagementStatement, listMandates, statementCsv } from "@/modules/management";
import { statementParams } from "@/lib/gestore-params";
import { createTestDb, type TestDb } from "./helpers/test-db";

const actor = { type: "owner", id: "o1" } as const;
const owner = { displayName: "Proprietario Prova", email: "prova@example.test" };

describe("gestione affidata: dominio", () => {
  it("le fasi degli interventi seguono lo stato scritto dal proprietario", () => {
    expect(["planned", "quoted", "approved", "in_progress", "completed", "cancelled"].map(workStage)).toEqual(["requested", "requested", "approved", "approved", "executed", "cancelled"]);
  });

  it("il confronto con il gestore e' comunicato meno registrato", () => {
    expect(compareDeclared(150_000, 140_000)).toEqual({ declaredCents: 150_000, registeredCents: 140_000, differenceCents: 10_000 });
    expect(compareDeclared(0, 500).differenceCents).toBe(-500);
  });

  it("i parametri dell'indirizzo ripiegano su un periodo valido", () => {
    const get = (v: Record<string, string>) => (k: string) => v[k] ?? "";
    expect(statementParams(get({}), "2026-10-06")).toEqual({ assetId: null, from: "2026-01-01", to: "2026-10-06" });
    expect(statementParams(get({ dal: "2026-05-01", al: "2026-02-01" }), "2026-10-06")).toMatchObject({ from: "2026-01-01", to: "2026-10-06" });
    expect(statementParams(get({ dal: "2026-02-30" }), "2026-10-06").from).toBe("2026-01-01");
  });

  const base = { from: "2026-01-01", to: "2026-12-31", today: "2026-10-06", contracts: [], rents: [], receipts: [], payments: [], works: [], codes: [], reports: [], mandates: [] };

  it("il rendiconto somma canoni e movimenti del periodo e segnala solo fatti dai dati", () => {
    const s = buildStatement({
      ...base,
      rents: [
        { lettingId: "l", lettingTitle: "Contratto", dueOn: "2026-08-01", amountCents: 50_000, paidCents: 50_000, paidOn: "2026-08-02", hasProof: false },
        { lettingId: "l", lettingTitle: "Contratto", dueOn: "2026-09-01", amountCents: 50_000, paidCents: 20_000, paidOn: "2026-09-03", hasProof: true },
        { lettingId: "l", lettingTitle: "Contratto", dueOn: "2025-12-01", amountCents: 99_900, paidCents: 0, paidOn: null, hasProof: false },
      ],
      receipts: [{ area: "lettings", date: "2026-08-02", label: "Contratto", amountCents: 50_000 }],
      payments: [{ area: "taxes", date: "2026-03-01", label: "Imposta", amountCents: 12_000 }],
      codes: [{ lettingTitle: "Contratto", label: "Codice", value: "X1", issuer: null, validUntil: "2026-01-31", state: "expired" }],
    });
    expect(s.rents).toHaveLength(2);
    expect(s.rentTotals).toEqual({ dueCents: 100_000, paidCents: 70_000, overdueCents: 30_000 });
    expect(s.totals).toEqual({ receiptsCents: 50_000, paymentsCents: 12_000, differenceCents: 38_000 });
    expect(s.checks.map((c) => c.key)).toEqual(["overdueRents", "paidRentsNoProof", "expiredCodes"]);
  });

  it("senza dati non ci sono punti da rivedere", () => {
    expect(buildStatement(base).checks).toEqual([]);
  });

  it("il calendario non duplica le voci con scadenza collegata e tiene i ritardi aperti", () => {
    const c = buildCalendar({
      today: "2026-10-06",
      days: 90,
      occurrences: [{ id: "o1", deadlineId: "d1", dueOn: "2026-10-20", title: "Canone 3/12", assetName: "A" }],
      lettings: [
        {
          id: "l1",
          title: "Contratto",
          type: "residential",
          status: "active",
          assetName: "A",
          startsOn: "2026-01-01",
          endsOn: "2026-11-30",
          deadlineId: null,
          rents: [
            { dueOn: "2026-10-20", amountCents: 100, paidCents: 0, deadlineId: "d1" },
            { dueOn: "2026-10-01", amountCents: 100, paidCents: 0, deadlineId: null },
            { dueOn: "2026-11-01", amountCents: 100, paidCents: 100, deadlineId: null },
            { dueOn: "2027-06-01", amountCents: 100, paidCents: 0, deadlineId: null },
          ],
          reports: [{ title: "Comunicazione", dueOn: "2026-10-10", doneOn: null, deadlineId: null }],
          codes: [{ label: "Codice", validUntil: "2026-12-01" }],
        },
        { id: "l2", title: "Breve", type: "short_term", status: "ended", assetName: "A", startsOn: "2026-01-01", endsOn: "2026-02-01", deadlineId: null, rents: [], reports: [], codes: [] },
      ],
      warranties: [],
      works: [{ id: "w1", title: "Caldaia", assetName: "A", status: "approved", scheduledOn: "2026-10-30" }],
    });
    expect(c.events.map((e) => [e.kind, e.date, e.overdue])).toEqual([
      ["rent", "2026-10-01", true],
      ["report", "2026-10-10", false],
      ["deadline", "2026-10-20", false],
      ["work", "2026-10-30", false],
      ["contractEnd", "2026-11-30", false],
      ["code", "2026-12-01", false],
    ]);
    expect(c.occupations.map((o) => o.id)).toEqual(["l1"]);
    expect(c.until).toBe("2027-01-04");
  });
});

describe("gestione affidata: dai moduli", () => {
  let t: TestDb;
  let assetId: string;
  let otherAssetId: string;
  let managerId: string;
  let lettingId: string;

  const run = <V>(work: Parameters<typeof runInUnitOfWork<V>>[2]) => runInUnitOfWork(t.db, actor, work);
  const okValue = <V>(r: { ok: boolean; value?: V }): V => {
    if (!r.ok) throw new Error(`atteso successo: ${JSON.stringify(r)}`);
    return r.value as V;
  };

  beforeAll(async () => {
    t = await createTestDb();
    await run((uow) => importIstat(uow, [{ regionCode: "90", regionName: "Regione di prova", provinceCode: "900", provinceName: "Provincia di prova", provinceSigla: "PP", municipalityCode: "900001", municipalityName: "Comune Uno", cadastralCode: "Z101" }]));
    const municipalityId = (await t.db.select().from(territory).where(eq(territory.kind, "municipality")))[0]!.id;
    assetId = okValue(await run((uow) => createAsset(uow, owner, { kind: "dwelling", name: "Appartamento Gestito", territoryId: municipalityId }))).id;
    otherAssetId = okValue(await run((uow) => createAsset(uow, owner, { kind: "garage", name: "Box Altro", territoryId: municipalityId }))).id;
    managerId = okValue(await run((uow) => createParty(uow, { kind: "company", displayName: "Gestore Prova", roles: [] }))).id;

    lettingId = okValue(await run((uow) => createLetting(uow, { assetId, type: "residential", title: "Contratto Gestito", startsOn: "2026-01-01", endsOn: "2026-12-31", monthlyRent: "500,00", managerPartyId: managerId }))).id;
    okValue(await run((uow) => generateRentSchedule(uow, lettingId, { firstDueOn: "2026-01-05", months: 12, amount: "500,00" })));
    const detail = (await getLettingDetail(t.db, lettingId, "2026-10-06"))!;
    await run((uow) => recordRentPayment(uow, detail.rents[0]!.id, { paid: "500,00", paidOn: "2026-01-06" }, "2026-10-06"));
    await run((uow) => recordRentPayment(uow, detail.rents[1]!.id, { paid: "200,00", paidOn: "2026-02-06" }, "2026-10-06"));
    await run((uow) => addCode(uow, lettingId, { label: "Codice identificativo", value: "ABC123", validUntil: "2026-10-20" }));
    await run((uow) => addReport(uow, lettingId, { kind: "communication", title: "Comunicazione periodica", dueOn: "2026-09-30" }));

    const work = okValue(await run((uow) => createWork(uow, { assetId, title: "Riparazione caldaia", status: "approved", scheduledOn: "2026-10-15" }))).id;
    await run((uow) => addInvoice(uow, work, { issuedOn: "2026-05-01", amount: "300,00", paidOn: "2026-05-05" }));
    await run((uow) => addInvoice(uow, work, { issuedOn: "2026-06-01", amount: "100,00" }));
    await run((uow) => setWorkStatus(uow, work, "approved", "2026-10-06"));
  });

  afterAll(async () => {
    await t.close();
  });

  it("registra un mandato come scadenza contrattuale e lo elenca con il compenso dichiarato", async () => {
    const created = okValue(await run((uow) => createMandate(uow, { managerPartyId: managerId, assetId, endsOn: "2026-11-15", compensation: "8% dei canoni incassati" })));
    expect(created.id).toBeTruthy();
    const list = await listMandates(t.db, "2026-10-06");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ managerName: "Gestore Prova", assetName: "Appartamento Gestito", endsOn: "2026-11-15", compensation: "8% dei canoni incassati", state: "expiring" });
    expect(await listMandates(t.db, "2026-10-06", otherAssetId)).toEqual([]);
  });

  it("rifiuta un mandato senza gestore valido, con data non valida o con un immobile inesistente", async () => {
    const bad = await run((uow) => createMandate(uow, { managerPartyId: "", endsOn: "2026-11-15" }));
    expect(bad.ok).toBe(false);
    const noDate = await run((uow) => createMandate(uow, { managerPartyId: managerId, endsOn: "" }));
    expect(noDate.ok).toBe(false);
    const noAsset = await run((uow) => createMandate(uow, { managerPartyId: managerId, assetId: "11111111-1111-4111-8111-111111111111", endsOn: "2026-11-15" }));
    expect(noAsset.ok).toBe(false);
  });

  it("il rendiconto dell'immobile riporta canoni, interventi, codici e adempimenti, e non mescola gli altri immobili", async () => {
    const s = await getManagementStatement(t.db, { assetId, from: "2026-01-01", to: "2026-12-31" }, "2026-10-06");
    expect(s.assetName).toBe("Appartamento Gestito");
    expect(s.rents).toHaveLength(12);
    expect(s.rentTotals.paidCents).toBe(70_000);
    expect(s.totals.receiptsCents).toBe(70_000 - 0);
    expect(s.totals.paymentsCents).toBe(30_000);
    expect(s.works[0]).toMatchObject({ title: "Riparazione caldaia", stage: "approved", invoicedCents: 40_000, paidCents: 30_000 });
    expect(s.codes[0]).toMatchObject({ value: "ABC123", state: "expiring" });
    expect(s.reports[0]).toMatchObject({ title: "Comunicazione periodica", overdue: true });
    expect(s.mandates).toHaveLength(1);
    expect(s.checks.map((c) => c.key)).toEqual(expect.arrayContaining(["overdueRents", "paidRentsNoProof", "unpaidInvoices", "expiringCodes", "overdueReports", "contractsEnding", "mandateExpiring"]));

    const other = await getManagementStatement(t.db, { assetId: otherAssetId, from: "2026-01-01", to: "2026-12-31" }, "2026-10-06");
    expect(other.rents).toEqual([]);
    expect(other.totals).toEqual({ receiptsCents: 0, paymentsCents: 0, differenceCents: 0 });
  });

  it("il periodo restringe canoni e incassi", async () => {
    const s = await getManagementStatement(t.db, { assetId, from: "2026-02-01", to: "2026-02-28" }, "2026-10-06");
    expect(s.rents).toHaveLength(1);
    expect(s.totals.receiptsCents).toBe(20_000);
  });

  it("il CSV ha le sezioni, la virgola decimale e il BOM", async () => {
    const s = await getManagementStatement(t.db, { assetId, from: "2026-01-01", to: "2026-12-31" }, "2026-10-06");
    const csv = statementCsv(s, { title: "Rendiconto", note: "nota", area: { taxes: "Tributi" }, state: { paid: "Incassato" }, stage: { approved: "Approvato" } });
    expect(csv.startsWith(String.fromCharCode(0xfeff))).toBe(true);
    expect(csv).toContain("Canoni con scadenza nel periodo");
    expect(csv).toContain("Riparazione caldaia;Approvato;;0;400;300");
    expect(csv).toContain("ABC123");
    expect(csv).toContain("Compenso dichiarato");
  });

  it("il calendario unisce scadenze, canoni, adempimenti e lavori dei prossimi 90 giorni", async () => {
    const c = await getManagementCalendar(t.db, {}, "2026-10-06");
    const kinds = new Set(c.events.map((e) => e.kind));
    expect(kinds).toEqual(new Set(["rent", "report", "work", "code", "contractEnd", "deadline"]));
    expect(c.occupations.map((o) => o.title)).toEqual(["Contratto Gestito"]);
    const none = await getManagementCalendar(t.db, { assetId: otherAssetId }, "2026-10-06");
    expect(none.events.filter((e) => e.kind !== "deadline")).toEqual([]);
    expect(none.occupations).toEqual([]);
  });
});
