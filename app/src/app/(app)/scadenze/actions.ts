"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import {
  addOccurrence,
  addProof,
  cancelOccurrence,
  completeOccurrence,
  createDeadline,
  markNotificationRead,
  reopenOccurrence,
  setDeadlineArchived,
  snoozeOccurrence,
  updateDeadline,
  updateOwnerFields,
  type Priority,
} from "@/modules/deadlines";
import { isUuid } from "@/lib/ids";
import type { FormValues } from "@/components/simple-form";
import type { FieldErrors } from "@/shared/result";
import { deadlinePayload } from "./_components/deadline-form-data";

export type SaveResult = { errors: FieldErrors } | undefined;
const asOwner = (userId: string) => ({ type: "owner", id: userId }) as const;
const refresh = (id?: string) => {
  revalidatePath("/scadenze");
  revalidatePath("/avvisi");
  revalidatePath("/", "layout");
  if (id) revalidatePath(`/scadenze/${id}`);
};

/** Crea (id nullo) o modifica una scadenza scritta a mano. Con successo reindirizza alla scheda. */
export async function saveDeadlineAction(deadlineId: string | null, values: FormValues): Promise<SaveResult> {
  const owner = await requireOwner();
  if (deadlineId !== null && !isUuid(deadlineId)) return { errors: { _: ["Scadenza non trovata"] } };
  const payload = deadlinePayload(values);
  const result = await runInUnitOfWork(getDb(), asOwner(owner.userId), (uow) => (deadlineId ? updateDeadline(uow, deadlineId, payload) : createDeadline(uow, payload)));
  if (!result.ok) return { errors: result.errors };
  refresh(result.value.id);
  redirect(`/scadenze/${result.value.id}`);
}

/** Per le scadenze che vengono da una regola: solo responsabile, professionista, priorita' e preavvisi. */
export async function saveOwnerFieldsAction(deadlineId: string, values: FormValues): Promise<SaveResult> {
  const owner = await requireOwner();
  if (!isUuid(deadlineId)) return { errors: { _: ["Scadenza non trovata"] } };
  const text = (k: string) => (typeof values[k] === "string" ? (values[k] as string) : "");
  const days = text("leadDays").split(/[,\s;]+/).filter(Boolean).map(Number);
  if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 730)) return { errors: { leadDays: ["Indica numeri interi di giorni, separati da virgola"] } };
  const result = await runInUnitOfWork(getDb(), asOwner(owner.userId), (uow) =>
    updateOwnerFields(uow, deadlineId, {
      responsiblePartyId: text("responsiblePartyId") || undefined,
      professionalPartyId: text("professionalPartyId") || undefined,
      matterId: text("matterId") || undefined,
      priority: (text("priority") || undefined) as Priority | undefined,
      leadDays: days.length > 0 ? days : undefined,
    }),
  );
  if (!result.ok) return { errors: result.errors };
  refresh(deadlineId);
  redirect(`/scadenze/${deadlineId}`);
}

export async function archiveDeadlineAction(deadlineId: string, archived: boolean): Promise<void> {
  const owner = await requireOwner();
  if (!isUuid(deadlineId)) return;
  await runInUnitOfWork(getDb(), asOwner(owner.userId), (uow) => setDeadlineArchived(uow, deadlineId, archived));
  refresh(deadlineId);
}

export async function addOccurrenceAction(deadlineId: string, dueOn: string): Promise<{ errors?: FieldErrors }> {
  const owner = await requireOwner();
  if (!isUuid(deadlineId)) return { errors: { _: ["Scadenza non trovata"] } };
  const result = await runInUnitOfWork(getDb(), asOwner(owner.userId), (uow) => addOccurrence(uow, deadlineId, dueOn));
  refresh(deadlineId);
  return result.ok ? {} : { errors: result.errors };
}

export async function completeOccurrenceAction(deadlineId: string, occurrenceId: string, payload: unknown): Promise<{ errors?: FieldErrors }> {
  const owner = await requireOwner();
  if (!isUuid(deadlineId) || !isUuid(occurrenceId)) return { errors: { _: ["Data non trovata"] } };
  const result = await runInUnitOfWork(getDb(), asOwner(owner.userId), (uow) => completeOccurrence(uow, occurrenceId, payload));
  refresh(deadlineId);
  return result.ok ? {} : { errors: result.errors };
}

export async function addProofAction(deadlineId: string, occurrenceId: string, proof: { documentId?: string; reference?: string }): Promise<{ errors?: FieldErrors }> {
  const owner = await requireOwner();
  if (!isUuid(deadlineId) || !isUuid(occurrenceId)) return { errors: { _: ["Data non trovata"] } };
  const result = await runInUnitOfWork(getDb(), asOwner(owner.userId), (uow) => addProof(uow, occurrenceId, proof));
  refresh(deadlineId);
  return result.ok ? {} : { errors: result.errors };
}

export async function occurrenceAction(deadlineId: string, occurrenceId: string, action: "reopen" | "cancel"): Promise<void> {
  const owner = await requireOwner();
  if (!isUuid(deadlineId) || !isUuid(occurrenceId)) return;
  await runInUnitOfWork(getDb(), asOwner(owner.userId), (uow) => (action === "reopen" ? reopenOccurrence(uow, occurrenceId) : cancelOccurrence(uow, occurrenceId)));
  refresh(deadlineId);
}

export async function snoozeAction(deadlineId: string, occurrenceId: string, until: string): Promise<{ errors?: FieldErrors }> {
  const owner = await requireOwner();
  if (!isUuid(deadlineId) || !isUuid(occurrenceId)) return { errors: { _: ["Data non trovata"] } };
  const result = await runInUnitOfWork(getDb(), asOwner(owner.userId), (uow) => snoozeOccurrence(uow, occurrenceId, until));
  refresh(deadlineId);
  return result.ok ? {} : { errors: result.errors };
}

export async function markReadAction(id: string | null): Promise<void> {
  const owner = await requireOwner();
  if (id !== null && !isUuid(id)) return;
  await runInUnitOfWork(getDb(), asOwner(owner.userId), (uow) => markNotificationRead(uow, id));
  refresh();
}
