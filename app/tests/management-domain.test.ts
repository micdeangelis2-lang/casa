import { describe, expect, it } from "vitest";
import { buildCalendar, buildStatement, mandateSchema, mandateState, rentLineState, workInStatement, workStage, type CalendarInput, type StatementInput, type WorkLine } from "@/modules/management/domain/management";

const uuid = "123e4567-e89b-42d3-a456-426614174000";
const emptyStatement: StatementInput = { from: "2026-01-01", to: "2026-12-31", today: "2026-06-15", contracts: [], rents: [], receipts: [], payments: [], works: [], codes: [], reports: [], mandates: [] };
const work = (o: Partial<WorkLine> = {}): WorkLine => ({ id: "w", title: "Lavoro", status: "completed", scheduledOn: null, startedOn: null, completedOn: null, supplierName: null, acceptedQuotesCents: 0, invoicedCents: 0, paidCents: 0, ...o });
const emptyCalendar: CalendarInput = { today: "2026-06-15", days: 30, occurrences: [], lettings: [], warranties: [], works: [] };

describe("gestione affidata: casi limite del dominio", () => {
  it("il mandato rifiuta una fine precedente all'inizio e accetta l'uguaglianza", () => {
    const base = { managerPartyId: uuid, endsOn: "2026-05-01" };
    expect(mandateSchema.safeParse({ ...base, startsOn: "2026-05-02" }).success).toBe(false);
    expect(mandateSchema.safeParse({ ...base, startsOn: "2026-05-01" }).success).toBe(true);
    expect(mandateSchema.safeParse(base).success).toBe(true);
    expect(mandateSchema.safeParse({ ...base, managerPartyId: "non-un-uuid" }).success).toBe(false);
  });

  it("stato del canone: pagato a importo zero, parziale, scaduto vince sul parziale, da incassare", () => {
    const today = "2026-06-15";
    expect(rentLineState({ dueOn: "2026-01-01", amountCents: 0, paidCents: 0 }, today)).toBe("paid");
    expect(rentLineState({ dueOn: "2026-07-01", amountCents: 100, paidCents: 150 }, today)).toBe("paid");
    expect(rentLineState({ dueOn: "2026-07-01", amountCents: 100, paidCents: 40 }, today)).toBe("partial");
    expect(rentLineState({ dueOn: "2026-06-14", amountCents: 100, paidCents: 40 }, today)).toBe("overdue");
    expect(rentLineState({ dueOn: "2026-06-15", amountCents: 100, paidCents: 0 }, today)).toBe("due");
  });

  it("uno stato di intervento sconosciuto vale «richiesto»", () => {
    expect(workStage("inventato")).toBe("requested");
    expect(workStage("")).toBe("requested");
  });

  it("un intervento chiuso fuori periodo non compare; uno aperto compare sempre; i confini del periodo sono inclusi", () => {
    expect(workInStatement(work({ completedOn: "2025-12-31" }), "2026-01-01", "2026-12-31")).toBe(false);
    expect(workInStatement(work({ completedOn: "2026-01-01" }), "2026-01-01", "2026-12-31")).toBe(true);
    expect(workInStatement(work({ scheduledOn: "2026-12-31" }), "2026-01-01", "2026-12-31")).toBe(true);
    expect(workInStatement(work({ status: "planned" }), "2026-01-01", "2026-12-31")).toBe(true);
    expect(workInStatement(work({ status: "in_progress", startedOn: "2020-01-01" }), "2026-01-01", "2026-12-31")).toBe(true);
    expect(workInStatement(work({ status: "cancelled" }), "2026-01-01", "2026-12-31")).toBe(false);
  });

  it("rendiconto vuoto: nessun controllo, totali a zero", () => {
    const s = buildStatement(emptyStatement);
    expect(s.checks).toEqual([]);
    expect(s.rentTotals).toEqual({ dueCents: 0, paidCents: 0, overdueCents: 0 });
    expect(s.totals).toEqual({ receiptsCents: 0, paymentsCents: 0, differenceCents: 0 });
  });

  it("rendiconto: ordinamento a parita' di data, pagato oltre l'importo non gonfia il totale, importo zero non e' «scaduto»", () => {
    const line = (title: string, dueOn: string, amountCents: number, paidCents: number) => ({ lettingId: title, lettingTitle: title, dueOn, amountCents, paidCents, paidOn: null, hasProof: false });
    const s = buildStatement({
      ...emptyStatement,
      rents: [line("Zeta", "2026-03-01", 1000, 1500), line("Alfa", "2026-03-01", 1000, 0), line("Fuori", "2027-01-01", 5, 0), line("Zero", "2026-02-01", 0, 0), line("Scaduto", "2026-04-01", 1000, 400)],
      receipts: [
        { area: "locazioni", date: "2026-03-02", label: "b", amountCents: 100 },
        { area: "locazioni", date: "2026-03-02", label: "a", amountCents: 50 },
      ],
      payments: [{ area: "x", date: "2026-03-03", label: "p", amountCents: 500 }],
    });
    expect(s.rents.map((r) => r.lettingTitle)).toEqual(["Zero", "Alfa", "Zeta", "Scaduto"]);
    expect(s.rentTotals.dueCents).toBe(3000);
    expect(s.rentTotals.paidCents).toBe(1000 + 0 + 400);
    expect(s.rentTotals.overdueCents).toBe(1000 + 600);
    expect(s.receipts.map((r) => r.label)).toEqual(["a", "b"]);
    expect(s.totals.differenceCents).toBe(150 - 500);
    expect(s.checks.find((c) => c.key === "overdueRents")).toEqual({ key: "overdueRents", count: 2, cents: 1600 });
    expect(s.checks.find((c) => c.key === "paidRentsNoProof")?.count).toBe(2);
  });

  it("rendiconto: adempimenti senza scadenza, scaduti, svolti nel periodo e ordine con date nulle in fondo", () => {
    const r = (title: string, dueOn: string | null, doneOn: string | null) => ({ lettingTitle: "L", title, period: null, dueOn, doneOn, hasProof: false });
    const s = buildStatement({
      ...emptyStatement,
      reports: [r("senza-date", null, null), r("vecchio-aperto", "2020-01-01", null), r("vecchio-fatto", "2020-01-01", "2020-01-05"), r("fatto-ora", "2026-02-01", "2026-02-03"), r("futuro", "2026-12-01", null), r("fatto-in-periodo", "2020-03-01", "2026-03-01")],
    });
    expect(s.reports.map((x) => x.title)).toEqual(["vecchio-aperto", "fatto-in-periodo", "fatto-ora", "futuro"]);
    expect(s.reports.map((x) => x.title)).not.toContain("senza-date");
    expect(s.reports.map((x) => x.title)).not.toContain("vecchio-fatto");
    expect(s.reports.find((x) => x.title === "vecchio-aperto")).toMatchObject({ overdue: true, done: false });
    expect(s.reports.find((x) => x.title === "fatto-in-periodo")).toMatchObject({ overdue: false, done: true });
    expect(s.reports[0].title).toBe("vecchio-aperto");
    expect(s.checks.find((c) => c.key === "overdueReports")?.count).toBe(1);
  });

  it("rendiconto: controlli su fatture, codici, contratti e mandati; contratto terminato o senza fine non conta", () => {
    const c = (status: string, endsOn: string | null) => ({ id: "c", title: "C", type: "t", status, startsOn: null, endsOn, monthlyRentCents: null, managerName: null, registered: false });
    const code = (state: "expired" | "expiring" | "active") => ({ lettingTitle: "L", label: "x", value: "v", issuer: null, validUntil: null, state });
    const m = (state: "expired" | "expiring" | "active") => ({ id: "m", title: "M", managerPartyId: null, assetId: null, documentId: null, note: null, managerName: null, assetName: null, startsOn: null, endsOn: null, compensation: null, deadlineId: null, documentTitle: null, state });
    const s = buildStatement({
      ...emptyStatement,
      contracts: [c("active", "2026-06-15"), c("active", "2026-09-13"), c("active", "2026-09-14"), c("active", "2026-06-14"), c("ended", "2026-07-01"), c("active", null)],
      works: [work({ invoicedCents: 1000, paidCents: 1000 }), work({ invoicedCents: 1000, paidCents: 250 })],
      codes: [code("expired"), code("expiring"), code("expiring"), code("active")],
      mandates: [m("expired"), m("expiring"), m("active")],
    });
    const by = Object.fromEntries(s.checks.map((k) => [k.key, k]));
    expect(by.contractsEnding.count).toBe(2);
    expect(by.unpaidInvoices).toEqual({ key: "unpaidInvoices", count: 1, cents: 750 });
    expect(by.expiredCodes.count).toBe(1);
    expect(by.expiringCodes.count).toBe(2);
    expect(by.mandateExpired.count).toBe(1);
    expect(by.mandateExpiring.count).toBe(1);
    expect(by.overdueRents).toBeUndefined();
  });

  it("stato del mandato: senza fine non ha stato di scadenza", () => {
    expect(mandateState(null, "2026-06-15")).toBe("undated");
    expect(mandateState("2026-06-14", "2026-06-15")).toBe("expired");
    expect(mandateState("2026-12-31", "2026-06-15")).toBe("active");
  });

  it("calendario vuoto: nessun evento, nessuna occupazione, fine = oggi + giorni", () => {
    expect(buildCalendar(emptyCalendar)).toEqual({ events: [], occupations: [], until: "2026-07-15" });
  });

  it("calendario: confini, voci con scadenza collegata una sola volta, passate solo se «aperte», ordine stabile a parita' di data", () => {
    const res = buildCalendar({
      ...emptyCalendar,
      occurrences: [
        { id: "o1", deadlineId: "d1", dueOn: "2026-07-15", title: "Dentro (ultimo giorno)", assetName: null },
        { id: "o2", deadlineId: "d2", dueOn: "2026-07-16", title: "Fuori", assetName: null },
        { id: "o3", deadlineId: "d3", dueOn: "2026-06-01", title: "Passata", assetName: "A" },
      ],
      lettings: [
        {
          id: "l1", title: "Contratto", type: "t", status: "active", assetName: "A", startsOn: null, endsOn: "2026-06-20", deadlineId: null,
          rents: [
            { dueOn: "2026-06-01", amountCents: 100, paidCents: 0, deadlineId: null },
            { dueOn: "2026-06-02", amountCents: 100, paidCents: 100, deadlineId: null },
            { dueOn: "2026-06-03", amountCents: 100, paidCents: 0, deadlineId: "d9" },
          ],
          reports: [
            { title: "R1", dueOn: "2026-06-05", doneOn: null, deadlineId: null },
            { title: "R2", dueOn: "2026-06-06", doneOn: "2026-06-06", deadlineId: null },
            { title: "R3", dueOn: null, doneOn: null, deadlineId: null },
          ],
          codes: [{ label: "CIN", validUntil: "2026-06-14" }, { label: "CIN2", validUntil: "2026-06-15" }, { label: "CIN3", validUntil: null }],
        },
        { id: "l2", title: "Collegato", type: "t", status: "active", assetName: "B", startsOn: null, endsOn: "2026-06-20", deadlineId: "dx", rents: [], reports: [], codes: [] },
        { id: "l3", title: "Terminato", type: "t", status: "ended", assetName: "B", startsOn: "2020-01-01", endsOn: "2026-06-20", deadlineId: null, rents: [], reports: [], codes: [] },
      ],
      warranties: [
        { id: "g1", title: "Garanzia ieri", assetName: "A", endsOn: "2026-06-14", deadlineId: null },
        { id: "g2", title: "Garanzia domani", assetName: "A", endsOn: "2026-06-16", deadlineId: null },
        { id: "g3", title: "Garanzia collegata", assetName: "A", endsOn: "2026-06-16", deadlineId: "dg" },
      ],
      works: [
        { id: "k1", title: "Lavoro in ritardo", assetName: "A", status: "planned", scheduledOn: "2026-05-01" },
        { id: "k2", title: "Lavoro chiuso", assetName: "A", status: "completed", scheduledOn: "2026-06-20" },
        { id: "k3", title: "Lavoro annullato", assetName: "A", status: "cancelled", scheduledOn: "2026-06-20" },
        { id: "k4", title: "Lavoro senza data", assetName: "A", status: "approved", scheduledOn: null },
      ],
    });
    const titles = res.events.map((e) => e.title);
    expect(titles).toContain("Dentro (ultimo giorno)");
    expect(titles).not.toContain("Fuori");
    expect(titles).toContain("Passata");
    expect(res.events.find((e) => e.title === "Passata")?.overdue).toBe(true);
    expect(res.events.filter((e) => e.kind === "rent")).toHaveLength(1);
    expect(titles).toContain("R1: Contratto");
    expect(titles).not.toContain("R2: Contratto");
    expect(titles).not.toContain("R3: Contratto");
    expect(titles).not.toContain("CIN: Contratto");
    expect(titles).toContain("CIN2: Contratto");
    expect(titles).not.toContain("Garanzia ieri");
    expect(titles).toContain("Garanzia domani");
    expect(titles).not.toContain("Garanzia collegata");
    expect(titles).toContain("Lavoro in ritardo");
    expect(titles).not.toContain("Lavoro chiuso");
    expect(titles).not.toContain("Lavoro annullato");
    expect(titles).not.toContain("Lavoro senza data");
    expect(res.events.filter((e) => e.kind === "contractEnd").map((e) => e.title)).toEqual(["Contratto"]);
    const dates = res.events.map((e) => e.date);
    expect(dates).toEqual([...dates].sort());
  });

  it("calendario: a parita' di data l'ordine e' per titolo; occupazioni: aperte, future entro l'orizzonte e senza data di inizio", () => {
    const lt = (id: string, title: string, status: string, startsOn: string | null, endsOn: string | null) => ({ id, title, type: "t", status, assetName: "A", startsOn, endsOn, deadlineId: null, rents: [], reports: [], codes: [] });
    const res = buildCalendar({
      ...emptyCalendar,
      occurrences: [
        { id: "1", deadlineId: "a", dueOn: "2026-06-20", title: "Zeta", assetName: null },
        { id: "2", deadlineId: "b", dueOn: "2026-06-20", title: "Alfa", assetName: null },
      ],
      lettings: [
        lt("a", "Futuro lontano", "active", "2026-08-01", null),
        lt("b", "Futuro vicino", "active", "2026-07-15", null),
        lt("c", "Senza inizio", "active", null, "2026-06-15"),
        lt("d", "Finito ieri", "active", "2026-01-01", "2026-06-14"),
        lt("e", "Senza date", "active", null, null),
        lt("f", "Terminato", "ended", "2026-01-01", null),
      ],
    });
    expect(res.events.map((e) => e.title)).toEqual(["Senza inizio", "Alfa", "Zeta"]);
    expect(res.occupations.map((o) => o.title)).toEqual(["Senza inizio", "Futuro vicino"]);
  });
});
