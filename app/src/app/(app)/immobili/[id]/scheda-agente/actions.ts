"use server";

import { addEngagement, addListingEvent, removeEngagement, removeListingEvent, setEngagementStatus, updateEngagement, updateListingEvent } from "@/modules/agent";
import { isUuid } from "@/lib/ids";
import { ownerAction, type MiniResult } from "@/lib/owner-action";
import type { FormValues } from "@/components/simple-form";

const text = (v: FormValues, k: string) => (typeof v[k] === "string" ? (v[k] as string) : "");
const notFound = (): MiniResult => ({ errors: { _: ["Elemento non trovato"] } });
const pages = (assetId: string) => [`/immobili/${assetId}/scheda-agente`];

export async function addEngagementAction(assetId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(assetId)) return notFound();
  const payload = {
    assetId,
    kind: text(values, "kind"),
    agentPartyId: text(values, "agentPartyId"),
    startsOn: text(values, "startsOn"),
    endsOn: text(values, "endsOn"),
    exclusive: values.exclusive === true,
    asking: text(values, "asking"),
    commission: text(values, "commission"),
    documentId: text(values, "documentId"),
    note: text(values, "note"),
  };
  return ownerAction((uow) => addEngagement(uow, payload), pages(assetId));
}

export async function setEngagementStatusAction(assetId: string, engagementId: string, status: string): Promise<void> {
  if (isUuid(assetId) && isUuid(engagementId)) await ownerAction((uow) => setEngagementStatus(uow, engagementId, status), pages(assetId));
}

export async function removeEngagementAction(assetId: string, engagementId: string): Promise<void> {
  if (isUuid(assetId) && isUuid(engagementId)) await ownerAction((uow) => removeEngagement(uow, engagementId), pages(assetId));
}

export async function addListingEventAction(assetId: string, engagementId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(assetId) || !isUuid(engagementId)) return notFound();
  const payload = {
    kind: text(values, "kind"),
    occurredOn: text(values, "occurredOn"),
    amount: text(values, "amount"),
    outcome: text(values, "outcome"),
    contactPartyId: text(values, "contactPartyId"),
    note: text(values, "note"),
  };
  return ownerAction((uow) => addListingEvent(uow, engagementId, payload), pages(assetId));
}

export async function removeListingEventAction(assetId: string, eventId: string): Promise<void> {
  if (isUuid(assetId) && isUuid(eventId)) await ownerAction((uow) => removeListingEvent(uow, eventId), pages(assetId));
}

export async function updateEngagementAction(assetId: string, engagementId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(assetId) || !isUuid(engagementId)) return notFound();
  const payload = {
    assetId,
    kind: text(values, "kind"),
    agentPartyId: text(values, "agentPartyId"),
    startsOn: text(values, "startsOn"),
    endsOn: text(values, "endsOn"),
    exclusive: values.exclusive === true,
    asking: text(values, "asking"),
    commission: text(values, "commission"),
    documentId: text(values, "documentId"),
    note: text(values, "note"),
  };
  return ownerAction((uow) => updateEngagement(uow, engagementId, payload), pages(assetId));
}

export async function updateListingEventAction(assetId: string, eventId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(assetId) || !isUuid(eventId)) return notFound();
  const payload = {
    kind: text(values, "kind"),
    occurredOn: text(values, "occurredOn"),
    amount: text(values, "amount"),
    outcome: text(values, "outcome"),
    contactPartyId: text(values, "contactPartyId"),
    note: text(values, "note"),
  };
  return ownerAction((uow) => updateListingEvent(uow, eventId, payload), pages(assetId));
}
