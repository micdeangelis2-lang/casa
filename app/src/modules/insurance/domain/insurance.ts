import { euroAmount, optionalDate, optionalEuroAmount, optionalText, optionalUuid, requiredDate, requiredText, z } from "@/shared/zod";

/**
 * Assicurazioni e sinistri: polizze, garanzie (copiate a mano), premi, sinistri e comunicazioni.
 * L'app registra e ricorda: non interpreta le condizioni di polizza e non stabilisce se un sinistro sia coperto,
 * quanto verra' liquidato o se un termine di denuncia sia rispettato.
 */

export const CLAIM_STATUSES = ["open", "reported", "in_review", "settled", "closed"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];
export const ENTRY_DIRECTIONS = ["sent", "received", "note"] as const;
export type EntryDirection = (typeof ENTRY_DIRECTIONS)[number];

const flag = z.boolean().default(false);
const ordered = (a: string | undefined, b: string | undefined) => !a || !b || b >= a;

export const policySchema = z
  .object({
    title: requiredText("Titolo", 200),
    insurerPartyId: optionalUuid,
    agentPartyId: optionalUuid,
    policyNumber: optionalText(80),
    startsOn: optionalDate,
    endsOn: optionalDate,
    premium: optionalEuroAmount("Premio annuo"),
    note: optionalText(1000),
    documentId: optionalUuid,
    assetIds: z.array(z.uuid("Scelta non valida")).max(100).default([]),
    /** Solo in creazione: crea un promemoria alla data di fine (rinnovo). */
    createDeadline: flag,
  })
  .superRefine((p, ctx) => {
    if (!ordered(p.startsOn, p.endsOn)) ctx.addIssue({ code: "custom", path: ["endsOn"], message: "La data di fine è precedente a quella di inizio" });
  });

export const coverageSchema = z.object({
  title: requiredText("Garanzia", 200),
  sumInsured: optionalEuroAmount("Somma assicurata"),
  deductible: optionalEuroAmount("Franchigia"),
  note: optionalText(500),
});

export const premiumSchema = z.object({
  dueOn: requiredDate,
  amount: euroAmount("Importo"),
  paidOn: optionalDate,
  documentId: optionalUuid,
  createDeadline: flag,
});

export const premiumPaidSchema = z.object({ paidOn: requiredDate, documentId: optionalUuid });

export const claimSchema = z
  .object({
    policyId: z.uuid("Scegli la polizza"),
    assetId: optionalUuid,
    title: requiredText("Titolo", 200),
    claimNumber: optionalText(80),
    occurredOn: requiredDate,
    reportedOn: optionalDate,
    status: z.enum(CLAIM_STATUSES, { error: "Scegli lo stato" }).default("open"),
    claimed: optionalEuroAmount("Importo richiesto"),
    received: optionalEuroAmount("Importo ricevuto"),
    adjusterPartyId: optionalUuid,
    matterId: optionalUuid,
    description: optionalText(2000),
  })
  .superRefine((c, ctx) => {
    if (!ordered(c.occurredOn, c.reportedOn)) ctx.addIssue({ code: "custom", path: ["reportedOn"], message: "La data della denuncia è precedente a quella dell'evento" });
  });

export type ClaimInput = z.output<typeof claimSchema>;

export const claimEntrySchema = z.object({
  entryOn: optionalDate,
  direction: z.enum(ENTRY_DIRECTIONS, { error: "Scegli il tipo" }).default("note"),
  summary: requiredText("Riepilogo", 1000),
  documentId: optionalUuid,
});

/** Un sinistro e' «aperto» finche' non e' liquidato o chiuso dal proprietario. */
export const isClaimOpen = (status: ClaimStatus): boolean => status !== "settled" && status !== "closed";

/** Un premio non pagato con scadenza passata (dai soli dati inseriti). */
export const premiumOverdue = (p: { paidOn: string | null; dueOn: string }, today: string): boolean => p.paidOn === null && p.dueOn < today;
