import { fail, failGeneral, ok, parseInput } from "@/shared/result";
import { QUOTE_STATUSES, WORK_STATUSES, quoteSchema, workSchema, type QuoteStatus, type WorkStatus } from "../domain/maintenance";
import { assetName, hasErrors, refs, type Id } from "./common";
import type { MaintenanceDeps, WorkRow } from "./ports";

// -------------------------------------------------------------------------------------------------- interventi

export async function createWork(deps: MaintenanceDeps, raw: unknown): Promise<Id> {
  const p = parseInput(workSchema, raw);
  if (!p.ok) return p;
  const v = p.value;
  const errors = await refs(deps, { assetId: v.assetId, parties: [v.supplierPartyId], plantId: v.plantId });
  if (hasErrors(errors)) return fail(errors);
  if (v.createDeadline && !v.scheduledOn) return fail({ scheduledOn: ["Per creare la scadenza serve la data prevista"] });
  const id = await deps.repo.insertWork({
    assetId: v.assetId,
    title: v.title,
    description: v.description ?? null,
    status: v.status,
    supplierPartyId: v.supplierPartyId ?? null,
    plantId: v.plantId ?? null,
    scheduledOn: v.scheduledOn ?? null,
    startedOn: v.startedOn ?? null,
    completedOn: v.completedOn ?? null,
    budgetCents: v.budget ?? null,
    note: v.note ?? null,
    deadlineId: null,
  });
  let deadlineCreated = false;
  if (v.createDeadline && v.scheduledOn) {
    const deadlineId = await deps.others.createDeadline({ title: `${v.title} (${await assetName(deps, v.assetId)})`, assetId: v.assetId, category: "technical", level: "national", calc: { type: "manual", dueOn: v.scheduledOn }, proofRequired: false });
    if (deadlineId) {
      await deps.repo.updateWork(id, { deadlineId });
      deadlineCreated = true;
    }
  }
  await deps.audit.record({ action: "maintenance.work.create", entityType: "maint_work", entityId: id, diff: { status: v.status, deadlineCreated } });
  return ok({ id });
}

export async function updateWork(deps: MaintenanceDeps, id: string, raw: unknown, today: string): Promise<Id> {
  const p = parseInput(workSchema, raw);
  if (!p.ok) return p;
  const current = await deps.repo.getWork(id);
  if (!current) return failGeneral("Intervento non trovato");
  const v = p.value;
  const errors = await refs(deps, { assetId: v.assetId, parties: [v.supplierPartyId] });
  if (hasErrors(errors)) return fail(errors);
  await deps.repo.updateWork(id, {
    assetId: v.assetId,
    title: v.title,
    description: v.description ?? null,
    status: v.status,
    supplierPartyId: v.supplierPartyId ?? null,
    // Cambiando immobile l'impianto collegato (di un altro immobile) si scollega.
    ...(v.assetId !== current.assetId && { plantId: null }),
    scheduledOn: v.scheduledOn ?? null,
    startedOn: v.startedOn ?? null,
    completedOn: v.completedOn ?? (v.status === "completed" ? today : null),
    budgetCents: v.budget ?? null,
    note: v.note ?? null,
  });
  await deps.audit.record({ action: "maintenance.work.update", entityType: "maint_work", entityId: id, diff: { statusFrom: current.status, statusTo: v.status } });
  return ok({ id });
}

/** Cambia solo lo stato: inizio e fine si compilano con la data di oggi se mancano. */
export async function setWorkStatus(deps: MaintenanceDeps, id: string, status: string, today: string): Promise<Id> {
  if (!(WORK_STATUSES as readonly string[]).includes(status)) return fail({ status: ["Stato non valido"] });
  const work = await deps.repo.getWork(id);
  if (!work) return failGeneral("Intervento non trovato");
  const next = status as WorkStatus;
  await deps.repo.updateWork(id, { status: next, ...(next === "in_progress" && !work.startedOn && { startedOn: today }), ...(next === "completed" && !work.completedOn && { completedOn: today }) });
  await deps.audit.record({ action: "maintenance.work.status", entityType: "maint_work", entityId: id, diff: { statusFrom: work.status, statusTo: next } });
  return ok({ id });
}

// -------------------------------------------------------------------------------------------------- preventivi

export async function addQuote(deps: MaintenanceDeps, workId: string, raw: unknown): Promise<Id> {
  const p = parseInput(quoteSchema, raw);
  if (!p.ok) return p;
  const work = await deps.repo.getWork(workId);
  if (!work) return failGeneral("Intervento non trovato");
  const v = p.value;
  const errors = await refs(deps, { parties: [v.supplierPartyId], documents: [v.documentId] });
  if (hasErrors(errors)) return fail(errors);
  const id = await deps.repo.insertQuote({ workId, supplierPartyId: v.supplierPartyId ?? null, amountCents: v.amount, quotedOn: v.quotedOn ?? null, validUntil: v.validUntil ?? null, status: v.status, documentId: v.documentId ?? null, note: v.note ?? null });
  // Con un preventivo l'intervento passa da «previsto» a «con preventivo»; con uno accettato, ad «approvato».
  if (v.status === "accepted") await advanceOnAccept(deps, work, v.supplierPartyId);
  else if (work.status === "planned") await deps.repo.updateWork(workId, { status: "quoted" });
  await deps.audit.record({ action: "maintenance.quote.add", entityType: "maint_work", entityId: workId, diff: { quoteId: id, status: v.status } });
  return ok({ id: workId });
}

async function advanceOnAccept(deps: MaintenanceDeps, work: WorkRow, supplierPartyId: string | undefined | null) {
  const patch: Partial<WorkRow> = {};
  if (work.status === "planned" || work.status === "quoted") patch.status = "approved";
  if (!work.supplierPartyId && supplierPartyId) patch.supplierPartyId = supplierPartyId;
  if (Object.keys(patch).length > 0) await deps.repo.updateWork(work.id, patch);
}

export async function setQuoteStatus(deps: MaintenanceDeps, quoteId: string, status: string): Promise<Id> {
  if (!(QUOTE_STATUSES as readonly string[]).includes(status)) return fail({ status: ["Stato non valido"] });
  const quote = await deps.repo.getQuote(quoteId);
  if (!quote) return failGeneral("Preventivo non trovato");
  await deps.repo.updateQuote(quoteId, { status: status as QuoteStatus });
  if (status === "accepted") {
    const work = await deps.repo.getWork(quote.workId);
    if (work) await advanceOnAccept(deps, work, quote.supplierPartyId);
  }
  await deps.audit.record({ action: "maintenance.quote.status", entityType: "maint_work", entityId: quote.workId, diff: { quoteId, statusFrom: quote.status, statusTo: status } });
  return ok({ id: quote.workId });
}
