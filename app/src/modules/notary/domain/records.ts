import { optionalDate, optionalEuroAmount, optionalText, optionalUuid, requiredText, z } from "@/shared/zod";

/**
 * Provenienza e gravami di un immobile come dati scritti dal proprietario. L'app non li verifica (non consulta registri) e non
 * dice se un gravame sia valido, estinto o opponibile: riporta quello che c'e' scritto, con le date che il proprietario indica.
 */

export const PROVENANCE_KINDS = ["purchase", "inheritance", "donation", "division", "exchange", "other"] as const;
export type ProvenanceKind = (typeof PROVENANCE_KINDS)[number];

export const ENCUMBRANCE_KINDS = ["mortgage", "easement", "restriction", "seizure", "usage_right", "other"] as const;
export type EncumbranceKind = (typeof ENCUMBRANCE_KINDS)[number];

export const provenanceSchema = z.object({
  assetId: z.uuid("Scegli l'immobile"),
  kind: z.enum(PROVENANCE_KINDS, { error: "Scegli il tipo di provenienza" }),
  occurredOn: optionalDate,
  fromPartyId: optionalUuid,
  notaryPartyId: optionalUuid,
  deedReference: optionalText(200),
  documentId: optionalUuid,
  note: optionalText(1000),
});

export const encumbranceSchema = z
  .object({
    assetId: z.uuid("Scegli l'immobile"),
    kind: z.enum(ENCUMBRANCE_KINDS, { error: "Scegli il tipo di gravame o vincolo" }),
    title: requiredText("Titolo", 200),
    registeredOn: optionalDate,
    endedOn: optionalDate,
    beneficiaryPartyId: optionalUuid,
    amount: optionalEuroAmount("Importo"),
    reference: optionalText(200),
    documentId: optionalUuid,
    note: optionalText(1000),
  })
  .superRefine((e, ctx) => {
    if (e.registeredOn && e.endedOn && e.endedOn < e.registeredOn) ctx.addIssue({ code: "custom", path: ["endedOn"], message: "La data di fine è precedente a quella di registrazione" });
  });
