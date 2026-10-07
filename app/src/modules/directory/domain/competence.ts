import { optionalDate, optionalText, optionalUuid, requiredText, z } from "@/shared/zod";

/**
 * Competenze di un contatto (iscrizione a un albo, abilitazione, polizza professionale, autorizzazione): dati scritti dal
 * proprietario con gli estremi che ha. L'app non li verifica presso gli albi e non dice se una persona sia abilitata o idonea.
 */

export const COMPETENCE_KINDS = ["registration", "qualification", "insurance", "authorization", "other"] as const;
export type CompetenceKind = (typeof COMPETENCE_KINDS)[number];

export const competenceSchema = z
  .object({
    kind: z.enum(COMPETENCE_KINDS, { error: "Scegli il tipo" }),
    label: requiredText("Descrizione", 200),
    reference: optionalText(120),
    issuer: optionalText(160),
    validFrom: optionalDate,
    validUntil: optionalDate,
    documentId: optionalUuid,
    note: optionalText(500),
  })
  .superRefine((c, ctx) => {
    if (c.validFrom && c.validUntil && c.validUntil < c.validFrom) ctx.addIssue({ code: "custom", path: ["validUntil"], message: "La data di fine è precedente a quella di inizio" });
  });

export type CompetenceRow = {
  id: string;
  partyId: string;
  kind: CompetenceKind;
  label: string;
  reference: string | null;
  issuer: string | null;
  validFrom: string | null;
  validUntil: string | null;
  documentId: string | null;
  note: string | null;
};
