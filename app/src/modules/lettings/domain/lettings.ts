import { addMonths, periodState, type PeriodState } from "@/shared/dates";
import { euroAmount, optionalDate, optionalEuroAmount, optionalText, optionalUuid, requiredDate, requiredText, z } from "@/shared/zod";

/**
 * Locazioni e ricettivita': il proprietario sceglie il tipo reale (locazione abitativa, transitoria, per studenti, breve o
 * turistica, struttura ricettiva) e registra contratto, persone, canoni, codici e adempimenti. Cosa serva in un certo
 * territorio (requisiti, codici, comunicazioni, imposta di soggiorno, rilevazioni statistiche) non e' scritto qui: sono
 * regole a dati (modulo Regole). L'app non dice mai che un'attivita' si puo' avviare o che e' in regola.
 */

export const LETTING_TYPES = ["residential", "transitional", "student", "short_term", "accommodation"] as const;
export type LettingType = (typeof LETTING_TYPES)[number];
export const LETTING_STATUSES = ["planned", "active", "ended"] as const;
export type LettingStatus = (typeof LETTING_STATUSES)[number];
export const LETTING_PARTY_ROLES = ["tenant", "occupant", "guarantor"] as const;
export type LettingPartyRole = (typeof LETTING_PARTY_ROLES)[number];
export const REPORT_KINDS = ["communication", "tourist_tax", "statistics", "other"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

/** Tipi con un contratto di durata (canone, cauzione, registrazione); gli altri sono attivita' di breve soggiorno. */
export const isContractType = (type: LettingType): boolean => type === "residential" || type === "transitional" || type === "student";

const flag = z.boolean().default(false);
const ordered = (a: string | undefined, b: string | undefined) => !a || !b || b >= a;

export const lettingSchema = z
  .object({
    assetId: z.uuid("Scegli l'immobile"),
    type: z.enum(LETTING_TYPES, { error: "Scegli il tipo di locazione o di attività" }),
    title: requiredText("Titolo", 200),
    status: z.enum(LETTING_STATUSES, { error: "Scegli lo stato" }).default("active"),
    startsOn: optionalDate,
    endsOn: optionalDate,
    managerPartyId: optionalUuid,
    monthlyRent: optionalEuroAmount("Canone mensile"),
    deposit: optionalEuroAmount("Cauzione"),
    depositReceivedOn: optionalDate,
    depositReturnedOn: optionalDate,
    depositReturned: optionalEuroAmount("Cauzione restituita"),
    registeredOn: optionalDate,
    registrationNumber: optionalText(60),
    registrationOffice: optionalText(120),
    contractDocumentId: optionalUuid,
    note: optionalText(2000),
    /** Solo in creazione: crea un promemoria alla data di fine. */
    createDeadline: flag,
  })
  .superRefine((l, ctx) => {
    if (!ordered(l.startsOn, l.endsOn)) ctx.addIssue({ code: "custom", path: ["endsOn"], message: "La data di fine è precedente a quella di inizio" });
    if (!ordered(l.depositReceivedOn, l.depositReturnedOn)) ctx.addIssue({ code: "custom", path: ["depositReturnedOn"], message: "La restituzione è precedente al versamento" });
  });

export const partySchema = z.object({ partyId: z.uuid("Scegli il contatto dalla rubrica"), role: z.enum(LETTING_PARTY_ROLES, { error: "Scegli il ruolo" }).default("tenant") });

export const rentScheduleSchema = z.object({
  firstDueOn: requiredDate,
  months: z.coerce.number({ error: "Numero di mesi: inserisci un numero" }).int("Numero di mesi: numero intero").min(1, "Almeno un mese").max(120, "Massimo 120 mesi"),
  amount: euroAmount("Canone"),
  createDeadlines: flag,
});

export const rentRowSchema = z.object({ dueOn: requiredDate, amount: euroAmount("Importo") });

export const rentPaymentSchema = z.object({ paid: euroAmount("Importo pagato"), paidOn: optionalDate, documentId: optionalUuid });

/** Un incasso di un canone: data, importo, modalita' scritta dal proprietario e documento di prova. */
export const rentReceiptSchema = z
  .object({ amount: euroAmount("Importo incassato"), paidOn: optionalDate, method: optionalText(80), documentId: optionalUuid })
  .superRefine((r, ctx) => {
    if (r.amount <= 0) ctx.addIssue({ code: "custom", path: ["amount"], message: "L'importo incassato deve essere maggiore di zero" });
  });

export const codeSchema = z
  .object({ label: requiredText("Nome del codice", 120), value: requiredText("Codice", 120), issuer: optionalText(160), issuedOn: optionalDate, validUntil: optionalDate, note: optionalText(300) })
  .superRefine((c, ctx) => {
    if (!ordered(c.issuedOn, c.validUntil)) ctx.addIssue({ code: "custom", path: ["validUntil"], message: "La data di fine validità è precedente a quella di rilascio" });
  });

export const reportSchema = z.object({
  kind: z.enum(REPORT_KINDS, { error: "Scegli il tipo di adempimento" }),
  title: requiredText("Titolo", 200),
  period: optionalText(60),
  dueOn: optionalDate,
  amount: optionalEuroAmount("Importo"),
  doneOn: optionalDate,
  documentId: optionalUuid,
  note: optionalText(500),
  createDeadline: flag,
});

export const reportDoneSchema = z.object({ doneOn: requiredDate, documentId: optionalUuid, amount: optionalEuroAmount("Importo") });

/** Il calendario dei canoni: una data al mese a partire dalla prima (31 gennaio -> 28 febbraio -> 31 marzo), stesso importo. */
export function rentDates(firstDueOn: string, months: number): string[] {
  return Array.from({ length: months }, (_, k) => addMonths(firstDueOn, k));
}

export type RentState = "paid" | "partial" | "overdue" | "due";

/** Situazione di un canone dai soli dati registrati. */
export function rentState(r: { dueOn: string; amountCents: number; paidCents: number }, today: string): RentState {
  if (r.paidCents >= r.amountCents) return "paid";
  if (r.dueOn < today) return "overdue";
  return r.paidCents > 0 ? "partial" : "due";
}

export type ReportState = "done" | "overdue" | "open";
export const reportState = (r: { doneOn: string | null; dueOn: string | null }, today: string): ReportState => (r.doneOn ? "done" : r.dueOn && r.dueOn < today ? "overdue" : "open");

/** Validita' di un codice dalle date scritte dal proprietario (rilascio e fine validita'). */
export const codeState = (c: { issuedOn: string | null; validUntil: string | null }, today: string): PeriodState => periodState({ startsOn: c.issuedOn, endsOn: c.validUntil }, today);

/** Totali del calendario dei canoni: previsto, incassato, arretrato (solo cio' che risulta dai dati). */
export function rentTotals(rows: { dueOn: string; amountCents: number; paidCents: number }[], today: string): { dueCents: number; paidCents: number; overdueCents: number } {
  return {
    dueCents: rows.reduce((n, r) => n + r.amountCents, 0),
    paidCents: rows.reduce((n, r) => n + Math.min(r.paidCents, r.amountCents), 0),
    overdueCents: rows.filter((r) => rentState(r, today) === "overdue").reduce((n, r) => n + (r.amountCents - r.paidCents), 0),
  };
}
