"use server";

import { addDeliverable, createEngagement, removeDeliverable, setEngagementStatus, updateEngagement } from "@/modules/engagements";
import { isUuid } from "@/lib/ids";
import { ownerAction, type MiniResult } from "@/lib/owner-action";
import type { FormValues } from "@/components/simple-form";

const text = (v: FormValues, k: string) => (typeof v[k] === "string" ? (v[k] as string) : "");
const PATHS = ["/pratiche/incarichi"];
const notFound = (): MiniResult => ({ errors: { _: ["Incarico non trovato"] } });

const engagementPayload = (v: FormValues) => ({
  partyId: text(v, "partyId"),
  subject: text(v, "subject"),
  engagedOn: text(v, "engagedOn"),
  declaredFee: text(v, "declaredFee"),
  status: text(v, "status") || "active",
  assetId: text(v, "assetId"),
  matterId: text(v, "matterId"),
  documentId: text(v, "documentId"),
  note: text(v, "note"),
});

export async function createEngagementAction(values: FormValues): Promise<MiniResult> {
  return ownerAction((uow) => createEngagement(uow, engagementPayload(values)), PATHS);
}

export async function updateEngagementAction(engagementId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(engagementId)) return notFound();
  return ownerAction((uow) => updateEngagement(uow, engagementId, engagementPayload(values)), PATHS);
}

export async function setEngagementStatusAction(engagementId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(engagementId)) return notFound();
  return ownerAction((uow) => setEngagementStatus(uow, engagementId, text(values, "status")), PATHS);
}

export async function addDeliverableAction(engagementId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(engagementId)) return notFound();
  const payload = { direction: text(values, "direction"), kindLabel: text(values, "kindLabel"), occurredOn: text(values, "occurredOn"), documentId: text(values, "documentId"), note: text(values, "note") };
  return ownerAction((uow) => addDeliverable(uow, engagementId, payload), PATHS);
}

export async function removeDeliverableAction(deliverableId: string): Promise<void> {
  if (isUuid(deliverableId)) await ownerAction((uow) => removeDeliverable(uow, deliverableId), PATHS);
}
