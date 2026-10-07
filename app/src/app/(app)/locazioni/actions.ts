"use server";

import { redirect } from "next/navigation";
import { requireOwner } from "@/platform/auth/owner";
import type { UnitOfWork } from "@/platform/db/unit-of-work";
import { getDb } from "@/platform/db/client";
import { evaluateDossier } from "@/modules/dossier";
import {
  addCode,
  addLettingParty,
  addRent,
  addReport,
  createLetting,
  generateRentSchedule,
  getLettingDetail,
  markReportDone,
  addRentReceipt,
  removeRentReceipt,
  removeCode,
  removeLettingParty,
  removeRent,
  removeReport,
  reopenReport,
  setLettingStatus,
  updateLetting,
} from "@/modules/lettings";
import { isUuid } from "@/lib/ids";
import { ownerAction, ownerActionWithValue, type MiniResult } from "@/lib/owner-action";
import type { FormValues } from "@/components/simple-form";
import type { FieldErrors, Result } from "@/shared/result";

export type SaveResult = { errors: FieldErrors } | undefined;
const text = (v: FormValues, k: string) => (typeof v[k] === "string" ? (v[k] as string) : "");
const flag = (v: FormValues, k: string) => v[k] === true;
const notFound = (): MiniResult => ({ errors: { _: ["Elemento non trovato"] } });
const withDeadlines = (paths: string[]) => [...paths, "/scadenze", "/"];
const paths = (id: string) => [`/locazioni/${id}`, "/locazioni"];

/** Il tipo di attivita' in corso e' un «fatto» del bene per le regole: dopo ogni cambiamento il dossier si riallinea. */
async function reevaluate(uow: UnitOfWork, ...assetIds: (string | undefined)[]) {
  for (const assetId of new Set(assetIds.filter((x): x is string => Boolean(x) && isUuid(x as string)))) await evaluateDossier(uow, assetId);
}

// ---- locazione o attivita' ---------------------------------------------------------------------------------------

const lettingPayload = (v: FormValues) => ({
  assetId: text(v, "assetId"),
  type: text(v, "type"),
  title: text(v, "title"),
  status: text(v, "status") || "active",
  startsOn: text(v, "startsOn"),
  endsOn: text(v, "endsOn"),
  managerPartyId: text(v, "managerPartyId"),
  monthlyRent: text(v, "monthlyRent"),
  deposit: text(v, "deposit"),
  depositReceivedOn: text(v, "depositReceivedOn"),
  depositReturnedOn: text(v, "depositReturnedOn"),
  depositReturned: text(v, "depositReturned"),
  registeredOn: text(v, "registeredOn"),
  registrationNumber: text(v, "registrationNumber"),
  registrationOffice: text(v, "registrationOffice"),
  contractDocumentId: text(v, "contractDocumentId"),
  note: text(v, "note"),
  createDeadline: flag(v, "createDeadline"),
});

export async function saveLettingAction(lettingId: string | null, values: FormValues): Promise<SaveResult> {
  await requireOwner();
  if (lettingId !== null && !isUuid(lettingId)) return { errors: { _: ["Locazione non trovata"] } };
  const payload = lettingPayload(values);
  const previousAsset = lettingId ? (await getLettingDetail(getDb(), lettingId))?.assetId : undefined;
  const result = await ownerActionWithValue(async (uow): Promise<Result<{ id: string }>> => {
    const saved = lettingId ? await updateLetting(uow, lettingId, payload) : await createLetting(uow, payload);
    if (saved.ok) await reevaluate(uow, payload.assetId, previousAsset);
    return saved;
  }, withDeadlines(["/locazioni"]));
  if (!result.ok) return { errors: result.errors };
  redirect(`/locazioni/${result.value.id}`);
}

export async function setLettingStatusAction(lettingId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(lettingId)) return notFound();
  const assetId = (await getLettingDetail(getDb(), lettingId))?.assetId;
  return ownerAction(async (uow) => {
    const done = await setLettingStatus(uow, lettingId, text(values, "status"));
    if (done.ok) await reevaluate(uow, assetId);
    return done;
  }, paths(lettingId));
}

// ---- persone -----------------------------------------------------------------------------------------------------

export async function addPartyAction(lettingId: string, values: FormValues): Promise<MiniResult> {
  return isUuid(lettingId) ? ownerAction((uow) => addLettingParty(uow, lettingId, { partyId: text(values, "partyId"), role: text(values, "role") || "tenant" }), paths(lettingId)) : notFound();
}

export async function removePartyAction(lettingId: string, partyId: string): Promise<void> {
  if (isUuid(lettingId) && isUuid(partyId)) await ownerAction((uow) => removeLettingParty(uow, lettingId, partyId), paths(lettingId));
}

// ---- canoni ------------------------------------------------------------------------------------------------------

export async function generateScheduleAction(lettingId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(lettingId)) return notFound();
  const payload = { firstDueOn: text(values, "firstDueOn"), months: text(values, "months"), amount: text(values, "amount"), createDeadlines: flag(values, "createDeadlines") };
  return ownerAction((uow) => generateRentSchedule(uow, lettingId, payload), withDeadlines(paths(lettingId)));
}

export async function addRentAction(lettingId: string, values: FormValues): Promise<MiniResult> {
  return isUuid(lettingId) ? ownerAction((uow) => addRent(uow, lettingId, { dueOn: text(values, "dueOn"), amount: text(values, "amount") }), paths(lettingId)) : notFound();
}

/** Aggiunge un incasso al canone (data, importo, modalita' libera, documento di prova). */
export async function addRentReceiptAction(lettingId: string, rentId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(lettingId) || !isUuid(rentId)) return notFound();
  const payload = { amount: text(values, "amount"), paidOn: text(values, "paidOn"), method: text(values, "method"), documentId: text(values, "documentId") };
  return ownerAction((uow) => addRentReceipt(uow, rentId, payload), withDeadlines(paths(lettingId)));
}

export async function removeRentReceiptAction(lettingId: string, receiptId: string): Promise<void> {
  if (isUuid(lettingId) && isUuid(receiptId)) await ownerAction((uow) => removeRentReceipt(uow, receiptId), withDeadlines(paths(lettingId)));
}

export async function removeRentAction(lettingId: string, rentId: string): Promise<void> {
  if (isUuid(lettingId) && isUuid(rentId)) await ownerAction((uow) => removeRent(uow, rentId), withDeadlines(paths(lettingId)));
}

// ---- codici ------------------------------------------------------------------------------------------------------

export async function addCodeAction(lettingId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(lettingId)) return notFound();
  const payload = { label: text(values, "label"), value: text(values, "value"), issuer: text(values, "issuer"), issuedOn: text(values, "issuedOn"), validUntil: text(values, "validUntil"), note: text(values, "note") };
  return ownerAction((uow) => addCode(uow, lettingId, payload), paths(lettingId));
}

export async function removeCodeAction(lettingId: string, codeId: string): Promise<void> {
  if (isUuid(lettingId) && isUuid(codeId)) await ownerAction((uow) => removeCode(uow, codeId), paths(lettingId));
}

// ---- adempimenti -------------------------------------------------------------------------------------------------

export async function addReportAction(lettingId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(lettingId)) return notFound();
  const payload = { kind: text(values, "kind"), title: text(values, "title"), period: text(values, "period"), dueOn: text(values, "dueOn"), amount: text(values, "amount"), doneOn: text(values, "doneOn"), documentId: text(values, "documentId"), note: text(values, "note"), createDeadline: flag(values, "createDeadline") };
  return ownerAction((uow) => addReport(uow, lettingId, payload), withDeadlines(paths(lettingId)));
}

export async function markReportDoneAction(lettingId: string, reportId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(lettingId) || !isUuid(reportId)) return notFound();
  return ownerAction((uow) => markReportDone(uow, reportId, { doneOn: text(values, "doneOn"), documentId: text(values, "documentId"), amount: text(values, "amount") }), withDeadlines(paths(lettingId)));
}

export async function reopenReportAction(lettingId: string, reportId: string): Promise<void> {
  if (isUuid(lettingId) && isUuid(reportId)) await ownerAction((uow) => reopenReport(uow, reportId), paths(lettingId));
}

export async function removeReportAction(lettingId: string, reportId: string): Promise<void> {
  if (isUuid(lettingId) && isUuid(reportId)) await ownerAction((uow) => removeReport(uow, reportId), withDeadlines(paths(lettingId)));
}
