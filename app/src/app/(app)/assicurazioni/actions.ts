"use server";

import { redirect } from "next/navigation";
import { requireOwner } from "@/platform/auth/owner";
import {
  addClaimEntry,
  addCoverage,
  addPremium,
  createClaim,
  createPolicy,
  createPolicyDeadline,
  removeClaimEntry,
  removeCoverage,
  removePremium,
  setClaimStatus,
  setPolicyArchived,
  setPremiumPaid,
  updateClaim,
  updatePolicy,
} from "@/modules/insurance";
import { isUuid } from "@/lib/ids";
import { ownerAction, ownerActionWithValue, type MiniResult } from "@/lib/owner-action";
import type { FormValues } from "@/components/simple-form";
import type { FieldErrors } from "@/shared/result";

export type SaveResult = { errors: FieldErrors } | undefined;
const text = (v: FormValues, k: string) => (typeof v[k] === "string" ? (v[k] as string) : "");
const flag = (v: FormValues, k: string) => v[k] === true;
const list = (v: FormValues, k: string) => (Array.isArray(v[k]) ? (v[k] as string[]) : []);
const notFound = (): MiniResult => ({ errors: { _: ["Elemento non trovato"] } });
const withDeadlines = (paths: string[]) => [...paths, "/scadenze", "/"];
const policyPaths = (id: string) => [`/assicurazioni/${id}`, "/assicurazioni"];
const claimPaths = (claimId: string, policyId?: string) => [`/assicurazioni/sinistri/${claimId}`, "/assicurazioni", ...(policyId ? [`/assicurazioni/${policyId}`] : [])];

// ---- polizze -----------------------------------------------------------------------------------------------------

const policyPayload = (v: FormValues) => ({
  title: text(v, "title"),
  insurerPartyId: text(v, "insurerPartyId"),
  agentPartyId: text(v, "agentPartyId"),
  policyNumber: text(v, "policyNumber"),
  startsOn: text(v, "startsOn"),
  endsOn: text(v, "endsOn"),
  premium: text(v, "premium"),
  note: text(v, "note"),
  documentId: text(v, "documentId"),
  assetIds: list(v, "assetIds"),
  createDeadline: flag(v, "createDeadline"),
});

export async function savePolicyAction(policyId: string | null, values: FormValues): Promise<SaveResult> {
  await requireOwner();
  if (policyId !== null && !isUuid(policyId)) return { errors: { _: ["Polizza non trovata"] } };
  const payload = policyPayload(values);
  const result = await ownerActionWithValue((uow) => (policyId ? updatePolicy(uow, policyId, payload) : createPolicy(uow, payload)), withDeadlines(["/assicurazioni"]));
  if (!result.ok) return { errors: result.errors };
  redirect(`/assicurazioni/${result.value.id}`);
}

export async function archivePolicyAction(policyId: string, archived: boolean): Promise<void> {
  if (isUuid(policyId)) await ownerAction((uow) => setPolicyArchived(uow, policyId, archived), withDeadlines(policyPaths(policyId)));
}

export async function createPolicyDeadlineAction(policyId: string): Promise<void> {
  if (isUuid(policyId)) await ownerAction((uow) => createPolicyDeadline(uow, policyId), withDeadlines(policyPaths(policyId)));
}

// ---- garanzie e premi --------------------------------------------------------------------------------------------

export async function addCoverageAction(policyId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(policyId)) return notFound();
  return ownerAction((uow) => addCoverage(uow, policyId, { title: text(values, "title"), sumInsured: text(values, "sumInsured"), deductible: text(values, "deductible"), note: text(values, "note") }), policyPaths(policyId));
}

export async function removeCoverageAction(policyId: string, coverageId: string): Promise<void> {
  if (isUuid(policyId) && isUuid(coverageId)) await ownerAction((uow) => removeCoverage(uow, coverageId), policyPaths(policyId));
}

export async function addPremiumAction(policyId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(policyId)) return notFound();
  const payload = { dueOn: text(values, "dueOn"), amount: text(values, "amount"), paidOn: text(values, "paidOn"), documentId: text(values, "documentId"), createDeadline: flag(values, "createDeadline") };
  return ownerAction((uow) => addPremium(uow, policyId, payload), withDeadlines(policyPaths(policyId)));
}

export async function setPremiumPaidAction(policyId: string, premiumId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(policyId) || !isUuid(premiumId)) return notFound();
  return ownerAction((uow) => setPremiumPaid(uow, premiumId, { paidOn: text(values, "paidOn"), documentId: text(values, "documentId") }), withDeadlines(policyPaths(policyId)));
}

export async function removePremiumAction(policyId: string, premiumId: string): Promise<void> {
  if (isUuid(policyId) && isUuid(premiumId)) await ownerAction((uow) => removePremium(uow, premiumId), withDeadlines(policyPaths(policyId)));
}

// ---- sinistri ----------------------------------------------------------------------------------------------------

const claimPayload = (v: FormValues) => ({
  policyId: text(v, "policyId"),
  assetId: text(v, "assetId"),
  title: text(v, "title"),
  claimNumber: text(v, "claimNumber"),
  occurredOn: text(v, "occurredOn"),
  reportedOn: text(v, "reportedOn"),
  status: text(v, "status") || "open",
  claimed: text(v, "claimed"),
  received: text(v, "received"),
  adjusterPartyId: text(v, "adjusterPartyId"),
  matterId: text(v, "matterId"),
  description: text(v, "description"),
});

export async function saveClaimAction(claimId: string | null, values: FormValues): Promise<SaveResult> {
  await requireOwner();
  if (claimId !== null && !isUuid(claimId)) return { errors: { _: ["Sinistro non trovato"] } };
  const payload = claimPayload(values);
  const result = await ownerActionWithValue((uow) => (claimId ? updateClaim(uow, claimId, payload) : createClaim(uow, payload)), ["/assicurazioni", ...(isUuid(payload.policyId) ? [`/assicurazioni/${payload.policyId}`] : [])]);
  if (!result.ok) return { errors: result.errors };
  redirect(`/assicurazioni/sinistri/${result.value.id}`);
}

export async function setClaimStatusAction(claimId: string, policyId: string, values: FormValues): Promise<MiniResult> {
  return isUuid(claimId) ? ownerAction((uow) => setClaimStatus(uow, claimId, text(values, "status")), claimPaths(claimId, policyId)) : notFound();
}

export async function addClaimEntryAction(claimId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(claimId)) return notFound();
  return ownerAction((uow) => addClaimEntry(uow, claimId, { entryOn: text(values, "entryOn"), direction: text(values, "direction") || "note", summary: text(values, "summary"), documentId: text(values, "documentId") }), claimPaths(claimId));
}

export async function removeClaimEntryAction(claimId: string, entryId: string): Promise<void> {
  if (isUuid(claimId) && isUuid(entryId)) await ownerAction((uow) => removeClaimEntry(uow, entryId), claimPaths(claimId));
}
