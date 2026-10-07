"use server";

import { redirect } from "next/navigation";
import { requireOwner } from "@/platform/auth/owner";
import {
  addInvoice,
  addProgress,
  addQuote,
  createInspectionPlan,
  createWarranty,
  createWork,
  removeEntry,
  setInvoicePaid,
  setPlanArchived,
  setQuoteStatus,
  setWarrantyArchived,
  setWorkStatus,
  updateWork,
} from "@/modules/maintenance";
import { isUuid } from "@/lib/ids";
import { ownerAction, ownerActionWithValue, type MiniResult } from "@/lib/owner-action";
import type { FormValues } from "@/components/simple-form";
import type { FieldErrors } from "@/shared/result";

export type SaveResult = { errors: FieldErrors } | undefined;
const text = (v: FormValues, k: string) => (typeof v[k] === "string" ? (v[k] as string) : "");
const flag = (v: FormValues, k: string) => v[k] === true;
const notFound = (): MiniResult => ({ errors: { _: ["Elemento non trovato"] } });
const withDeadlines = (paths: string[]) => [...paths, "/scadenze", "/"];
const work = (id: string) => [`/manutenzioni/${id}`, "/manutenzioni"];

// ---- interventi --------------------------------------------------------------------------------------------------

const workPayload = (v: FormValues) => ({
  assetId: text(v, "assetId"),
  title: text(v, "title"),
  description: text(v, "description"),
  status: text(v, "status") || "planned",
  supplierPartyId: text(v, "supplierPartyId"),
  scheduledOn: text(v, "scheduledOn"),
  startedOn: text(v, "startedOn"),
  completedOn: text(v, "completedOn"),
  budget: text(v, "budget"),
  note: text(v, "note"),
  createDeadline: flag(v, "createDeadline"),
});

export async function saveWorkAction(workId: string | null, values: FormValues): Promise<SaveResult> {
  await requireOwner();
  if (workId !== null && !isUuid(workId)) return { errors: { _: ["Intervento non trovato"] } };
  const payload = workPayload(values);
  const result = await ownerActionWithValue((uow) => (workId ? updateWork(uow, workId, payload) : createWork(uow, payload)), withDeadlines(["/manutenzioni"]));
  if (!result.ok) return { errors: result.errors };
  redirect(`/manutenzioni/${result.value.id}`);
}

export async function setWorkStatusAction(workId: string, values: FormValues): Promise<MiniResult> {
  return isUuid(workId) ? ownerAction((uow) => setWorkStatus(uow, workId, text(values, "status")), work(workId)) : notFound();
}

// ---- preventivi, fatture, avanzamenti ----------------------------------------------------------------------------

export async function addQuoteAction(workId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(workId)) return notFound();
  const payload = { supplierPartyId: text(values, "supplierPartyId"), amount: text(values, "amount"), quotedOn: text(values, "quotedOn"), validUntil: text(values, "validUntil"), status: text(values, "status") || "received", documentId: text(values, "documentId"), note: text(values, "note") };
  return ownerAction((uow) => addQuote(uow, workId, payload), work(workId));
}

export async function setQuoteStatusAction(workId: string, quoteId: string, status: string): Promise<void> {
  if (isUuid(workId) && isUuid(quoteId)) await ownerAction((uow) => setQuoteStatus(uow, quoteId, status), work(workId));
}

export async function addInvoiceAction(workId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(workId)) return notFound();
  const payload = { number: text(values, "number"), issuedOn: text(values, "issuedOn"), amount: text(values, "amount"), paidOn: text(values, "paidOn"), documentId: text(values, "documentId"), note: text(values, "note") };
  return ownerAction((uow) => addInvoice(uow, workId, payload), work(workId));
}

export async function setInvoicePaidAction(workId: string, invoiceId: string, paid: boolean, values?: FormValues): Promise<MiniResult> {
  if (!isUuid(workId) || !isUuid(invoiceId)) return notFound();
  const paidOn = paid ? text(values ?? {}, "paidOn") : null;
  return ownerAction((uow) => setInvoicePaid(uow, invoiceId, paidOn), work(workId));
}

export async function undoInvoicePaidAction(workId: string, invoiceId: string): Promise<void> {
  await setInvoicePaidAction(workId, invoiceId, false);
}

export async function addProgressAction(workId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(workId)) return notFound();
  return ownerAction((uow) => addProgress(uow, workId, { recordedOn: text(values, "recordedOn"), percent: text(values, "percent"), note: text(values, "note") }), work(workId));
}

export async function removeEntryAction(workId: string, kind: string, entryId: string): Promise<void> {
  if (isUuid(workId) && isUuid(entryId)) await ownerAction((uow) => removeEntry(uow, kind, entryId), work(workId));
}

// ---- garanzie e ispezioni ----------------------------------------------------------------------------------------

export async function createWarrantyAction(values: FormValues): Promise<MiniResult> {
  const payload = { assetId: text(values, "assetId"), workId: text(values, "workId"), title: text(values, "title"), startsOn: text(values, "startsOn"), endsOn: text(values, "endsOn"), supplierPartyId: text(values, "supplierPartyId"), documentId: text(values, "documentId"), note: text(values, "note"), createDeadline: flag(values, "createDeadline") };
  return ownerAction((uow) => createWarranty(uow, payload), withDeadlines(["/manutenzioni"]));
}

export async function archiveWarrantyAction(warrantyId: string, archived: boolean): Promise<void> {
  if (isUuid(warrantyId)) await ownerAction((uow) => setWarrantyArchived(uow, warrantyId, archived), withDeadlines(["/manutenzioni"]));
}

export async function createPlanAction(values: FormValues): Promise<MiniResult> {
  const payload = { assetId: text(values, "assetId"), title: text(values, "title"), intervalMonths: text(values, "intervalMonths"), firstDueOn: text(values, "firstDueOn"), supplierPartyId: text(values, "supplierPartyId"), note: text(values, "note") };
  return ownerAction((uow) => createInspectionPlan(uow, payload), withDeadlines(["/manutenzioni"]));
}

export async function archivePlanAction(planId: string, archived: boolean): Promise<void> {
  if (isUuid(planId)) await ownerAction((uow) => setPlanArchived(uow, planId, archived), withDeadlines(["/manutenzioni"]));
}
