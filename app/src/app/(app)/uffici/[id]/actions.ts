"use server";

import { createFormTemplate, setFormTemplateArchived, updateFormTemplate } from "@/modules/offices";
import { isUuid } from "@/lib/ids";
import { ownerAction, type MiniResult } from "@/lib/owner-action";
import type { FormValues } from "@/components/simple-form";

const text = (v: FormValues, k: string) => (typeof v[k] === "string" ? (v[k] as string) : "");
const paths = (officeId: string) => [`/uffici/${officeId}`];

const payload = (officeId: string, v: FormValues) => ({
  officePartyId: officeId,
  name: text(v, "name"),
  checklist: text(v, "checklist"),
  source: text(v, "source"),
  verifiedOn: text(v, "verifiedOn"),
  verificationStatus: text(v, "verificationStatus") || "to_verify",
  note: text(v, "note"),
});

/** Annota un modulo dell'ufficio (checklist di documenti, fonte, data e stato di verifica). */
export async function createFormTemplateAction(officeId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(officeId)) return { errors: { _: ["Ufficio non trovato"] } };
  return ownerAction((uow) => createFormTemplate(uow, payload(officeId, values)), paths(officeId));
}

export async function updateFormTemplateAction(officeId: string, templateId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(officeId) || !isUuid(templateId)) return { errors: { _: ["Modulo non trovato"] } };
  return ownerAction((uow) => updateFormTemplate(uow, templateId, payload(officeId, values)), paths(officeId));
}

export async function archiveFormTemplateAction(officeId: string, templateId: string): Promise<void> {
  if (isUuid(officeId) && isUuid(templateId)) await ownerAction((uow) => setFormTemplateArchived(uow, templateId, true), paths(officeId));
}
