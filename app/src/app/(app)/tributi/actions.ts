"use server";

import { redirect } from "next/navigation";
import { requireOwner } from "@/platform/auth/owner";
import {
  closeObligation,
  createObligation,
  createObligationDeadline,
  createReturn,
  createTaxType,
  recordPayment,
  removePayment,
  reopenObligation,
  setTaxTypeArchived,
  updateObligation,
  updateReturn,
  updateTaxType,
} from "@/modules/taxes";
import { isUuid } from "@/lib/ids";
import { ownerAction, ownerActionWithValue, type MiniResult } from "@/lib/owner-action";
import type { FormValues } from "@/components/simple-form";
import type { FieldErrors } from "@/shared/result";

export type SaveResult = { errors: FieldErrors } | undefined;
const text = (v: FormValues, k: string) => (typeof v[k] === "string" ? (v[k] as string) : "");
const flag = (v: FormValues, k: string) => v[k] === true;
const notFound = (): MiniResult => ({ errors: { _: ["Elemento non trovato"] } });
const detail = (id: string) => [`/tributi/${id}`, "/tributi", "/tributi/riepilogo"];
const withDeadlines = (paths: string[]) => [...paths, "/scadenze", "/"];

// ---- voci --------------------------------------------------------------------------------------------------------

const obligationPayload = (v: FormValues) => ({
  assetId: text(v, "assetId"),
  taxTypeId: text(v, "taxTypeId"),
  year: text(v, "year"),
  label: text(v, "label"),
  dueOn: text(v, "dueOn"),
  expected: text(v, "expected"),
  note: text(v, "note"),
  askAdviser: flag(v, "askAdviser"),
  createDeadline: flag(v, "createDeadline"),
});

export async function saveObligationAction(obligationId: string | null, values: FormValues): Promise<SaveResult> {
  await requireOwner();
  if (obligationId !== null && !isUuid(obligationId)) return { errors: { _: ["Voce non trovata"] } };
  const payload = obligationPayload(values);
  const result = await ownerActionWithValue((uow) => (obligationId ? updateObligation(uow, obligationId, payload) : createObligation(uow, payload)), withDeadlines(["/tributi", "/tributi/riepilogo"]));
  if (!result.ok) return { errors: result.errors };
  redirect(`/tributi/${result.value.id}`);
}

export async function createObligationDeadlineAction(obligationId: string): Promise<MiniResult> {
  return isUuid(obligationId) ? ownerAction((uow) => createObligationDeadline(uow, obligationId), withDeadlines(detail(obligationId))) : notFound();
}

export async function closeObligationAction(obligationId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(obligationId)) return notFound();
  return ownerAction((uow) => closeObligation(uow, obligationId, { reason: text(values, "reason"), closedOn: text(values, "closedOn") }), withDeadlines(detail(obligationId)));
}

export async function reopenObligationAction(obligationId: string): Promise<void> {
  if (isUuid(obligationId)) await ownerAction((uow) => reopenObligation(uow, obligationId), detail(obligationId));
}

// ---- pagamenti ---------------------------------------------------------------------------------------------------

export async function recordPaymentAction(obligationId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(obligationId)) return notFound();
  const payload = { paidOn: text(values, "paidOn"), amount: text(values, "amount"), method: text(values, "method") || "other", kind: text(values, "kind") || "ordinary", penalty: text(values, "penalty"), interest: text(values, "interest"), reference: text(values, "reference"), documentId: text(values, "documentId"), note: text(values, "note") };
  return ownerAction((uow) => recordPayment(uow, obligationId, payload), withDeadlines(detail(obligationId)));
}

export async function removePaymentAction(obligationId: string, paymentId: string): Promise<void> {
  if (isUuid(obligationId) && isUuid(paymentId)) await ownerAction((uow) => removePayment(uow, paymentId), detail(obligationId));
}

// ---- tipi di tributo ---------------------------------------------------------------------------------------------

const typePayload = (v: FormValues) => ({ name: text(v, "name"), kind: text(v, "kind") || "tax", territoryId: text(v, "territoryId"), source: text(v, "source"), notes: text(v, "notes") });
const typePaths = ["/tributi/tipi", "/tributi"];

export async function createTaxTypeAction(values: FormValues): Promise<MiniResult> {
  return ownerAction((uow) => createTaxType(uow, typePayload(values)), typePaths);
}

export async function updateTaxTypeAction(typeId: string, values: FormValues): Promise<MiniResult> {
  return isUuid(typeId) ? ownerAction((uow) => updateTaxType(uow, typeId, typePayload(values)), typePaths) : notFound();
}

export async function archiveTaxTypeAction(typeId: string, archived: boolean): Promise<void> {
  if (isUuid(typeId)) await ownerAction((uow) => setTaxTypeArchived(uow, typeId, archived), typePaths);
}

// ---- dichiarazioni -----------------------------------------------------------------------------------------------

const returnPayload = (v: FormValues) => ({
  title: text(v, "title"),
  taxTypeId: text(v, "taxTypeId"),
  assetId: text(v, "assetId"),
  year: text(v, "year"),
  dueOn: text(v, "dueOn"),
  filedOn: text(v, "filedOn"),
  protocol: text(v, "protocol"),
  documentId: text(v, "documentId"),
  askAdviser: flag(v, "askAdviser"),
  note: text(v, "note"),
  createDeadline: flag(v, "createDeadline"),
});
const returnPaths = ["/tributi/dichiarazioni", "/tributi/riepilogo"];

export async function createReturnAction(values: FormValues): Promise<MiniResult> {
  return ownerAction((uow) => createReturn(uow, returnPayload(values)), withDeadlines(returnPaths));
}

export async function updateReturnAction(returnId: string, values: FormValues): Promise<MiniResult> {
  return isUuid(returnId) ? ownerAction((uow) => updateReturn(uow, returnId, returnPayload(values)), withDeadlines(returnPaths)) : notFound();
}
