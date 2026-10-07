"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { addManualItem, evaluateDossier, linkDocument, removeManualItem, setItemNote, setItemStatus, unlinkDocument, type EvaluationDiff } from "@/modules/dossier";
import { isUuid } from "@/lib/ids";
import type { FieldErrors } from "@/shared/result";

const asOwner = (userId: string) => ({ type: "owner", id: userId }) as const;
const refresh = (assetId: string) => revalidatePath(`/immobili/${assetId}/dossier`);

export type EvaluateResult = { ok: true; diff: EvaluationDiff } | { ok: false; message: string };

export async function evaluateAction(assetId: string): Promise<EvaluateResult> {
  const owner = await requireOwner();
  if (!isUuid(assetId)) return { ok: false, message: "Bene non trovato" };
  const result = await runInUnitOfWork(getDb(), asOwner(owner.userId), (uow) => evaluateDossier(uow, assetId));
  refresh(assetId);
  return result.ok ? { ok: true, diff: result.value } : { ok: false, message: Object.values(result.errors).flat().join("; ") };
}

export async function setStatusAction(assetId: string, itemId: string, status: string): Promise<void> {
  const owner = await requireOwner();
  if (!isUuid(assetId) || !isUuid(itemId)) return;
  await runInUnitOfWork(getDb(), asOwner(owner.userId), (uow) => setItemStatus(uow, itemId, status));
  refresh(assetId);
}

export async function saveNoteAction(assetId: string, itemId: string, note: string): Promise<{ error?: string }> {
  const owner = await requireOwner();
  if (!isUuid(assetId) || !isUuid(itemId)) return { error: "Voce non trovata" };
  const result = await runInUnitOfWork(getDb(), asOwner(owner.userId), (uow) => setItemNote(uow, itemId, note));
  refresh(assetId);
  return result.ok ? {} : { error: Object.values(result.errors).flat().join("; ") };
}

export async function linkDocumentAction(assetId: string, itemId: string, documentId: string): Promise<void> {
  const owner = await requireOwner();
  if (!isUuid(assetId) || !isUuid(itemId) || !isUuid(documentId)) return;
  await runInUnitOfWork(getDb(), asOwner(owner.userId), (uow) => linkDocument(uow, itemId, documentId));
  refresh(assetId);
}

export async function unlinkDocumentAction(assetId: string, itemId: string, documentId: string): Promise<void> {
  const owner = await requireOwner();
  if (!isUuid(assetId) || !isUuid(itemId) || !isUuid(documentId)) return;
  await runInUnitOfWork(getDb(), asOwner(owner.userId), (uow) => unlinkDocument(uow, itemId, documentId));
  refresh(assetId);
}

export async function deleteItemAction(assetId: string, itemId: string): Promise<void> {
  const owner = await requireOwner();
  if (!isUuid(assetId) || !isUuid(itemId)) return;
  await runInUnitOfWork(getDb(), asOwner(owner.userId), (uow) => removeManualItem(uow, itemId));
  refresh(assetId);
}

export async function addItemAction(assetId: string, payload: unknown): Promise<{ errors?: FieldErrors }> {
  const owner = await requireOwner();
  if (!isUuid(assetId)) return { errors: { _: ["Bene non trovato"] } };
  const result = await runInUnitOfWork(getDb(), asOwner(owner.userId), (uow) => addManualItem(uow, assetId, payload));
  refresh(assetId);
  return result.ok ? {} : { errors: result.errors };
}
