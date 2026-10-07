import { euroAmount, optionalDate, optionalEuroAmount, optionalText, optionalUuid, requiredDate, requiredText, z } from "@/shared/zod";

/**
 * Tributi e pagamenti: registro di cio' che il proprietario si aspetta di pagare, di cio' che ha pagato e delle prove.
 * Nessuna aliquota e nessun calcolo di imposta: gli importi sono dati inseriti a mano (o importati) e l'app non dice
 * mai che un tributo e' dovuto, non dovuto o corretto.
 */

export const TAX_KINDS = ["tax", "levy", "due", "other"] as const;
export type TaxKind = (typeof TAX_KINDS)[number];

export const PAYMENT_METHODS = ["bank_transfer", "direct_debit", "card", "cash", "payment_slip", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Natura del pagamento, scelta dal proprietario: l'app non la deduce dalle date ne' dagli importi. */
export const PAYMENT_KINDS = ["ordinary", "late_payment_correction", "other"] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

const year = z.coerce.number({ error: "Anno: inserisci un numero" }).int("Anno: numero intero").min(1990, "Anno non valido").max(2100, "Anno non valido");
const flag = z.boolean().default(false);

export const taxTypeSchema = z.object({
  name: requiredText("Nome", 120),
  kind: z.enum(TAX_KINDS, { error: "Scegli il genere" }).default("tax"),
  territoryId: optionalUuid,
  source: optionalText(300),
  notes: optionalText(1000),
});

export const obligationSchema = z.object({
  assetId: z.uuid("Scegli l'immobile"),
  taxTypeId: z.uuid("Scegli il tipo di tributo"),
  year,
  label: optionalText(80),
  dueOn: optionalDate,
  expected: optionalEuroAmount("Importo atteso"),
  note: optionalText(1000),
  askAdviser: flag,
  /** Solo in creazione: crea anche una scadenza (se c'e' una data). */
  createDeadline: flag,
});

export const paymentSchema = z
  .object({
    paidOn: requiredDate,
    amount: euroAmount("Importo pagato"),
    method: z.enum(PAYMENT_METHODS, { error: "Scegli il metodo" }).default("other"),
    kind: z.enum(PAYMENT_KINDS, { error: "Scegli la natura del pagamento" }).default("ordinary"),
    /** Di cui sanzioni e interessi, come li dichiara il proprietario (l'app non li calcola). */
    penalty: optionalEuroAmount("Sanzioni"),
    interest: optionalEuroAmount("Interessi"),
    reference: optionalText(120),
    documentId: optionalUuid,
    note: optionalText(500),
  })
  .superRefine((p, ctx) => {
    if (p.amount <= 0) ctx.addIssue({ code: "custom", path: ["amount"], message: "L'importo pagato deve essere maggiore di zero" });
    if ((p.penalty ?? 0) + (p.interest ?? 0) > p.amount) ctx.addIssue({ code: "custom", path: ["penalty"], message: "Sanzioni e interessi dichiarati superano l'importo pagato" });
  });

export const closeSchema = z.object({
  closedOn: optionalDate,
  /** Il motivo lo scrive il proprietario (per esempio l'indicazione del consulente): l'app non lo valuta. */
  reason: requiredText("Motivo", 500),
});

export const returnSchema = z.object({
  title: requiredText("Titolo", 160),
  taxTypeId: optionalUuid,
  assetId: optionalUuid,
  year,
  dueOn: optionalDate,
  filedOn: optionalDate,
  protocol: optionalText(80),
  documentId: optionalUuid,
  askAdviser: flag,
  note: optionalText(1000),
  createDeadline: flag,
});

export type ObligationState = "closed" | "settled" | "partial" | "recorded" | "unpaid";

export type ObligationFacts = { status: "open" | "closed"; dueOn: string | null; expectedCents: number | null };

/**
 * Stato di una voce in base ai SOLI dati registrati. «settled» vuol dire che i pagamenti registrati raggiungono
 * l'importo che il proprietario ha indicato: non che il tributo sia stato assolto correttamente.
 */
export function obligationState(o: ObligationFacts, paidCents: number, today: string): { state: ObligationState; remainingCents: number | null; overdue: boolean } {
  const remainingCents = o.expectedCents === null ? null : o.expectedCents - paidCents;
  let state: ObligationState;
  if (o.status === "closed") state = "closed";
  else if (o.expectedCents !== null && paidCents >= o.expectedCents) state = "settled";
  else if (paidCents > 0 && o.expectedCents !== null) state = "partial";
  else if (paidCents > 0) state = "recorded";
  else state = "unpaid";
  const overdue = o.dueOn !== null && o.dueOn < today && (state === "unpaid" || state === "partial");
  return { state, remainingCents, overdue };
}

export type SummaryLine = { expectedCents: number | null; paidCents: number; state: ObligationState; overdue: boolean };

/** Totali di un insieme di voci: gli importi attesi mancanti non si inventano, si contano a parte. */
export function summarize(lines: SummaryLine[]): { expectedCents: number; paidCents: number; withoutExpected: number; open: number; overdue: number } {
  return {
    expectedCents: lines.reduce((n, l) => n + (l.expectedCents ?? 0), 0),
    paidCents: lines.reduce((n, l) => n + l.paidCents, 0),
    withoutExpected: lines.filter((l) => l.expectedCents === null && l.state !== "closed").length,
    open: lines.filter((l) => l.state === "unpaid" || l.state === "partial" || l.state === "recorded").length,
    overdue: lines.filter((l) => l.overdue).length,
  };
}
