import { fail, failGeneral, ok, parseInput } from "@/shared/result";
import { inspectionPlanSchema, warrantySchema } from "../domain/maintenance";
import { assetName, hasErrors, refs, type Id } from "./common";
import type { MaintenanceDeps } from "./ports";

// -------------------------------------------------------------------------------------------------- garanzie e ispezioni

export async function createWarranty(deps: MaintenanceDeps, raw: unknown): Promise<Id> {
  const p = parseInput(warrantySchema, raw);
  if (!p.ok) return p;
  const v = p.value;
  const errors = await refs(deps, { assetId: v.assetId, parties: [v.supplierPartyId], documents: [v.documentId], workId: v.workId, plantId: v.plantId });
  if (hasErrors(errors)) return fail(errors);
  const id = await deps.repo.insertWarranty({ assetId: v.assetId, workId: v.workId ?? null, plantId: v.plantId ?? null, title: v.title, startsOn: v.startsOn ?? null, endsOn: v.endsOn, supplierPartyId: v.supplierPartyId ?? null, documentId: v.documentId ?? null, note: v.note ?? null, deadlineId: null, archived: false });
  let deadlineCreated = false;
  if (v.createDeadline) {
    const deadlineId = await deps.others.createDeadline({ title: `Scadenza garanzia: ${v.title} (${await assetName(deps, v.assetId)})`, assetId: v.assetId, category: "contractual", level: "contract", calc: { type: "manual", dueOn: v.endsOn }, proofRequired: false });
    if (deadlineId) {
      await deps.repo.updateWarranty(id, { deadlineId });
      deadlineCreated = true;
    }
  }
  await deps.audit.record({ action: "maintenance.warranty.create", entityType: "maint_warranty", entityId: id, diff: { deadlineCreated } });
  return ok({ id });
}

/** Archivia una garanzia (o la ripristina); la scadenza collegata segue. */
export async function setWarrantyArchived(deps: MaintenanceDeps, id: string, archived: boolean): Promise<Id> {
  const w = await deps.repo.getWarranty(id);
  if (!w) return failGeneral("Garanzia non trovata");
  await deps.repo.updateWarranty(id, { archived });
  if (w.deadlineId) await deps.others.archiveDeadline(w.deadlineId, archived);
  await deps.audit.record({ action: archived ? "maintenance.warranty.archive" : "maintenance.warranty.restore", entityType: "maint_warranty", entityId: id, diff: {} });
  return ok({ id });
}

export async function createInspectionPlan(deps: MaintenanceDeps, raw: unknown): Promise<Id> {
  const p = parseInput(inspectionPlanSchema, raw);
  if (!p.ok) return p;
  const v = p.value;
  const errors = await refs(deps, { assetId: v.assetId, parties: [v.supplierPartyId], plantId: v.plantId });
  if (hasErrors(errors)) return fail(errors);
  const deadlineId = await deps.others.createDeadline({ title: `${v.title} (${await assetName(deps, v.assetId)})`, assetId: v.assetId, category: "technical", level: "national", calc: { type: "recurring", anchorOn: v.firstDueOn, everyMonths: v.intervalMonths }, proofRequired: true });
  if (!deadlineId) return failGeneral("Non è stato possibile creare la scadenza ricorrente");
  const id = await deps.repo.insertPlan({ assetId: v.assetId, title: v.title, intervalMonths: v.intervalMonths, firstDueOn: v.firstDueOn, supplierPartyId: v.supplierPartyId ?? null, plantId: v.plantId ?? null, note: v.note ?? null, deadlineId, archived: false });
  await deps.audit.record({ action: "maintenance.plan.create", entityType: "maint_inspection_plan", entityId: id, diff: { intervalMonths: v.intervalMonths } });
  return ok({ id });
}

export async function setPlanArchived(deps: MaintenanceDeps, id: string, archived: boolean): Promise<Id> {
  const plan = await deps.repo.getPlan(id);
  if (!plan) return failGeneral("Piano non trovato");
  await deps.repo.updatePlan(id, { archived });
  if (plan.deadlineId) await deps.others.archiveDeadline(plan.deadlineId, archived);
  await deps.audit.record({ action: archived ? "maintenance.plan.archive" : "maintenance.plan.restore", entityType: "maint_inspection_plan", entityId: id, diff: {} });
  return ok({ id });
}
