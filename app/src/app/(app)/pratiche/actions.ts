"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { addEvent, addOpinion, addRequest, assignParty, createMatter, linkMatterDocument, removeEvent, resolveRequest, unassignParty, unlinkMatterDocument, updateMatter } from "@/modules/matters";
import { isUuid } from "@/lib/ids";
import type { FormValues } from "@/components/simple-form";
import type { FieldErrors } from "@/shared/result";

export type SaveResult = { errors: FieldErrors } | undefined;
type Mini = { errors?: FieldErrors };
const asOwner = (userId: string) => ({ type: "owner", id: userId }) as const;
const refresh = (id?: string) => {
  revalidatePath("/pratiche");
  if (id) revalidatePath(`/pratiche/${id}`);
};
const text = (v: FormValues, k: string) => (typeof v[k] === "string" ? (v[k] as string) : "");

export async function saveMatterAction(matterId: string | null, values: FormValues): Promise<SaveResult> {
  const owner = await requireOwner();
  if (matterId !== null && !isUuid(matterId)) return { errors: { _: ["Pratica non trovata"] } };
  const payload = { title: text(values, "title"), description: text(values, "description"), assetId: text(values, "assetId"), status: text(values, "status") || "open", openedOn: text(values, "openedOn"), officePartyId: text(values, "officePartyId"), protocolNumber: text(values, "protocolNumber"), submittedOn: text(values, "submittedOn"), responseDueOn: text(values, "responseDueOn") };
  const result = await runInUnitOfWork(getDb(), asOwner(owner.userId), (uow) => (matterId ? updateMatter(uow, matterId, payload) : createMatter(uow, payload)));
  if (!result.ok) return { errors: result.errors };
  refresh(result.value.id);
  redirect(`/pratiche/${result.value.id}`);
}

async function mini(matterId: string, work: (uow: Parameters<Parameters<typeof runInUnitOfWork>[2]>[0]) => Promise<{ ok: boolean; errors?: FieldErrors }>): Promise<Mini> {
  const owner = await requireOwner();
  if (!isUuid(matterId)) return { errors: { _: ["Pratica non trovata"] } };
  const result = await runInUnitOfWork(getDb(), asOwner(owner.userId), work);
  refresh(matterId);
  return result.ok ? {} : { errors: result.errors };
}

export async function assignAction(matterId: string, payload: unknown): Promise<Mini> {
  return mini(matterId, (uow) => assignParty(uow, matterId, payload));
}

export async function unassignAction(matterId: string, partyId: string): Promise<void> {
  if (isUuid(partyId)) await mini(matterId, (uow) => unassignParty(uow, matterId, partyId));
}

export async function addRequestAction(matterId: string, payload: unknown): Promise<Mini> {
  return mini(matterId, (uow) => addRequest(uow, matterId, payload));
}

export async function resolveRequestAction(matterId: string, requestId: string, payload: unknown): Promise<Mini> {
  if (!isUuid(requestId)) return { errors: { _: ["Richiesta non trovata"] } };
  return mini(matterId, (uow) => resolveRequest(uow, requestId, payload));
}

export async function addOpinionAction(matterId: string, payload: unknown): Promise<Mini> {
  return mini(matterId, (uow) => addOpinion(uow, matterId, payload));
}

export async function addEventAction(matterId: string, payload: unknown): Promise<Mini> {
  return mini(matterId, (uow) => addEvent(uow, matterId, payload));
}

export async function removeEventAction(matterId: string, eventId: string): Promise<void> {
  if (isUuid(eventId)) await mini(matterId, (uow) => removeEvent(uow, matterId, eventId));
}

export async function linkDocumentAction(matterId: string, documentId: string): Promise<Mini> {
  if (!isUuid(documentId)) return { errors: { documentId: ["Documento non valido"] } };
  return mini(matterId, (uow) => linkMatterDocument(uow, matterId, documentId));
}

export async function unlinkDocumentAction(matterId: string, documentId: string): Promise<void> {
  if (isUuid(documentId)) await mini(matterId, (uow) => unlinkMatterDocument(uow, matterId, documentId));
}
