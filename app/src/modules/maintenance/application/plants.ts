import { fail, failGeneral, ok, parseInput } from "@/shared/result";
import { plantSchema, plantUpdateSchema } from "../domain/maintenance";
import { hasErrors, refs, type Id } from "./common";
import type { MaintenanceDeps, PlantRow } from "./ports";

// -------------------------------------------------------------------------------------------------- impianti

function plantData(v: { kind: PlantRow["kind"]; name: string; installedOn?: string; installerPartyId?: string; maintainerPartyId?: string; serialNumber?: string; note?: string }) {
  return {
    kind: v.kind,
    name: v.name,
    installedOn: v.installedOn ?? null,
    installerPartyId: v.installerPartyId ?? null,
    maintainerPartyId: v.maintainerPartyId ?? null,
    serialNumber: v.serialNumber ?? null,
    note: v.note ?? null,
  };
}

export async function createPlant(deps: MaintenanceDeps, raw: unknown): Promise<Id> {
  const p = parseInput(plantSchema, raw);
  if (!p.ok) return p;
  const v = p.value;
  const errors = await refs(deps, { assetId: v.assetId, parties: [v.installerPartyId, v.maintainerPartyId] });
  if (hasErrors(errors)) return fail(errors);
  const id = await deps.repo.insertPlant({ assetId: v.assetId, ...plantData(v), archived: false });
  await deps.audit.record({ action: "maintenance.plant.create", entityType: "plant", entityId: id, diff: { kind: v.kind, assetId: v.assetId } });
  return ok({ id });
}

export async function updatePlant(deps: MaintenanceDeps, id: string, raw: unknown): Promise<Id> {
  const p = parseInput(plantUpdateSchema, raw);
  if (!p.ok) return p;
  const current = await deps.repo.getPlant(id);
  if (!current) return failGeneral("Impianto non trovato");
  const v = p.value;
  const errors = await refs(deps, { parties: [v.installerPartyId, v.maintainerPartyId] });
  if (hasErrors(errors)) return fail(errors);
  const next = plantData(v);
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== current[k]);
  await deps.repo.updatePlant(id, next);
  await deps.audit.record({ action: "maintenance.plant.update", entityType: "plant", entityId: id, diff: { changed } });
  return ok({ id });
}

export async function setPlantArchived(deps: MaintenanceDeps, id: string, archived: boolean): Promise<Id> {
  if (!(await deps.repo.getPlant(id))) return failGeneral("Impianto non trovato");
  await deps.repo.updatePlant(id, { archived });
  await deps.audit.record({ action: archived ? "maintenance.plant.archive" : "maintenance.plant.restore", entityType: "plant", entityId: id, diff: {} });
  return ok({ id });
}

export async function linkPlantDocument(deps: MaintenanceDeps, plantId: string, documentId: string): Promise<Id> {
  if (!(await deps.repo.getPlant(plantId))) return failGeneral("Impianto non trovato");
  const errors = await refs(deps, { documents: [documentId] });
  if (hasErrors(errors)) return fail(errors);
  await deps.repo.linkPlantDocument(plantId, documentId);
  await deps.audit.record({ action: "maintenance.plant.document.link", entityType: "plant", entityId: plantId, diff: { documentId } });
  return ok({ id: plantId });
}

export async function unlinkPlantDocument(deps: MaintenanceDeps, plantId: string, documentId: string): Promise<Id> {
  if (!(await deps.repo.getPlant(plantId))) return failGeneral("Impianto non trovato");
  await deps.repo.unlinkPlantDocument(plantId, documentId);
  await deps.audit.record({ action: "maintenance.plant.document.unlink", entityType: "plant", entityId: plantId, diff: { documentId } });
  return ok({ id: plantId });
}

export const PLANT_LINK_KINDS = ["plan", "warranty", "work"] as const;

/** Collega a un impianto (o scollega, con `plantId` nullo) un piano di ispezione, una garanzia o un intervento esistente dello stesso immobile. */
export async function assignPlant(deps: MaintenanceDeps, kind: string, id: string, plantId: string | null): Promise<Id> {
  if (!(PLANT_LINK_KINDS as readonly string[]).includes(kind)) return failGeneral("Elemento non trovato");
  const record = kind === "plan" ? await deps.repo.getPlan(id) : kind === "warranty" ? await deps.repo.getWarranty(id) : await deps.repo.getWork(id);
  if (!record) return failGeneral("Elemento non trovato");
  if (plantId) {
    const errors = await refs(deps, { assetId: record.assetId, plantId });
    if (hasErrors(errors)) return fail(errors);
  }
  if (kind === "plan") await deps.repo.updatePlan(id, { plantId });
  else if (kind === "warranty") await deps.repo.updateWarranty(id, { plantId });
  else await deps.repo.updateWork(id, { plantId });
  await deps.audit.record({ action: plantId ? "maintenance.plant.assign" : "maintenance.plant.unassign", entityType: "plant", entityId: plantId ?? record.plantId ?? id, diff: { kind, itemId: id } });
  return ok({ id });
}
