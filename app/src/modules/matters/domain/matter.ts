import { optionalDate, optionalText, requiredDate, requiredText, z } from "@/shared/zod";

export const MATTER_STATUSES = ["open", "in_progress", "waiting", "closed"] as const;
export type MatterStatus = (typeof MATTER_STATUSES)[number];

export const REQUEST_STATUSES = ["requested", "received", "not_available"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Natura di un parere: informativo, oppure validato formalmente. Lo sceglie chi lo registra, mai l'app. */
export const OPINION_NATURES = ["informational", "formally_validated"] as const;
export type OpinionNature = (typeof OPINION_NATURES)[number];

/** Tipi di fatto registrabili su una pratica. */
export const EVENT_KINDS = ["note", "hearing", "term", "communication", "meeting"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

const optionalUuid = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.uuid("Scelta non valida").optional());

export const matterInputSchema = z.object({
  title: requiredText("Titolo", 200),
  description: optionalText(2000),
  assetId: optionalUuid,
  status: z.enum(MATTER_STATUSES, { error: "Scegli lo stato" }).default("open"),
  openedOn: optionalDate,
  /** Ufficio destinatario (dalla rubrica), protocollo, data di presentazione e termine di risposta COMUNICATO dall'ufficio. */
  officePartyId: optionalUuid,
  protocolNumber: optionalText(80),
  submittedOn: optionalDate,
  responseDueOn: optionalDate,
});

export const eventSchema = z.object({
  kind: z.enum(EVENT_KINDS, { error: "Scegli il tipo" }),
  occurredOn: requiredDate,
  title: requiredText("Titolo", 200),
  note: optionalText(1500),
  partyId: optionalUuid,
  documentId: optionalUuid,
});

export const assignmentSchema = z.object({
  partyId: z.uuid("Scegli il contatto dalla rubrica"),
  role: optionalText(80),
});

export const requestSchema = z.object({
  title: requiredText("Documento richiesto", 200),
  requestedFromPartyId: optionalUuid,
  dueOn: optionalDate,
  note: optionalText(500),
});

export const resolveRequestSchema = z.object({
  status: z.enum(["received", "not_available", "requested"], { error: "Scegli l'esito" }),
  documentId: optionalUuid,
});

export const opinionSchema = z.object({
  partyId: z.uuid("Scegli il professionista dalla rubrica"),
  nature: z.enum(OPINION_NATURES, { error: "Indica se il parere è informativo o validato formalmente" }),
  summary: requiredText("Sintesi del parere", 1500),
  issuedOn: optionalDate,
  documentId: optionalUuid,
});
