import { fail, failGeneral, ok, parseInput } from "@/shared/result";
import { agendaItemSchema, followUpDeadlineSchema, meetingSchema, proxySchema, resolutionSchema } from "../domain/condominium";
import type { CondoDeps } from "./ports";
import { hasErrors, refs, type Id } from "./shared";

// -------------------------------------------------------------------------------------------------- assemblee

async function meetingCondo(deps: CondoDeps, meetingId: string) {
  const meeting = await deps.repo.getMeeting(meetingId);
  return meeting ? { meeting, condoId: meeting.condominiumId } : null;
}

export async function createMeeting(deps: CondoDeps, condoId: string, raw: unknown): Promise<Id> {
  const p = parseInput(meetingSchema, raw);
  if (!p.ok) return p;
  if (!(await deps.repo.getCondominium(condoId))) return failGeneral("Condominio non trovato");
  const errors = await refs(deps, { documents: [p.value.convocationDocumentId, p.value.minutesDocumentId] });
  if (hasErrors(errors)) return fail(errors);
  const id = await deps.repo.insertMeeting(condoId, {
    kind: p.value.kind,
    status: p.value.status,
    convenedOn: p.value.convenedOn ?? null,
    meetingOn: p.value.meetingOn,
    location: p.value.location ?? null,
    convocationDocumentId: p.value.convocationDocumentId ?? null,
    minutesDocumentId: p.value.minutesDocumentId ?? null,
    notes: p.value.notes ?? null,
  });
  await deps.audit.record({ action: "condominium.meeting.create", entityType: "condominium", entityId: condoId, diff: { meetingId: id, kind: p.value.kind } });
  return ok({ id });
}

export async function updateMeeting(deps: CondoDeps, meetingId: string, raw: unknown): Promise<Id> {
  const p = parseInput(meetingSchema, raw);
  if (!p.ok) return p;
  const found = await meetingCondo(deps, meetingId);
  if (!found) return failGeneral("Assemblea non trovata");
  const errors = await refs(deps, { documents: [p.value.convocationDocumentId, p.value.minutesDocumentId] });
  if (hasErrors(errors)) return fail(errors);
  await deps.repo.updateMeeting(meetingId, {
    kind: p.value.kind,
    status: p.value.status,
    convenedOn: p.value.convenedOn ?? null,
    meetingOn: p.value.meetingOn,
    location: p.value.location ?? null,
    convocationDocumentId: p.value.convocationDocumentId ?? null,
    minutesDocumentId: p.value.minutesDocumentId ?? null,
    notes: p.value.notes ?? null,
  });
  await deps.audit.record({ action: "condominium.meeting.update", entityType: "condominium", entityId: found.condoId, diff: { meetingId, statusFrom: found.meeting.status, statusTo: p.value.status } });
  return ok({ id: meetingId });
}

export async function addAgendaItem(deps: CondoDeps, meetingId: string, raw: unknown): Promise<Id> {
  const p = parseInput(agendaItemSchema, raw);
  if (!p.ok) return p;
  const found = await meetingCondo(deps, meetingId);
  if (!found) return failGeneral("Assemblea non trovata");
  const id = await deps.repo.insertAgendaItem(meetingId, { title: p.value.title, description: p.value.description ?? null, questions: p.value.questions ?? null });
  await deps.audit.record({ action: "condominium.agenda.add", entityType: "condominium", entityId: found.condoId, diff: { meetingId, itemId: id } });
  return ok({ id: meetingId });
}

export async function updateAgendaItem(deps: CondoDeps, itemId: string, raw: unknown): Promise<Id> {
  const p = parseInput(agendaItemSchema, raw);
  if (!p.ok) return p;
  const item = await deps.repo.getAgendaItem(itemId);
  if (!item) return failGeneral("Punto non trovato");
  await deps.repo.updateAgendaItem(itemId, { title: p.value.title, description: p.value.description ?? null, questions: p.value.questions ?? null });
  await deps.audit.record({ action: "condominium.agenda.update", entityType: "condominium", entityId: item.meetingId, diff: { itemId } });
  return ok({ id: item.meetingId });
}

export async function removeAgendaItem(deps: CondoDeps, itemId: string): Promise<Id> {
  const item = await deps.repo.getAgendaItem(itemId);
  if (!item) return failGeneral("Punto non trovato");
  await deps.repo.deleteAgendaItem(itemId);
  await deps.audit.record({ action: "condominium.agenda.remove", entityType: "condominium", entityId: item.meetingId, diff: { itemId } });
  return ok({ id: item.meetingId });
}

export async function setAgendaDocument(deps: CondoDeps, itemId: string, documentId: string, linked: boolean): Promise<Id> {
  const item = await deps.repo.getAgendaItem(itemId);
  if (!item) return failGeneral("Punto non trovato");
  const errors = await refs(deps, { documents: [documentId] });
  if (hasErrors(errors)) return fail(errors);
  await deps.repo.setAgendaDocument(itemId, documentId, linked);
  await deps.audit.record({ action: linked ? "condominium.agenda.document.link" : "condominium.agenda.document.unlink", entityType: "condominium", entityId: item.meetingId, diff: { itemId, documentId } });
  return ok({ id: item.meetingId });
}

export async function addProxy(deps: CondoDeps, meetingId: string, raw: unknown): Promise<Id> {
  const p = parseInput(proxySchema, raw);
  if (!p.ok) return p;
  const found = await meetingCondo(deps, meetingId);
  if (!found) return failGeneral("Assemblea non trovata");
  const errors = await refs(deps, { parties: [p.value.delegatePartyId], documents: [p.value.documentId] });
  if (hasErrors(errors)) return fail(errors);
  const id = await deps.repo.insertProxy(meetingId, { delegatePartyId: p.value.delegatePartyId, note: p.value.note ?? null, documentId: p.value.documentId ?? null });
  await deps.audit.record({ action: "condominium.proxy.add", entityType: "condominium", entityId: found.condoId, diff: { meetingId, proxyId: id } });
  return ok({ id: meetingId });
}

export async function removeProxy(deps: CondoDeps, meetingId: string, proxyId: string): Promise<Id> {
  const found = await meetingCondo(deps, meetingId);
  if (!found) return failGeneral("Assemblea non trovata");
  await deps.repo.deleteProxy(proxyId);
  await deps.audit.record({ action: "condominium.proxy.remove", entityType: "condominium", entityId: found.condoId, diff: { meetingId, proxyId } });
  return ok({ id: meetingId });
}

const resolutionValues = (p: ReturnType<typeof resolutionSchema.parse>) => ({
  title: p.title,
  text: p.text ?? null,
  agendaItemId: p.agendaItemId ?? null,
  outcome: p.outcome,
  votesFor: p.votesFor ?? null,
  votesAgainst: p.votesAgainst ?? null,
  votesAbstain: p.votesAbstain ?? null,
  threshold: p.threshold ?? null,
  thresholdNote: p.thresholdNote ?? null,
});

export async function addResolution(deps: CondoDeps, meetingId: string, raw: unknown): Promise<Id> {
  const p = parseInput(resolutionSchema, raw);
  if (!p.ok) return p;
  const found = await meetingCondo(deps, meetingId);
  if (!found) return failGeneral("Assemblea non trovata");
  if (p.value.agendaItemId && !(await deps.repo.agenda(meetingId)).some((a) => a.id === p.value.agendaItemId)) return fail({ agendaItemId: ["Il punto non è di questa assemblea"] });
  const id = await deps.repo.insertResolution(meetingId, resolutionValues(p.value));
  await deps.audit.record({ action: "condominium.resolution.add", entityType: "condominium", entityId: found.condoId, diff: { meetingId, resolutionId: id, outcome: p.value.outcome } });
  return ok({ id: meetingId });
}

export async function updateResolution(deps: CondoDeps, resolutionId: string, raw: unknown): Promise<Id> {
  const p = parseInput(resolutionSchema, raw);
  if (!p.ok) return p;
  const resolution = await deps.repo.getResolution(resolutionId);
  if (!resolution) return failGeneral("Delibera non trovata");
  const found = await meetingCondo(deps, resolution.meetingId);
  await deps.repo.updateResolution(resolutionId, resolutionValues(p.value));
  await deps.audit.record({ action: "condominium.resolution.update", entityType: "condominium", entityId: found!.condoId, diff: { resolutionId, outcomeFrom: resolution.outcome, outcomeTo: p.value.outcome } });
  return ok({ id: resolution.meetingId });
}

/** Seguito di una delibera: crea una scadenza collegata (modulo Scadenze). */
export async function createResolutionDeadline(deps: CondoDeps, resolutionId: string, raw: unknown): Promise<Id> {
  const p = parseInput(followUpDeadlineSchema, raw);
  if (!p.ok) return p;
  const resolution = await deps.repo.getResolution(resolutionId);
  if (!resolution) return failGeneral("Delibera non trovata");
  const found = await meetingCondo(deps, resolution.meetingId);
  const deadlineId = await deps.others.createDeadline({ title: p.value.title, dueOn: p.value.dueOn, level: "condominium", category: "condominium" });
  if (!deadlineId) return fail({ _: ["Non è stato possibile creare la scadenza"] });
  await deps.repo.updateResolution(resolutionId, { deadlineId });
  await deps.audit.record({ action: "condominium.resolution.deadline", entityType: "condominium", entityId: found!.condoId, diff: { resolutionId, deadlineId } });
  return ok({ id: resolution.meetingId });
}

/** Seguito di una delibera: collega la spesa (un preventivo del condominio). */
export async function linkResolutionBudget(deps: CondoDeps, resolutionId: string, budgetId: string | null): Promise<Id> {
  const resolution = await deps.repo.getResolution(resolutionId);
  if (!resolution) return failGeneral("Delibera non trovata");
  const found = await meetingCondo(deps, resolution.meetingId);
  if (budgetId) {
    const budget = await deps.repo.getBudget(budgetId);
    const year = budget ? await deps.repo.getYear(budget.fiscalYearId) : null;
    if (!budget || year?.condominiumId !== found!.condoId) return fail({ budgetId: ["Il preventivo non è di questo condominio"] });
  }
  await deps.repo.updateResolution(resolutionId, { budgetId });
  await deps.audit.record({ action: "condominium.resolution.budget", entityType: "condominium", entityId: found!.condoId, diff: { resolutionId, budgetId } });
  return ok({ id: resolution.meetingId });
}
