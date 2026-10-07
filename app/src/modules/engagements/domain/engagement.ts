import { optionalEuroAmount, optionalText, optionalUuid, requiredDate, requiredText, z } from "@/shared/zod";

/**
 * Incarichi a un professionista e elaborati scambiati. Sono dati scritti dal proprietario: l'app non valuta il compenso, non
 * dice se l'incarico sia stato svolto bene o completamente e non conosce tariffe o prestazioni.
 */

export const ENGAGEMENT_STATUSES = ["active", "completed", "cancelled"] as const;
export type EngagementStatus = (typeof ENGAGEMENT_STATUSES)[number];
/** `delivered`: consegnato dal proprietario al professionista; `received`: ricevuto dal professionista. */
export const DELIVERABLE_DIRECTIONS = ["delivered", "received"] as const;
export type DeliverableDirection = (typeof DELIVERABLE_DIRECTIONS)[number];

export const engagementSchema = z.object({
  partyId: z.uuid("Scegli il professionista dalla rubrica"),
  subject: requiredText("Oggetto", 200),
  engagedOn: requiredDate,
  declaredFee: optionalEuroAmount("Compenso dichiarato"),
  status: z.enum(ENGAGEMENT_STATUSES, { error: "Scegli lo stato" }).default("active"),
  assetId: optionalUuid,
  matterId: optionalUuid,
  documentId: optionalUuid,
  note: optionalText(500),
});
export type EngagementInput = z.output<typeof engagementSchema>;

export const deliverableSchema = z.object({
  direction: z.enum(DELIVERABLE_DIRECTIONS, { error: "Scegli se è consegnato o ricevuto" }),
  kindLabel: requiredText("Tipo di elaborato", 120),
  occurredOn: requiredDate,
  documentId: optionalUuid,
  note: optionalText(500),
});

export const isEngagementOpen = (status: EngagementStatus): boolean => status === "active";
