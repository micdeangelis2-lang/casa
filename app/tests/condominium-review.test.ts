import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { territory } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { createAsset } from "@/modules/assets";
import {
  addMember,
  addResolution,
  createBudget,
  createCondominium,
  createContract,
  createFiscalYear,
  createMeeting,
  createTable,
  filterResolutions,
  generateInstallments,
  getCondominiumDetail,
  getOwnerReview,
  recordPayment,
  resolutionsCsv,
  saveShares,
  statementCsv,
  deliveriesCsv,
  type ReviewLabels,
} from "@/modules/condominium";
import { deliveryFacts, filterRegister, resolutionRegister, yearStatement, type StatementYear } from "@/modules/condominium/domain/owner-review";
import { importIstat } from "@/modules/territory";
import { conclusiveClaims } from "./helpers/neutral";
import { createTestDb, type TestDb } from "./helpers/test-db";

const actor = { type: "owner", id: "o1" } as const;
const owner = { displayName: "Proprietario Prova", email: "prova@example.test" };
const TODAY = "2026-06-15";
const labels: ReviewLabels = { kinds: { ordinary: "Preventivo ordinario", final: "Consuntivo" }, meetingKinds: { ordinary: "Ordinaria" }, outcomes: { approved: "Approvata", not_recorded: "Esito non registrato" }, deliveries: { no_minutes: "Verbale non collegato" } };

describe("controllo con l'amministratore: parte pura", () => {
  const inst = (assetId: string, dueOn: string, amountCents: number, paidCents: number) => ({ assetId, assetName: assetId.toUpperCase(), dueOn, amountCents, paidCents });
  const year: StatementYear = {
    id: "y",
    label: "2025",
    startsOn: "2025-01-01",
    endsOn: "2025-12-31",
    budgets: [
      { id: "b1", title: "Preventivo", kind: "ordinary", totalCents: 100_000, tableId: "t", documentId: null, installments: [inst("a", "2025-03-01", 30_000, 30_000), inst("a", "2025-09-01", 30_000, 10_000), inst("a", "2027-01-01", 5_000, 0)] },
      { id: "b2", title: "Consuntivo", kind: "final", totalCents: 90_000, tableId: "t", documentId: "d", installments: [] },
    ],
  };
  const tables = new Map([["t", { name: "Generale", shares: [{ assetId: "a", milli: 5_000_000 }, { assetId: "z", milli: 5_000_000 }] }]]);

  it("somma rate e versato, separa la parte scaduta e non versata e segnala le tabelle non a 1000", () => {
    const s = yearStatement(year, tables, TODAY);
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0]).toMatchObject({ installments: 3, amountCents: 65_000, paidCents: 40_000, residualCents: 25_000, overdueCents: 20_000, nextDueOn: "2025-09-01" });
    expect(s.tablesNotThousand).toEqual([]);
    const small = yearStatement(year, new Map([["t", { name: "Parziale", shares: [{ assetId: "a", milli: 500_000 }] }]]), TODAY);
    expect(small.tablesNotThousand).toEqual(["Parziale"]);
  });

  it("confronta la quota del consuntivo con il versato sui preventivi e i due totali", () => {
    const s = yearStatement(year, tables, TODAY);
    expect(s.finalVsBudgetsCents).toBe(-10_000);
    const a = s.comparisons.find((c) => c.assetId === "a")!;
    expect(a).toMatchObject({ quotaCents: 45_000, paidOnBudgetsCents: 40_000, differenceCents: 5_000 });
    expect(s.comparisons.reduce((n, c) => n + c.quotaCents, 0)).toBe(90_000);
  });

  it("l'elenco dei documenti dice solo cosa non risulta, con i giorni dall'assemblea", () => {
    const facts = deliveryFacts(
      {
        condominiumId: "c1",
        meetings: [
          { id: "m1", kind: "ordinary", status: "held", meetingOn: "2026-06-01", convocationDocumentId: null, minutesDocumentId: null },
          { id: "m2", kind: "ordinary", status: "cancelled", meetingOn: "2026-05-01", convocationDocumentId: null, minutesDocumentId: null },
        ],
        years: [{ id: "y", label: "2025", endsOn: "2025-12-31", budgets: [{ title: "Preventivo", kind: "ordinary", documentId: null }] }],
        contracts: [{ title: "Ascensore", validTo: "2026-01-31", documentId: null }],
        documentKinds: [],
        tableCount: 0,
        activePolicyCount: 0,
        memberCount: 1,
      },
      TODAY,
    );
    expect(facts.map((f) => f.kind)).toEqual(["no_convocation", "no_minutes", "budget_no_document", "year_ended_no_final", "contract_no_document", "contract_ended", "no_regulation", "no_millesimal_table", "no_policy"]);
    expect(facts.find((f) => f.kind === "no_minutes")).toMatchObject({ daysSince: 14, href: "/condominio/c1?sezione=assemblee" });
  });

  it("il registro delle delibere filtra per esito, anno e seguito mancante", () => {
    const base = { condominiumId: "c1", condominiumName: "Cond", meetingKind: "ordinary", meetingStatus: "held" };
    const res = (id: string, outcome: string, deadlineId: string | null) => ({ id, title: `Delibera ${id}`, outcome, agendaTitle: null, votesFor: null, votesAgainst: null, votesAbstain: null, threshold: null, deadlineId, budgetId: null });
    const rows = resolutionRegister([
      { ...base, meetingId: "m1", meetingOn: "2025-05-01", resolution: res("1", "approved", null), workIds: [] },
      { ...base, meetingId: "m2", meetingOn: "2026-05-01", resolution: res("2", "approved", "d"), workIds: [] },
      { ...base, meetingId: "m2", meetingOn: "2026-05-01", resolution: res("3", "rejected", null), workIds: ["w"] },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["2", "3", "1"]);
    expect(filterRegister(rows, { year: 2026 }).map((r) => r.id)).toEqual(["2", "3"]);
    expect(filterRegister(rows, { outcome: "approved", withoutFollowUp: true }).map((r) => r.id)).toEqual(["1"]);
  });
});

describe("controllo con l'amministratore: sui dati", () => {
  let t: TestDb;
  let condoId: string;
  const run = <T>(work: Parameters<typeof runInUnitOfWork<T>>[2]) => runInUnitOfWork(t.db, actor, work);
  const okValue = <V>(r: { ok: boolean; value?: V }): V => {
    if (!r.ok) throw new Error(`atteso successo: ${JSON.stringify(r)}`);
    return r.value as V;
  };

  beforeAll(async () => {
    t = await createTestDb();
    await run((uow) => importIstat(uow, [{ regionCode: "90", regionName: "Regione di prova", provinceCode: "900", provinceName: "Provincia di prova", provinceSigla: "PP", municipalityCode: "900001", municipalityName: "Comune Uno", cadastralCode: "Z101" }]));
    const municipalityId = (await t.db.select().from(territory).where(eq(territory.kind, "municipality")))[0]!.id;
    const a = okValue(await run((uow) => createAsset(uow, owner, { kind: "dwelling", name: "Unità A", territoryId: municipalityId, inCondominium: true }))).id;
    const b = okValue(await run((uow) => createAsset(uow, owner, { kind: "dwelling", name: "Unità B", territoryId: municipalityId, inCondominium: true }))).id;
    condoId = okValue(await run((uow) => createCondominium(uow, { name: "Condominio Controllo" }))).id;
    await run((uow) => addMember(uow, condoId, { assetId: a }));
    await run((uow) => addMember(uow, condoId, { assetId: b }));
    await run((uow) => createTable(uow, condoId, { name: "Generale" }));
    const tableId = (await getCondominiumDetail(t.db, condoId))!.tables[0]!.id;
    await run((uow) => saveShares(uow, tableId, [{ assetId: a, value: "600" }, { assetId: b, value: "400" }]));
    await run((uow) => createFiscalYear(uow, condoId, { label: "2025", startsOn: "2025-01-01", endsOn: "2025-12-31" }));
    const yearId = (await getCondominiumDetail(t.db, condoId))!.years[0]!.id;
    await run((uow) => createBudget(uow, yearId, { kind: "ordinary", title: "Preventivo 2025", total: "1000", millesimalTableId: tableId }));
    await run((uow) => createBudget(uow, yearId, { kind: "final", title: "Consuntivo 2025", total: "1200", millesimalTableId: tableId }));
    const budget = (await getCondominiumDetail(t.db, condoId))!.years[0]!.budgets.find((x) => x.title === "Preventivo 2025")!;
    await run((uow) => generateInstallments(uow, budget.id, { count: 2, firstDueOn: "2025-02-01", everyMonths: 6 }));
    const first = (await getCondominiumDetail(t.db, condoId))!.years[0]!.budgets.find((x) => x.title === "Preventivo 2025")!.installments.find((i) => i.assetName === "Unità A" && i.number === 1)!;
    await run((uow) => recordPayment(uow, first.id, { paid: "300", paidOn: "2025-02-02" }, TODAY));
    const meeting = okValue(await run((uow) => createMeeting(uow, condoId, { kind: "ordinary", status: "held", meetingOn: "2025-06-01" }))).id;
    await run((uow) => addResolution(uow, meeting, { title: "Approvazione del consuntivo", outcome: "approved" }));
    await run((uow) => createContract(uow, condoId, { kind: "contract", title: "Pulizie scale" }));
  }, 60_000);
  afterAll(async () => t.close());

  it("i versamenti ripartiscono per millesimi e mostrano la parte scaduta non versata", async () => {
    const review = await getOwnerReview(t.db, TODAY);
    const c = review.condominiums.find((x) => x.condominiumId === condoId)!;
    const lines = c.years[0]!.lines;
    const a = lines.find((l) => l.assetName === "Unità A")!;
    expect(a).toMatchObject({ amountCents: 60_000, paidCents: 30_000, residualCents: 30_000, overdueCents: 30_000 });
    expect(c.overdueCents).toBe(30_000 + 20_000 + 20_000); // A: seconda rata, B: due rate
    const cmp = c.years[0]!.comparisons.find((k) => k.assetName === "Unità A")!;
    expect(cmp).toMatchObject({ quotaCents: 72_000, paidOnBudgetsCents: 30_000, differenceCents: 42_000 });
  });

  it("l'elenco dei documenti e il registro delle delibere partono dai dati inseriti", async () => {
    const review = await getOwnerReview(t.db, TODAY);
    const kinds = review.condominiums[0]!.facts.map((f) => f.kind);
    expect(kinds).toEqual(expect.arrayContaining(["no_convocation", "no_minutes", "budget_no_document", "contract_no_document", "no_regulation", "no_policy"]));
    expect(kinds).not.toContain("no_millesimal_table");
    expect(review.resolutions).toHaveLength(1);
    expect(filterResolutions(review.resolutions, { withoutFollowUp: true })).toHaveLength(1);
    expect(filterResolutions(review.resolutions, { outcome: "rejected" })).toHaveLength(0);
  });

  it("i CSV hanno l'avvertenza, il BOM e nessun verdetto", async () => {
    const review = await getOwnerReview(t.db, TODAY);
    const csvs = [statementCsv(review, undefined, labels), deliveriesCsv(review, condoId, labels), resolutionsCsv(review.resolutions, labels)];
    for (const csv of csvs) {
      expect(csv.startsWith("﻿")).toBe(true);
      expect(conclusiveClaims(csv)).toEqual([]);
    }
    expect(csvs[0]).toContain("Unità A;");
    expect(csvs[0]).toContain("Unità A;2;600;300;300;300;2025-08-01");
    expect(csvs[2]).toContain("Approvazione del consuntivo");
  });
});
