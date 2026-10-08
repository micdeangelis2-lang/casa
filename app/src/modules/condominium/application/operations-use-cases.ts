import { fail, failGeneral, ok, parseInput } from "@/shared/result";
import { claimSchema, contractSchema, workEntrySchema, workSchema, DOCUMENT_KINDS } from "../domain/condominium";
import type { CondoDeps } from "./ports";
import { hasErrors, refs, type Id } from "./shared";

// -------------------------------------------------------------------------------------------------- lavori, segnalazioni, contratti, documenti

export async function createWork(deps: CondoDeps, condoId: string, raw: unknown): Promise<Id> {
  const p = parseInput(workSchema, raw);
  if (!p.ok) return p;
  if (!(await deps.repo.getCondominium(condoId))) return failGeneral("Condominio non trovato");
  const id = await deps.repo.insertWork(condoId, { title: p.value.title, status: p.value.status, budgetCents: p.value.budget ?? null, resolutionId: p.value.resolutionId ?? null, note: p.value.note ?? null });
  await deps.audit.record({ action: "condominium.work.create", entityType: "condominium", entityId: condoId, diff: { workId: id } });
  return ok({ id: condoId });
}

export async function updateWork(deps: CondoDeps, workId: string, raw: unknown): Promise<Id> {
  const p = parseInput(workSchema, raw);
  if (!p.ok) return p;
  const work = await deps.repo.getWork(workId);
  if (!work) return failGeneral("Lavoro non trovato");
  await deps.repo.updateWork(workId, { title: p.value.title, status: p.value.status, budgetCents: p.value.budget ?? null, resolutionId: p.value.resolutionId ?? null, note: p.value.note ?? null });
  await deps.audit.record({ action: "condominium.work.update", entityType: "condominium", entityId: work.condominiumId, diff: { workId, statusFrom: work.status, statusTo: p.value.status } });
  return ok({ id: work.condominiumId });
}

export async function addWorkEntry(deps: CondoDeps, workId: string, raw: unknown): Promise<Id> {
  const p = parseInput(workEntrySchema, raw);
  if (!p.ok) return p;
  const work = await deps.repo.getWork(workId);
  if (!work) return failGeneral("Lavoro non trovato");
  const errors = await refs(deps, { documents: [p.value.documentId] });
  if (hasErrors(errors)) return fail(errors);
  const id = await deps.repo.insertEntry(workId, { kind: p.value.kind, title: p.value.title, amountCents: p.value.amount ?? null, entryOn: p.value.entryOn ?? null, documentId: p.value.documentId ?? null });
  await deps.audit.record({ action: "condominium.work.entry", entityType: "condominium", entityId: work.condominiumId, diff: { workId, entryId: id, kind: p.value.kind } });
  return ok({ id: work.condominiumId });
}

export async function createClaim(deps: CondoDeps, condoId: string, raw: unknown, today: string): Promise<Id> {
  const p = parseInput(claimSchema, raw);
  if (!p.ok) return p;
  if (!(await deps.repo.getCondominium(condoId))) return failGeneral("Condominio non trovato");
  const errors = await refs(deps, { matter: p.value.matterId });
  if (hasErrors(errors)) return fail(errors);
  const id = await deps.repo.insertClaim(condoId, { kind: p.value.kind, title: p.value.title, description: p.value.description ?? null, status: p.value.status, openedOn: p.value.openedOn ?? today, matterId: p.value.matterId ?? null });
  await deps.audit.record({ action: "condominium.claim.create", entityType: "condominium", entityId: condoId, diff: { claimId: id, kind: p.value.kind } });
  return ok({ id: condoId });
}

export async function updateClaim(deps: CondoDeps, claimId: string, raw: unknown, today: string): Promise<Id> {
  const p = parseInput(claimSchema, raw);
  if (!p.ok) return p;
  const claim = await deps.repo.getClaim(claimId);
  if (!claim) return failGeneral("Voce non trovata");
  const errors = await refs(deps, { matter: p.value.matterId });
  if (hasErrors(errors)) return fail(errors);
  await deps.repo.updateClaim(claimId, {
    kind: p.value.kind,
    title: p.value.title,
    description: p.value.description ?? null,
    status: p.value.status,
    openedOn: p.value.openedOn ?? claim.openedOn,
    closedOn: p.value.status === "closed" ? (claim.closedOn ?? today) : null,
    matterId: p.value.matterId ?? null,
  });
  await deps.audit.record({ action: "condominium.claim.update", entityType: "condominium", entityId: claim.condominiumId, diff: { claimId, statusFrom: claim.status, statusTo: p.value.status } });
  return ok({ id: claim.condominiumId });
}

export async function createContract(deps: CondoDeps, condoId: string, raw: unknown): Promise<Id> {
  const p = parseInput(contractSchema, raw);
  if (!p.ok) return p;
  if (!(await deps.repo.getCondominium(condoId))) return failGeneral("Condominio non trovato");
  const errors = await refs(deps, { parties: [p.value.counterpartyPartyId], documents: [p.value.documentId] });
  if (hasErrors(errors)) return fail(errors);
  const id = await deps.repo.insertContract(condoId, { kind: p.value.kind, title: p.value.title, counterpartyPartyId: p.value.counterpartyPartyId ?? null, validFrom: p.value.validFrom ?? null, validTo: p.value.validTo ?? null, documentId: p.value.documentId ?? null, note: p.value.note ?? null });
  await deps.audit.record({ action: "condominium.contract.create", entityType: "condominium", entityId: condoId, diff: { contractId: id, kind: p.value.kind } });
  return ok({ id: condoId });
}

export async function linkCondoDocument(deps: CondoDeps, condoId: string, documentId: string, kind: string): Promise<Id> {
  if (!(await deps.repo.getCondominium(condoId))) return failGeneral("Condominio non trovato");
  if (!(DOCUMENT_KINDS as readonly string[]).includes(kind)) return fail({ kind: ["Tipo non valido"] });
  const errors = await refs(deps, { documents: [documentId] });
  if (hasErrors(errors)) return fail(errors);
  await deps.repo.linkDocument(condoId, documentId, kind);
  await deps.audit.record({ action: "condominium.document.link", entityType: "condominium", entityId: condoId, diff: { documentId, kind } });
  return ok({ id: condoId });
}

export async function unlinkCondoDocument(deps: CondoDeps, condoId: string, documentId: string): Promise<Id> {
  if (!(await deps.repo.getCondominium(condoId))) return failGeneral("Condominio non trovato");
  await deps.repo.unlinkDocument(condoId, documentId);
  await deps.audit.record({ action: "condominium.document.unlink", entityType: "condominium", entityId: condoId, diff: { documentId } });
  return ok({ id: condoId });
}
