import { describe, expect, it } from "vitest";
import { deliveryFacts, filterRegister, resolutionRegister, yearStatement, type DeliveryInput, type ResolutionInput, type StatementBudget, type StatementYear } from "@/modules/condominium/domain/owner-review";

const TODAY = "2026-06-15";
const inst = (assetId: string, dueOn: string, amountCents: number, paidCents: number) => ({ assetId, assetName: `Unita ${assetId}`, dueOn, amountCents, paidCents });
const budget = (o: Partial<StatementBudget> & { id: string }): StatementBudget => ({ title: o.id, kind: "ordinary", totalCents: 0, tableId: null, documentId: null, installments: [], ...o });
const year = (budgets: StatementBudget[]): StatementYear => ({ id: "y", label: "2026", startsOn: "2026-01-01", endsOn: "2026-12-31", budgets });

describe("condominio, estratto dell'esercizio: casi limite", () => {
  it("esercizio senza preventivi: tutto a zero e nessun confronto", () => {
    const s = yearStatement(year([]), new Map(), TODAY);
    expect(s).toMatchObject({ lines: [], amountCents: 0, paidCents: 0, overdueCents: 0, finalVsBudgetsCents: null, comparisons: [], tablesNotThousand: [] });
  });

  it("rate: il giorno della scadenza non e' ancora in ritardo; versato in piu' da' residuo negativo ma non scaduto; la prossima e' la piu' vicina ancora aperta", () => {
    const s = yearStatement(
      year([budget({ id: "B", totalCents: 300, installments: [inst("a", TODAY, 100, 0), inst("a", "2026-06-14", 100, 30), inst("a", "2026-03-01", 100, 150), inst("a", "2026-09-01", 100, 0)] })]),
      new Map(),
      TODAY,
    );
    const line = s.lines[0]!;
    expect(line.overdueCents).toBe(70);
    expect(line.residualCents).toBe(100 + 70 - 50 + 100);
    expect(line.nextDueOn).toBe("2026-06-14");
    expect(line.installments).toBe(4);
  });

  it("un bilancio senza rate non produce righe; le righe si ordinano per titolo e per unita'", () => {
    const s = yearStatement(
      year([budget({ id: "Z", title: "Zeta", installments: [inst("b", "2026-07-01", 1, 0), inst("a", "2026-07-01", 1, 0)] }), budget({ id: "V", title: "Vuoto" }), budget({ id: "A", title: "Alfa", installments: [inst("a", "2026-07-01", 1, 1)] })]),
      new Map(),
      TODAY,
    );
    expect(s.lines.map((l) => `${l.budgetTitle}/${l.assetName}`)).toEqual(["Alfa/Unita a", "Zeta/Unita a", "Zeta/Unita b"]);
    expect(s.lines[0]!.nextDueOn).toBeNull();
  });

  it("consuntivo: senza tabella, con tabella assente o senza quote non si fa il confronto; la differenza e' quota meno versato", () => {
    const tables = new Map([["t1", { name: "Generale", shares: [{ assetId: "a", milli: 6_000_000 }, { assetId: "b", milli: 4_000_000 }] }], ["t0", { name: "Vuota", shares: [] }]]);
    const s = yearStatement(
      year([
        budget({ id: "P", totalCents: 1000, installments: [inst("a", "2026-02-01", 500, 500), inst("b", "2026-02-01", 500, 100)] }),
        budget({ id: "C1", kind: "final", totalCents: 1000, tableId: "t1" }),
        budget({ id: "C2", kind: "final", totalCents: 50, tableId: null }),
        budget({ id: "C3", kind: "final", totalCents: 50, tableId: "t0" }),
        budget({ id: "C4", kind: "final", totalCents: 50, tableId: "inesistente" }),
      ]),
      tables,
      TODAY,
    );
    expect(s.comparisons.map((c) => [c.assetId, c.quotaCents, c.paidOnBudgetsCents, c.differenceCents])).toEqual([["a", 600, 500, 100], ["b", 400, 100, 300]]);
    expect(s.finalVsBudgetsCents).toBe(1150 - 1000);
    expect(s.tablesNotThousand).toEqual(["Vuota"]);
  });

  it("consuntivo senza preventivi: nessuna differenza calcolata; il nome dell'unita' si ricava dalle rate del consuntivo", () => {
    const tables = new Map([["t1", { name: "Generale", shares: [{ assetId: "a", milli: 10_000_000 }] }]]);
    const s = yearStatement(year([budget({ id: "C", kind: "final", totalCents: 100, tableId: "t1", installments: [inst("a", "2026-02-01", 100, 0)] })]), tables, TODAY);
    expect(s.finalVsBudgetsCents).toBeNull();
    expect(s.comparisons[0]).toMatchObject({ assetName: "Unita a", quotaCents: 100, paidOnBudgetsCents: 0 });
  });

  it("con ambito «intero edificio» la quota del proprietario e' solo la sua parte dei millesimi", () => {
    const tables = new Map([["t1", { name: "Generale", shares: [{ assetId: "a", milli: 1_000_000 }], othersMilli: 9_000_000 }]]);
    const s = yearStatement(year([budget({ id: "P", installments: [inst("a", "2026-02-01", 10, 10)] }), budget({ id: "C", kind: "final", totalCents: 1000, tableId: "t1", scope: "building" })]), tables, TODAY);
    expect(s.comparisons[0]!.quotaCents).toBe(100);
  });
});

describe("condominio, documenti consegnati: casi limite", () => {
  const input = (o: Partial<DeliveryInput> = {}): DeliveryInput => ({ condominiumId: "c1", meetings: [], years: [], contracts: [], documentKinds: ["regulation", "millesimal"], tableCount: 1, activePolicyCount: 1, memberCount: 1, ...o });

  it("tutto presente: nessuna segnalazione; senza dati dell'amministratore e senza polizze segnala solo se ci sono condomini", () => {
    expect(deliveryFacts(input(), TODAY)).toEqual([]);
    expect(deliveryFacts(input({ memberCount: 0, activePolicyCount: 0 }), TODAY)).toEqual([]);
    expect(deliveryFacts(input({ memberCount: 3, activePolicyCount: 0 }), TODAY).map((f) => f.kind)).toEqual(["no_policy"]);
  });

  it("regolamento e tabelle: una tabella registrata o un documento millesimale bastano", () => {
    expect(deliveryFacts(input({ documentKinds: [], tableCount: 0 }), TODAY).map((f) => f.kind)).toEqual(["no_regulation", "no_millesimal_table"]);
    expect(deliveryFacts(input({ documentKinds: ["regulation"], tableCount: 0 }), TODAY).map((f) => f.kind)).toEqual(["no_millesimal_table"]);
    expect(deliveryFacts(input({ documentKinds: ["regulation"], tableCount: 2 }), TODAY)).toEqual([]);
  });

  it("assemblee: l'annullata non conta; il verbale manca solo per la tenuta; i giorni non sono mai negativi", () => {
    const m = (status: string, meetingOn: string, convocationDocumentId: string | null, minutesDocumentId: string | null) => ({ id: "m", kind: "ordinary", status, meetingOn, convocationDocumentId, minutesDocumentId });
    const facts = deliveryFacts(
      input({ meetings: [m("cancelled", "2026-01-01", null, null), m("scheduled", "2026-09-01", null, null), m("held", "2026-12-01", "d", null), m("held", "2026-05-16", "d", "v")] }),
      TODAY,
    );
    expect(facts.map((f) => `${f.kind}:${f.subject}`)).toEqual(["no_convocation:2026-09-01", "no_minutes:2026-12-01"]);
    expect(facts[1]!.daysSince).toBe(0);
    expect(facts[0]!.daysSince).toBeNull();
    expect(facts[0]!.href).toBe("/condominio/c1?sezione=assemblee");
  });

  it("esercizi e contratti: senza preventivo, preventivo senza documento, esercizio chiuso senza consuntivo, contratto finito o senza documento", () => {
    const facts = deliveryFacts(
      input({
        years: [
          { id: "y1", label: "2024", endsOn: "2024-12-31", budgets: [] },
          { id: "y2", label: "2025", endsOn: "2025-12-31", budgets: [{ title: "Ordinario", kind: "ordinary", documentId: null }] },
          { id: "y3", label: "2023", endsOn: "2023-12-31", budgets: [{ title: "Ordinario", kind: "ordinary", documentId: "d" }, { title: "Consuntivo", kind: "final", documentId: "d" }] },
          { id: "y4", label: "2026", endsOn: "2026-12-31", budgets: [{ title: "Ordinario", kind: "ordinary", documentId: "d" }] },
        ],
        contracts: [
          { title: "Pulizie", validTo: "2026-06-14", documentId: null },
          { title: "Ascensore", validTo: TODAY, documentId: "d" },
          { title: "Giardino", validTo: null, documentId: "d" },
        ],
      }),
      TODAY,
    );
    expect(facts.map((f) => `${f.kind}:${f.subject}`)).toEqual([
      "year_no_budget:2024",
      "budget_no_document:2025 – Ordinario",
      "year_ended_no_final:2025",
      "contract_no_document:Pulizie",
      "contract_ended:Pulizie",
    ]);
    expect(facts.find((f) => f.kind === "contract_ended")!.daysSince).toBe(1);
  });
});

describe("condominio, registro delibere: casi limite", () => {
  const res = (id: string, o: Partial<ResolutionInput["resolution"]> & { meetingOn?: string; condominiumId?: string; workIds?: string[] } = {}): ResolutionInput => ({
    condominiumId: o.condominiumId ?? "c1",
    condominiumName: "Condominio",
    meetingId: `m-${id}`,
    meetingOn: o.meetingOn ?? "2026-03-01",
    meetingKind: "ordinary",
    meetingStatus: "held",
    resolution: { id, title: o.title ?? id, outcome: o.outcome ?? "approved", agendaTitle: null, votesFor: null, votesAgainst: null, votesAbstain: null, threshold: null, deadlineId: null, budgetId: null, ...o },
    workIds: o.workIds ?? [],
  });

  it("registro vuoto e filtro vuoto non falliscono", () => {
    expect(resolutionRegister([])).toEqual([]);
    expect(filterRegister([], { year: 2026, withoutFollowUp: true })).toEqual([]);
  });

  it("ordine: assemblea piu' recente prima, poi titolo; il seguito conta scadenza, preventivo o lavori", () => {
    const rows = resolutionRegister([res("a", { title: "Zeta" }), res("b", { title: "Alfa" }), res("c", { meetingOn: "2026-05-01", deadlineId: "d" }), res("d", { budgetId: "b" }), res("e", { workIds: ["w"] })]);
    expect(rows[0]!.id).toBe("c");
    expect(rows.slice(1).map((r) => r.title)).toEqual(["Alfa", "d", "e", "Zeta"].sort((x, y) => x.localeCompare(y, "it")));
    expect(rows.find((r) => r.id === "e")).toMatchObject({ workCount: 1, hasFollowUp: true });
    expect(rows.find((r) => r.id === "a")).toMatchObject({ hasFollowUp: false, hasDeadline: false, hasBudget: false });
  });

  it("filtri combinati; l'anno non confonde prefissi; «senza seguito» riguarda solo le approvate", () => {
    const rows = resolutionRegister([
      res("1", { outcome: "approved" }),
      res("2", { outcome: "rejected" }),
      res("3", { outcome: "approved", condominiumId: "c2", meetingOn: "2025-03-01" }),
      res("4", { outcome: "approved", deadlineId: "d" }),
    ]);
    expect(filterRegister(rows, { withoutFollowUp: true }).map((r) => r.id).sort()).toEqual(["1", "3"]);
    expect(filterRegister(rows, { condominiumId: "c2" }).map((r) => r.id)).toEqual(["3"]);
    expect(filterRegister(rows, { year: 2025, outcome: "approved" }).map((r) => r.id)).toEqual(["3"]);
    expect(filterRegister(rows, { year: 202 })).toEqual([]);
    expect(filterRegister(rows, { outcome: "rejected", withoutFollowUp: true })).toEqual([]);
    expect(filterRegister(rows, {}).length).toBe(4);
  });
});
