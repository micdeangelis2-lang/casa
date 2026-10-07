import { optionalDate, optionalEuroAmount, optionalText, optionalUuid, requiredDate, z } from "@/shared/zod";

/**
 * Mandato di vendita o affitto a un agente immobiliare, con le visite e le proposte che il proprietario registra. L'app non
 * stima prezzi, non valuta proposte e non conserva dati personali di chi visita (al piu' un contatto della rubrica scelto
 * dal proprietario): riporta quello che e' stato scritto.
 */

export const LISTING_KINDS = ["sale", "rent"] as const;
export type ListingKind = (typeof LISTING_KINDS)[number];

export const LISTING_STATUSES = ["active", "ended"] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const LISTING_EVENT_KINDS = ["visit", "proposal", "counterproposal", "note"] as const;
export type ListingEventKind = (typeof LISTING_EVENT_KINDS)[number];

/** Esito di una proposta, scelto dal proprietario. */
export const LISTING_OUTCOMES = ["open", "accepted", "rejected", "withdrawn"] as const;
export type ListingOutcome = (typeof LISTING_OUTCOMES)[number];

const flag = z.boolean().default(false);
/** "" -> undefined, per i campi a scelta facoltativa. */
const optionalEnum = <T extends readonly [string, ...string[]]>(values: T, error: string) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.enum(values, { error }).optional());

export const engagementSchema = z
  .object({
    assetId: z.uuid("Scegli l'immobile"),
    kind: z.enum(LISTING_KINDS, { error: "Scegli se è una vendita o un affitto" }),
    agentPartyId: optionalUuid,
    startsOn: optionalDate,
    endsOn: optionalDate,
    exclusive: flag,
    asking: optionalEuroAmount("Prezzo o canone richiesto"),
    commission: optionalText(200),
    documentId: optionalUuid,
    note: optionalText(1000),
  })
  .superRefine((e, ctx) => {
    if (e.startsOn && e.endsOn && e.endsOn < e.startsOn) ctx.addIssue({ code: "custom", path: ["endsOn"], message: "La data di fine è precedente a quella di inizio" });
  });

export const listingEventSchema = z.object({
  kind: z.enum(LISTING_EVENT_KINDS, { error: "Scegli il tipo" }),
  occurredOn: requiredDate,
  amount: optionalEuroAmount("Importo"),
  outcome: optionalEnum(LISTING_OUTCOMES, "Scegli l'esito"),
  contactPartyId: optionalUuid,
  note: optionalText(500),
});

export type EngagementInput = z.output<typeof engagementSchema>;
export type ListingEventInput = z.output<typeof listingEventSchema>;
