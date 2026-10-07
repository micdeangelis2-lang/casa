"use server";

import { addEncumbrance, addProvenance, removeEncumbrance, removeProvenance, updateEncumbrance, updateProvenance } from "@/modules/notary";
import { isUuid } from "@/lib/ids";
import { ownerAction, type MiniResult } from "@/lib/owner-action";
import type { FormValues } from "@/components/simple-form";

const text = (v: FormValues, k: string) => (typeof v[k] === "string" ? (v[k] as string) : "");
const notFound = (): MiniResult => ({ errors: { _: ["Elemento non trovato"] } });
const pages = (assetId: string) => [`/immobili/${assetId}/notaio`, `/immobili/${assetId}`];

const provenancePayload = (assetId: string, values: FormValues) => ({
  assetId,
  kind: text(values, "kind"),
  occurredOn: text(values, "occurredOn"),
  fromPartyId: text(values, "fromPartyId"),
  notaryPartyId: text(values, "notaryPartyId"),
  deedReference: text(values, "deedReference"),
  documentId: text(values, "documentId"),
  note: text(values, "note"),
});

const encumbrancePayload = (assetId: string, values: FormValues) => ({
  assetId,
  kind: text(values, "kind"),
  title: text(values, "title"),
  registeredOn: text(values, "registeredOn"),
  endedOn: text(values, "endedOn"),
  beneficiaryPartyId: text(values, "beneficiaryPartyId"),
  amount: text(values, "amount"),
  reference: text(values, "reference"),
  documentId: text(values, "documentId"),
  note: text(values, "note"),
});

export async function addProvenanceAction(assetId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(assetId)) return notFound();
  const payload = provenancePayload(assetId, values);
  return ownerAction((uow) => addProvenance(uow, payload), pages(assetId));
}

export async function updateProvenanceAction(assetId: string, provenanceId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(assetId) || !isUuid(provenanceId)) return notFound();
  const payload = provenancePayload(assetId, values);
  return ownerAction((uow) => updateProvenance(uow, provenanceId, payload), pages(assetId));
}

export async function removeProvenanceAction(assetId: string, provenanceId: string): Promise<void> {
  if (isUuid(assetId) && isUuid(provenanceId)) await ownerAction((uow) => removeProvenance(uow, provenanceId), pages(assetId));
}

export async function addEncumbranceAction(assetId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(assetId)) return notFound();
  const payload = encumbrancePayload(assetId, values);
  return ownerAction((uow) => addEncumbrance(uow, payload), pages(assetId));
}

export async function updateEncumbranceAction(assetId: string, encumbranceId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(assetId) || !isUuid(encumbranceId)) return notFound();
  const payload = encumbrancePayload(assetId, values);
  return ownerAction((uow) => updateEncumbrance(uow, encumbranceId, payload), pages(assetId));
}

export async function removeEncumbranceAction(assetId: string, encumbranceId: string): Promise<void> {
  if (isUuid(assetId) && isUuid(encumbranceId)) await ownerAction((uow) => removeEncumbrance(uow, encumbranceId), pages(assetId));
}
