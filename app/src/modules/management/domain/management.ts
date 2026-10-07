import { addDays, periodState, type PeriodState } from "@/shared/dates";
import { optionalDate, optionalText, optionalUuid, requiredDate, z } from "@/shared/zod";

/**
 * Gestione affidata a un property manager o a un gestore ricettivo: il proprietario consegna e riceve rendiconti, calendario
 * delle scadenze e dei prossimi adempimenti, interventi, codici identificativi. Qui ci sono i calcoli puri: dicono cosa
 * RISULTA dai dati registrati (e dalle cifre che il gestore comunica, se il proprietario le scrive), mai se la gestione
 * sia corretta, in regola o conveniente. Nessun elenco di ospiti: non si registrano dati di terzi non necessari.
 */

/** Il titolo della scadenza di fine mandato comincia cosi'. Il mandato e' un dato proprio (`management_mandate`): il titolo non lo identifica. */
export const MANDATE_PREFIX = "Mandato di gestione";
/** Quanto avanti guarda il calendario. */
export const CALENDAR_DAYS = 90;

export const mandateSchema = z
  .object({
    assetId: optionalUuid,
    managerPartyId: z.uuid("Scegli il gestore dalla rubrica"),
    startsOn: optionalDate,
    endsOn: requiredDate,
    compensation: optionalText(200),
    documentId: optionalUuid,
    note: optionalText(500),
  })
  .superRefine((m, ctx) => {
    if (m.startsOn && m.endsOn && m.endsOn < m.startsOn) ctx.addIssue({ code: "custom", path: ["endsOn"], message: "La data di fine è precedente a quella di inizio" });
  });

// ----------------------------------------------------------------------------------------------- rendiconto

export type RentLine = { lettingId: string; lettingTitle: string; dueOn: string; amountCents: number; paidCents: number; paidOn: string | null; hasProof: boolean };
export type RentLineState = "paid" | "partial" | "overdue" | "due";

export const rentLineState = (r: Pick<RentLine, "dueOn" | "amountCents" | "paidCents">, today: string): RentLineState =>
  r.paidCents >= r.amountCents ? "paid" : r.dueOn < today ? "overdue" : r.paidCents > 0 ? "partial" : "due";

export type WorkStage = "requested" | "approved" | "executed" | "cancelled";
const WORK_STAGE: Record<string, WorkStage> = { planned: "requested", quoted: "requested", approved: "approved", in_progress: "approved", completed: "executed", cancelled: "cancelled" };
/** Richiesto (in preparazione o con preventivo), approvato (approvato o in corso), eseguito, annullato: dallo stato scritto dal proprietario. */
export const workStage = (status: string): WorkStage => WORK_STAGE[status] ?? "requested";

export type WorkLine = { id: string; title: string; status: string; scheduledOn: string | null; startedOn: string | null; completedOn: string | null; supplierName: string | null; acceptedQuotesCents: number; invoicedCents: number; paidCents: number };
export type CodeLine = { lettingTitle: string; label: string; value: string; issuer: string | null; validUntil: string | null; state: PeriodState };
export type ReportLine = { lettingTitle: string; title: string; period: string | null; dueOn: string | null; doneOn: string | null; hasProof: boolean };
export type ContractLine = { id: string; title: string; type: string; status: string; startsOn: string | null; endsOn: string | null; monthlyRentCents: number | null; managerName: string | null; registered: boolean };
export type LedgerLine = { area: string; date: string; label: string; amountCents: number };
export type MandateLine = { id: string; title: string; managerPartyId: string | null; assetId: string | null; documentId: string | null; note: string | null; managerName: string | null; assetName: string | null; startsOn: string | null; endsOn: string | null; compensation: string | null; deadlineId: string | null; documentTitle: string | null; state: PeriodState };

export type StatementInput = {
  from: string;
  to: string;
  today: string;
  contracts: ContractLine[];
  rents: RentLine[];
  /** Incassi (area «locazioni») e pagamenti registrati con data nel periodo. */
  receipts: LedgerLine[];
  payments: LedgerLine[];
  works: WorkLine[];
  codes: CodeLine[];
  reports: ReportLine[];
  mandates: MandateLine[];
};

const inRange = (date: string | null, from: string, to: string) => date !== null && date >= from && date <= to;
const sum = (rows: { amountCents: number }[]) => rows.reduce((n, r) => n + r.amountCents, 0);

/** Un intervento compare nel rendiconto se una sua data cade nel periodo o se e' ancora aperto (richiesto o approvato). */
export const workInStatement = (w: WorkLine, from: string, to: string): boolean =>
  [w.scheduledOn, w.startedOn, w.completedOn].some((d) => inRange(d, from, to)) || workStage(w.status) === "requested" || workStage(w.status) === "approved";

export type CheckKey = "overdueRents" | "paidRentsNoProof" | "unpaidInvoices" | "expiredCodes" | "expiringCodes" | "overdueReports" | "contractsEnding" | "mandateExpired" | "mandateExpiring";
export type Check = { key: CheckKey; count: number; cents: number | null };

export type Statement = {
  from: string;
  to: string;
  contracts: ContractLine[];
  rents: (RentLine & { state: RentLineState })[];
  rentTotals: { dueCents: number; paidCents: number; overdueCents: number };
  receipts: LedgerLine[];
  payments: LedgerLine[];
  totals: { receiptsCents: number; paymentsCents: number; differenceCents: number };
  works: (WorkLine & { stage: WorkStage })[];
  codes: CodeLine[];
  reports: (ReportLine & { done: boolean; overdue: boolean })[];
  mandates: MandateLine[];
  checks: Check[];
};

/** Il rendiconto di un immobile per un periodo, solo dai dati registrati. Nessuna ripartizione e nessun giudizio. */
export function buildStatement(input: StatementInput): Statement {
  const { from, to, today } = input;
  const rents = input.rents.filter((r) => inRange(r.dueOn, from, to)).map((r) => ({ ...r, state: rentLineState(r, today) })).sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.lettingTitle.localeCompare(b.lettingTitle, "it"));
  const rentTotals = {
    dueCents: sum(rents),
    paidCents: rents.reduce((n, r) => n + Math.min(r.paidCents, r.amountCents), 0),
    overdueCents: rents.filter((r) => r.state === "overdue").reduce((n, r) => n + r.amountCents - r.paidCents, 0),
  };
  const byDate = (a: LedgerLine, b: LedgerLine) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label, "it");
  const receipts = [...input.receipts].sort(byDate);
  const payments = [...input.payments].sort(byDate);
  const totals = { receiptsCents: sum(receipts), paymentsCents: sum(payments), differenceCents: sum(receipts) - sum(payments) };
  const works = input.works.filter((w) => workInStatement(w, from, to)).map((w) => ({ ...w, stage: workStage(w.status) }));
  const reports = input.reports
    .filter((r) => inRange(r.dueOn, from, to) || inRange(r.doneOn, from, to) || (r.doneOn === null && r.dueOn !== null && r.dueOn < today))
    .map((r) => ({ ...r, done: r.doneOn !== null, overdue: r.doneOn === null && r.dueOn !== null && r.dueOn < today }))
    .sort((a, b) => (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999"));
  const soon = addDays(today, CALENDAR_DAYS);
  const count = (key: CheckKey, n: number, cents: number | null = null): Check[] => (n > 0 ? [{ key, count: n, cents }] : []);
  const unpaid = input.works.filter((w) => w.invoicedCents > w.paidCents);
  const checks: Check[] = [
    ...count("overdueRents", rents.filter((r) => r.state === "overdue").length, rentTotals.overdueCents),
    ...count("paidRentsNoProof", rents.filter((r) => r.paidCents > 0 && !r.hasProof).length),
    ...count("unpaidInvoices", unpaid.length, unpaid.reduce((n, w) => n + w.invoicedCents - w.paidCents, 0)),
    ...count("expiredCodes", input.codes.filter((c) => c.state === "expired").length),
    ...count("expiringCodes", input.codes.filter((c) => c.state === "expiring").length),
    ...count("overdueReports", reports.filter((r) => r.overdue).length),
    ...count("contractsEnding", input.contracts.filter((c) => c.status !== "ended" && c.endsOn !== null && c.endsOn >= today && c.endsOn <= soon).length),
    ...count("mandateExpired", input.mandates.filter((m) => m.state === "expired").length),
    ...count("mandateExpiring", input.mandates.filter((m) => m.state === "expiring").length),
  ];
  return { from, to, contracts: input.contracts, rents, rentTotals, receipts, payments, totals, works, codes: input.codes, reports, mandates: input.mandates, checks };
}

/** Confronto con le cifre che il gestore comunica (scritte dal proprietario): differenza = comunicato meno registrato. */
export type Comparison = { declaredCents: number; registeredCents: number; differenceCents: number };
export const compareDeclared = (declaredCents: number, registeredCents: number): Comparison => ({ declaredCents, registeredCents, differenceCents: declaredCents - registeredCents });

// ----------------------------------------------------------------------------------------------- calendario

export type CalendarKind = "deadline" | "rent" | "report" | "code" | "contractEnd" | "warranty" | "work";
export type CalendarEvent = { kind: CalendarKind; date: string; title: string; assetName: string | null; href: string; overdue: boolean };
export type Occupation = { id: string; title: string; type: string; assetName: string; startsOn: string | null; endsOn: string | null; status: string };

export type CalendarInput = {
  today: string;
  days: number;
  occurrences: { id: string; deadlineId: string; dueOn: string; title: string; assetName: string | null }[];
  lettings: {
    id: string;
    title: string;
    type: string;
    status: string;
    assetName: string;
    startsOn: string | null;
    endsOn: string | null;
    deadlineId: string | null;
    rents: { dueOn: string; amountCents: number; paidCents: number; deadlineId: string | null }[];
    reports: { title: string; dueOn: string | null; doneOn: string | null; deadlineId: string | null }[];
    codes: { label: string; validUntil: string | null }[];
  }[];
  warranties: { id: string; title: string; assetName: string; endsOn: string; deadlineId: string | null }[];
  works: { id: string; title: string; assetName: string; status: string; scheduledOn: string | null }[];
};

/**
 * Cosa succede nei prossimi giorni, in un unico elenco ordinato per data. Le voci che hanno gia' una scadenza collegata
 * compaiono una volta sola, come scadenza; le altre date registrate (canoni non coperti, adempimenti, fine contratto, codici,
 * garanzie, lavori previsti) si aggiungono. Le date gia' passate e ancora aperte restano, segnate «in ritardo».
 */
export function buildCalendar(input: CalendarInput): { events: CalendarEvent[]; occupations: Occupation[]; until: string } {
  const { today } = input;
  const until = addDays(today, input.days);
  const events: CalendarEvent[] = input.occurrences
    .filter((o) => o.dueOn <= until)
    .map((o) => ({ kind: "deadline", date: o.dueOn, title: o.title, assetName: o.assetName, href: `/scadenze/${o.deadlineId}`, overdue: o.dueOn < today }));
  const push = (kind: CalendarKind, date: string | null, title: string, assetName: string | null, href: string, allowPast: boolean) => {
    if (!date || date > until || (!allowPast && date < today)) return;
    events.push({ kind, date, title, assetName, href, overdue: date < today });
  };
  for (const l of input.lettings) {
    const href = `/locazioni/${l.id}`;
    if (l.status !== "ended" && !l.deadlineId) push("contractEnd", l.endsOn, l.title, l.assetName, href, false);
    for (const r of l.rents) if (!r.deadlineId && r.paidCents < r.amountCents) push("rent", r.dueOn, l.title, l.assetName, href, true);
    for (const r of l.reports) if (!r.deadlineId && !r.doneOn) push("report", r.dueOn, `${r.title}: ${l.title}`, l.assetName, href, true);
    for (const c of l.codes) push("code", c.validUntil, `${c.label}: ${l.title}`, l.assetName, href, false);
  }
  for (const w of input.warranties) if (!w.deadlineId) push("warranty", w.endsOn, w.title, w.assetName, "/manutenzioni", false);
  for (const w of input.works) if (w.status !== "completed" && w.status !== "cancelled") push("work", w.scheduledOn, w.title, w.assetName, `/manutenzioni/${w.id}`, true);
  events.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, "it"));

  const occupations = input.lettings
    .filter((l) => l.status !== "ended" && (l.startsOn !== null || l.endsOn !== null) && (l.startsOn === null || l.startsOn <= until) && (l.endsOn === null || l.endsOn >= today))
    .map((l) => ({ id: l.id, title: l.title, type: l.type, assetName: l.assetName, startsOn: l.startsOn, endsOn: l.endsOn, status: l.status }))
    .sort((a, b) => (a.startsOn ?? "").localeCompare(b.startsOn ?? "") || a.title.localeCompare(b.title, "it"));
  return { events, occupations, until };
}

/** Stato di un mandato dalla data di fine scritta dal proprietario. */
export const mandateState = (endsOn: string | null, today: string): PeriodState => periodState({ startsOn: null, endsOn }, today);

export const COMPENSATION_LABEL = "Compenso dichiarato: ";

export type MandateInput = z.output<typeof mandateSchema>;
