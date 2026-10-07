import { euroAmount, optionalDate, optionalEuroAmount, optionalText, optionalUuid, requiredDate, requiredText, z } from "@/shared/zod";

/**
 * Manutenzioni e lavori: interventi, preventivi, avanzamenti, fatture, garanzie e ispezioni periodiche.
 * L'app registra e ricorda: non valuta preventivi, non dice se un lavoro e' a regola d'arte ne' se una garanzia si applica.
 */

export const WORK_STATUSES = ["planned", "quoted", "approved", "in_progress", "completed", "cancelled"] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];
export const QUOTE_STATUSES = ["received", "accepted", "rejected"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];
export const ENTRY_KINDS = ["quote", "invoice", "progress"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

const flag = z.boolean().default(false);
const dateOrder = (a: string | undefined, b: string | undefined) => !a || !b || b >= a;

/** Codici dei tipi di impianto (nomi e parole chiave stanno nei messaggi: sono dati, non norme). L'ordine conta nella classificazione per parola chiave. */
export const PLANT_KINDS = ["solar", "electrical", "lift", "fire", "cooling", "gas", "heating", "water", "other"] as const;
export type PlantKind = (typeof PLANT_KINDS)[number];

export const plantSchema = z.object({
  assetId: z.uuid("Scegli l'immobile"),
  kind: z.enum(PLANT_KINDS, { error: "Scegli il tipo di impianto" }),
  name: requiredText("Nome dell'impianto", 160),
  installedOn: optionalDate,
  installerPartyId: optionalUuid,
  maintainerPartyId: optionalUuid,
  serialNumber: optionalText(120),
  note: optionalText(1000),
});
/** L'immobile di un impianto non si cambia: i piani, le garanzie e gli interventi collegati restano di quell'immobile. */
export const plantUpdateSchema = plantSchema.omit({ assetId: true });

export const workSchema = z
  .object({
    assetId: z.uuid("Scegli l'immobile"),
    title: requiredText("Titolo", 200),
    description: optionalText(2000),
    status: z.enum(WORK_STATUSES, { error: "Scegli lo stato" }).default("planned"),
    supplierPartyId: optionalUuid,
    /** Impianto a cui l'intervento si riferisce (solo in creazione; dopo si collega dalla scheda dell'impianto). */
    plantId: optionalUuid,
    scheduledOn: optionalDate,
    startedOn: optionalDate,
    completedOn: optionalDate,
    budget: optionalEuroAmount("Importo previsto"),
    note: optionalText(1000),
    /** Solo in creazione: crea una scadenza alla data prevista. */
    createDeadline: flag,
  })
  .superRefine((w, ctx) => {
    if (!dateOrder(w.startedOn, w.completedOn)) ctx.addIssue({ code: "custom", path: ["completedOn"], message: "La data di fine è precedente a quella di inizio" });
  });

export const quoteSchema = z.object({
  supplierPartyId: optionalUuid,
  amount: euroAmount("Importo"),
  quotedOn: optionalDate,
  validUntil: optionalDate,
  status: z.enum(QUOTE_STATUSES, { error: "Scegli lo stato" }).default("received"),
  documentId: optionalUuid,
  note: optionalText(500),
});

export const invoiceSchema = z.object({
  number: optionalText(60),
  issuedOn: requiredDate,
  amount: euroAmount("Importo"),
  paidOn: optionalDate,
  documentId: optionalUuid,
  note: optionalText(500),
});

export const progressSchema = z.object({
  recordedOn: optionalDate,
  percent: z.preprocess((v) => (v === "" || v === undefined ? undefined : v), z.coerce.number({ error: "Percentuale: inserisci un numero" }).int("Percentuale: numero intero").min(0, "Percentuale tra 0 e 100").max(100, "Percentuale tra 0 e 100").optional()),
  note: requiredText("Nota", 1000),
});

export const warrantySchema = z
  .object({
    assetId: z.uuid("Scegli l'immobile"),
    workId: optionalUuid,
    plantId: optionalUuid,
    title: requiredText("Titolo", 200),
    startsOn: optionalDate,
    endsOn: requiredDate,
    supplierPartyId: optionalUuid,
    documentId: optionalUuid,
    note: optionalText(500),
    createDeadline: flag,
  })
  .superRefine((w, ctx) => {
    if (!dateOrder(w.startsOn, w.endsOn)) ctx.addIssue({ code: "custom", path: ["endsOn"], message: "La data di fine è precedente a quella di inizio" });
  });

export const inspectionPlanSchema = z.object({
  assetId: z.uuid("Scegli l'immobile"),
  title: requiredText("Titolo", 200),
  intervalMonths: z.coerce.number({ error: "Intervallo: inserisci un numero di mesi" }).int("Intervallo: numero intero").min(1, "Almeno 1 mese").max(120, "Massimo 120 mesi"),
  firstDueOn: requiredDate,
  supplierPartyId: optionalUuid,
  plantId: optionalUuid,
  note: optionalText(500),
});

/** Quanto risulta dai dati inseriti: preventivi accettati, fatturato, pagato. Nessuna valutazione. */
export function workFinancials(input: { quotes: { status: QuoteStatus; amountCents: number }[]; invoices: { amountCents: number; paidOn: string | null }[]; budgetCents: number | null }) {
  const acceptedQuotesCents = input.quotes.filter((q) => q.status === "accepted").reduce((n, q) => n + q.amountCents, 0);
  const invoicedCents = input.invoices.reduce((n, i) => n + i.amountCents, 0);
  const paidCents = input.invoices.filter((i) => i.paidOn !== null).reduce((n, i) => n + i.amountCents, 0);
  return { budgetCents: input.budgetCents, acceptedQuotesCents, invoicedCents, paidCents, unpaidInvoicesCents: invoicedCents - paidCents };
}

/** Un preventivo con validita' scaduta e non ancora accettato o respinto. */
export const quoteExpired = (q: { status: QuoteStatus; validUntil: string | null }, today: string): boolean => q.status === "received" && q.validUntil !== null && q.validUntil < today;
