"use server";

import { addCompetence, removeCompetence, updateCompetence } from "@/modules/directory";
import { isUuid } from "@/lib/ids";
import { ownerAction, type MiniResult } from "@/lib/owner-action";
import type { FormValues } from "@/components/simple-form";

const text = (v: FormValues, k: string) => (typeof v[k] === "string" ? (v[k] as string) : "");
const pages = (partyId: string) => [`/rubrica/${partyId}/modifica`, "/rubrica"];

export async function addCompetenceAction(partyId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(partyId)) return { errors: { _: ["Contatto non trovato"] } };
  const payload = {
    kind: text(values, "kind"),
    label: text(values, "label"),
    reference: text(values, "reference"),
    issuer: text(values, "issuer"),
    validFrom: text(values, "validFrom"),
    validUntil: text(values, "validUntil"),
    documentId: text(values, "documentId"),
    note: text(values, "note"),
  };
  return ownerAction((uow) => addCompetence(uow, partyId, payload), pages(partyId));
}

export async function removeCompetenceAction(partyId: string, competenceId: string): Promise<void> {
  if (isUuid(partyId) && isUuid(competenceId)) await ownerAction((uow) => removeCompetence(uow, competenceId), pages(partyId));
}

export async function updateCompetenceAction(partyId: string, competenceId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(partyId) || !isUuid(competenceId)) return { errors: { _: ["Elemento non trovato"] } };
  const payload = {
    kind: text(values, "kind"),
    label: text(values, "label"),
    reference: text(values, "reference"),
    issuer: text(values, "issuer"),
    validFrom: text(values, "validFrom"),
    validUntil: text(values, "validUntil"),
    documentId: text(values, "documentId"),
    note: text(values, "note"),
  };
  return ownerAction((uow) => updateCompetence(uow, competenceId, payload), pages(partyId));
}
