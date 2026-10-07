"use server";

import { redirect } from "next/navigation";
import { requireOwner } from "@/platform/auth/owner";
import {
  addAgendaItem,
  addMember,
  addProxy,
  addResolution,
  addWorkEntry,
  createBudget,
  createClaim,
  createCondominium,
  createContract,
  createFiscalYear,
  createMeeting,
  createResolutionDeadline,
  createTable,
  createWork,
  generateInstallments,
  linkCondoDocument,
  linkResolutionBudget,
  recordPayment,
  saveOtherShares,
  removeAgendaItem,
  removeMember,
  removeProxy,
  saveShares,
  setAgendaDocument,
  setCondominiumArchived,
  unlinkCondoDocument,
  updateAgendaItem,
  updateClaim,
  updateCondominium,
  updateMeeting,
  updateResolution,
  updateWork,
} from "@/modules/condominium";
import { isUuid } from "@/lib/ids";
import { ownerAction, ownerActionWithValue, type MiniResult } from "@/lib/owner-action";
import type { FormValues } from "@/components/simple-form";
import type { FieldErrors } from "@/shared/result";

export type SaveResult = { errors: FieldErrors } | undefined;
const text = (v: FormValues, k: string) => (typeof v[k] === "string" ? (v[k] as string) : "");
const notFound = (): MiniResult => ({ errors: { _: ["Elemento non trovato"] } });
const page = (condoId: string) => [`/condominio/${condoId}`, "/condominio"];

// ---- condominio -------------------------------------------------------------------------------------------------

export async function saveCondominiumAction(condoId: string | null, values: FormValues): Promise<SaveResult> {
  await requireOwner();
  if (condoId !== null && !isUuid(condoId)) return { errors: { _: ["Condominio non trovato"] } };
  const payload = { name: text(values, "name"), address: text(values, "address"), taxCode: text(values, "taxCode"), administratorPartyId: text(values, "administratorPartyId"), notes: text(values, "notes") };
  const result = await ownerActionWithValue((uow) => (condoId ? updateCondominium(uow, condoId, payload) : createCondominium(uow, payload)), ["/condominio"]);
  if (!result.ok) return { errors: result.errors };
  redirect(`/condominio/${result.value.id}`);
}

export async function archiveCondominiumAction(condoId: string, archived: boolean): Promise<void> {
  if (isUuid(condoId)) await ownerAction((uow) => setCondominiumArchived(uow, condoId, archived), page(condoId));
}

export async function addMemberAction(condoId: string, values: FormValues): Promise<MiniResult> {
  return isUuid(condoId) ? ownerAction((uow) => addMember(uow, condoId, { assetId: text(values, "assetId"), unitLabel: text(values, "unitLabel") }), page(condoId)) : notFound();
}

export async function removeMemberAction(condoId: string, assetId: string): Promise<void> {
  if (isUuid(condoId) && isUuid(assetId)) await ownerAction((uow) => removeMember(uow, condoId, assetId), page(condoId));
}

// ---- millesimi ---------------------------------------------------------------------------------------------------

export async function createTableAction(condoId: string, values: FormValues): Promise<MiniResult> {
  return isUuid(condoId) ? ownerAction((uow) => createTable(uow, condoId, { name: text(values, "name"), note: text(values, "note") }), page(condoId)) : notFound();
}

/** I campi del modulo sono `milli_<id immobile>`: si trasformano nell'elenco atteso dal caso d'uso. */
/** Millesimi degli altri condomini: i campi del modulo sono coppie `otherLabel_i` / `otherValue_i`. */
export async function saveOthersAction(condoId: string, tableId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(condoId) || !isUuid(tableId)) return notFound();
  const slots = Object.keys(values)
    .map((key) => /^otherLabel_(\d+)$/.exec(key)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
  const rows = slots.map((n) => ({ label: text(values, `otherLabel_${n}`), value: text(values, `otherValue_${n}`) }));
  const result = await ownerAction((uow) => saveOtherShares(uow, tableId, rows), page(condoId));
  if (!result.errors) return result;
  const errors: FieldErrors = {};
  for (const [key, messages] of Object.entries(result.errors)) {
    const row = /^others\.(\d+)$/.exec(key);
    errors[row ? `otherValue_${slots[Number(row[1])]}` : key] = messages;
  }
  return { errors };
}

export async function saveSharesAction(condoId: string, tableId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(condoId) || !isUuid(tableId)) return notFound();
  const shares = Object.entries(values)
    .filter(([key]) => key.startsWith("milli_"))
    .map(([key, value]) => ({ assetId: key.slice("milli_".length), value: typeof value === "string" ? value : "" }));
  const result = await ownerAction((uow) => saveShares(uow, tableId, shares), page(condoId));
  if (!result.errors) return result;
  // Il caso d'uso numera le righe (`shares.2`): il modulo conosce i campi per immobile, quindi si rimappa.
  const errors: FieldErrors = {};
  for (const [key, messages] of Object.entries(result.errors)) {
    const row = /^shares\.(\d+)$/.exec(key);
    const assetId = row ? shares[Number(row[1])]?.assetId : undefined;
    errors[assetId ? `milli_${assetId}` : key] = messages;
  }
  return { errors };
}

// ---- esercizi e rate ---------------------------------------------------------------------------------------------

export async function createYearAction(condoId: string, values: FormValues): Promise<MiniResult> {
  return isUuid(condoId) ? ownerAction((uow) => createFiscalYear(uow, condoId, { label: text(values, "label"), startsOn: text(values, "startsOn"), endsOn: text(values, "endsOn") }), page(condoId)) : notFound();
}

export async function createBudgetAction(condoId: string, yearId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(condoId) || !isUuid(yearId)) return notFound();
  return ownerAction((uow) => createBudget(uow, yearId, { kind: text(values, "kind"), title: text(values, "title"), total: text(values, "total"), millesimalTableId: text(values, "millesimalTableId"), scope: text(values, "scope") || "owner_only", note: text(values, "note") }), page(condoId));
}

export async function generateInstallmentsAction(condoId: string, budgetId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(condoId) || !isUuid(budgetId)) return notFound();
  return ownerAction((uow) => generateInstallments(uow, budgetId, { count: text(values, "count"), firstDueOn: text(values, "firstDueOn"), everyMonths: text(values, "everyMonths"), createDeadlines: values.createDeadlines === true }), [...page(condoId), "/scadenze", "/"]);
}

export async function recordPaymentAction(condoId: string, installmentId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(condoId) || !isUuid(installmentId)) return notFound();
  return ownerAction((uow) => recordPayment(uow, installmentId, { paid: text(values, "paid"), paidOn: text(values, "paidOn"), documentId: text(values, "documentId") }), [...page(condoId), "/scadenze"]);
}

// ---- assemblee ---------------------------------------------------------------------------------------------------

const meetingPayload = (v: FormValues) => ({ kind: text(v, "kind"), status: text(v, "status") || "convened", convenedOn: text(v, "convenedOn"), meetingOn: text(v, "meetingOn"), location: text(v, "location"), convocationDocumentId: text(v, "convocationDocumentId"), minutesDocumentId: text(v, "minutesDocumentId"), notes: text(v, "notes") });

export async function createMeetingAction(condoId: string, values: FormValues): Promise<MiniResult> {
  return isUuid(condoId) ? ownerAction((uow) => createMeeting(uow, condoId, meetingPayload(values)), page(condoId)) : notFound();
}

export async function updateMeetingAction(condoId: string, meetingId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(condoId) || !isUuid(meetingId)) return notFound();
  return ownerAction((uow) => updateMeeting(uow, meetingId, meetingPayload(values)), [...page(condoId), `/condominio/${condoId}/assemblee/${meetingId}`]);
}

const meetingPaths = (condoId: string, meetingId: string) => [`/condominio/${condoId}/assemblee/${meetingId}`];

export async function addAgendaItemAction(condoId: string, meetingId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(condoId) || !isUuid(meetingId)) return notFound();
  return ownerAction((uow) => addAgendaItem(uow, meetingId, { title: text(values, "title"), description: text(values, "description"), questions: text(values, "questions") }), meetingPaths(condoId, meetingId));
}

export async function updateAgendaItemAction(condoId: string, meetingId: string, itemId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(condoId) || !isUuid(meetingId) || !isUuid(itemId)) return notFound();
  return ownerAction((uow) => updateAgendaItem(uow, itemId, { title: text(values, "title"), description: text(values, "description"), questions: text(values, "questions") }), meetingPaths(condoId, meetingId));
}

export async function removeAgendaItemAction(condoId: string, meetingId: string, itemId: string): Promise<void> {
  if (isUuid(condoId) && isUuid(meetingId) && isUuid(itemId)) await ownerAction((uow) => removeAgendaItem(uow, itemId), meetingPaths(condoId, meetingId));
}

export async function agendaDocumentAction(condoId: string, meetingId: string, itemId: string, documentId: string, linked: boolean): Promise<MiniResult> {
  if (!isUuid(condoId) || !isUuid(meetingId) || !isUuid(itemId) || !isUuid(documentId)) return notFound();
  return ownerAction((uow) => setAgendaDocument(uow, itemId, documentId, linked), meetingPaths(condoId, meetingId));
}

/** Dal modulo «collega un documento da leggere» di un punto: il documento arriva come campo del modulo. */
export async function linkAgendaDocumentAction(condoId: string, meetingId: string, itemId: string, values: FormValues): Promise<MiniResult> {
  const documentId = text(values, "documentId");
  if (!isUuid(documentId)) return { errors: { documentId: ["Scegli un documento"] } };
  return agendaDocumentAction(condoId, meetingId, itemId, documentId, true);
}

export async function addProxyAction(condoId: string, meetingId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(condoId) || !isUuid(meetingId)) return notFound();
  return ownerAction((uow) => addProxy(uow, meetingId, { delegatePartyId: text(values, "delegatePartyId"), note: text(values, "note") }), meetingPaths(condoId, meetingId));
}

export async function removeProxyAction(condoId: string, meetingId: string, proxyId: string): Promise<void> {
  if (isUuid(condoId) && isUuid(meetingId) && isUuid(proxyId)) await ownerAction((uow) => removeProxy(uow, meetingId, proxyId), meetingPaths(condoId, meetingId));
}

const resolutionPayload = (v: FormValues) => ({ title: text(v, "title"), text: text(v, "text"), agendaItemId: text(v, "agendaItemId"), outcome: text(v, "outcome") || "not_recorded", votesFor: text(v, "votesFor"), votesAgainst: text(v, "votesAgainst"), votesAbstain: text(v, "votesAbstain"), threshold: text(v, "threshold"), thresholdNote: text(v, "thresholdNote") });

export async function addResolutionAction(condoId: string, meetingId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(condoId) || !isUuid(meetingId)) return notFound();
  return ownerAction((uow) => addResolution(uow, meetingId, resolutionPayload(values)), meetingPaths(condoId, meetingId));
}

export async function updateResolutionAction(condoId: string, meetingId: string, resolutionId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(condoId) || !isUuid(meetingId) || !isUuid(resolutionId)) return notFound();
  return ownerAction((uow) => updateResolution(uow, resolutionId, resolutionPayload(values)), meetingPaths(condoId, meetingId));
}

export async function resolutionDeadlineAction(condoId: string, meetingId: string, resolutionId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(condoId) || !isUuid(meetingId) || !isUuid(resolutionId)) return notFound();
  return ownerAction((uow) => createResolutionDeadline(uow, resolutionId, { title: text(values, "title"), dueOn: text(values, "dueOn") }), [...meetingPaths(condoId, meetingId), "/scadenze", "/"]);
}

export async function resolutionBudgetAction(condoId: string, meetingId: string, resolutionId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(condoId) || !isUuid(meetingId) || !isUuid(resolutionId)) return notFound();
  return ownerAction((uow) => linkResolutionBudget(uow, resolutionId, text(values, "budgetId") || null), meetingPaths(condoId, meetingId));
}

// ---- lavori, segnalazioni, contratti, documenti -----------------------------------------------------------------

export async function createWorkAction(condoId: string, values: FormValues): Promise<MiniResult> {
  return isUuid(condoId) ? ownerAction((uow) => createWork(uow, condoId, { title: text(values, "title"), status: text(values, "status") || "planned", budget: text(values, "budget"), note: text(values, "note") }), page(condoId)) : notFound();
}

/** Cambia solo lo stato: gli altri dati del lavoro (compreso il legame con la delibera) si rimandano com'erano. */
export async function updateWorkStatusAction(condoId: string, workId: string, current: { title: string; budget: string; note: string; resolutionId: string }, values: FormValues): Promise<MiniResult> {
  if (!isUuid(condoId) || !isUuid(workId)) return notFound();
  return ownerAction((uow) => updateWork(uow, workId, { ...current, status: text(values, "status") }), page(condoId));
}

export async function addWorkEntryAction(condoId: string, workId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(condoId) || !isUuid(workId)) return notFound();
  return ownerAction((uow) => addWorkEntry(uow, workId, { kind: text(values, "kind"), title: text(values, "title"), amount: text(values, "amount"), entryOn: text(values, "entryOn"), documentId: text(values, "documentId") }), page(condoId));
}

export async function createClaimAction(condoId: string, values: FormValues): Promise<MiniResult> {
  return isUuid(condoId) ? ownerAction((uow) => createClaim(uow, condoId, { kind: text(values, "kind"), title: text(values, "title"), description: text(values, "description"), matterId: text(values, "matterId") }), page(condoId)) : notFound();
}

export async function setClaimStatusAction(condoId: string, claim: { id: string; kind: string; title: string; description: string; matterId: string }, status: "open" | "closed"): Promise<void> {
  if (isUuid(condoId) && isUuid(claim.id)) await ownerAction((uow) => updateClaim(uow, claim.id, { kind: claim.kind, title: claim.title, description: claim.description, matterId: claim.matterId, status }), page(condoId));
}

export async function createContractAction(condoId: string, values: FormValues): Promise<MiniResult> {
  return isUuid(condoId)
    ? ownerAction((uow) => createContract(uow, condoId, { kind: text(values, "kind"), title: text(values, "title"), counterpartyPartyId: text(values, "counterpartyPartyId"), validFrom: text(values, "validFrom"), validTo: text(values, "validTo"), documentId: text(values, "documentId"), note: text(values, "note") }), page(condoId))
    : notFound();
}

export async function linkDocumentAction(condoId: string, values: FormValues): Promise<MiniResult> {
  return isUuid(condoId) && isUuid(text(values, "documentId")) ? ownerAction((uow) => linkCondoDocument(uow, condoId, text(values, "documentId"), text(values, "kind") || "other"), page(condoId)) : { errors: { documentId: ["Scegli un documento"] } };
}

export async function unlinkDocumentAction(condoId: string, documentId: string): Promise<void> {
  if (isUuid(condoId) && isUuid(documentId)) await ownerAction((uow) => unlinkCondoDocument(uow, condoId, documentId), page(condoId));
}
