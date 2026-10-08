import type { FieldErrors, Result } from "@/shared/result";
import type { MaintenanceDeps } from "./ports";

export type Id = Result<{ id: string }>;
export const hasErrors = (e: FieldErrors) => Object.keys(e).length > 0;

export async function refs(deps: MaintenanceDeps, r: { assetId?: string; parties?: (string | undefined)[]; documents?: (string | undefined)[]; workId?: string; plantId?: string }): Promise<FieldErrors> {
  const errors: FieldErrors = {};
  if (r.assetId && !(await deps.others.assets()).some((a) => a.id === r.assetId)) errors.assetId = ["L'immobile non esiste"];
  const wantedParties = (r.parties ?? []).filter((x): x is string => Boolean(x));
  if (wantedParties.length > 0) {
    const known = await deps.others.parties();
    if (wantedParties.some((p) => !known.has(p))) errors.supplierPartyId = ["Il contatto non esiste più nella rubrica"];
  }
  const wantedDocuments = (r.documents ?? []).filter((x): x is string => Boolean(x));
  if (wantedDocuments.length > 0) {
    const known = await deps.others.documentTitles();
    if (wantedDocuments.some((d) => !known.has(d))) errors.documentId = ["Il documento non esiste"];
  }
  if (r.workId && !(await deps.repo.getWork(r.workId))) errors.workId = ["L'intervento non esiste"];
  if (r.plantId) {
    const plant = await deps.repo.getPlant(r.plantId);
    if (!plant) errors.plantId = ["L'impianto non esiste"];
    else if (r.assetId && plant.assetId !== r.assetId) errors.plantId = ["L'impianto appartiene a un altro immobile"];
  }
  return errors;
}

export async function assetName(deps: MaintenanceDeps, assetId: string): Promise<string> {
  return (await deps.others.assets()).find((a) => a.id === assetId)?.name ?? "";
}
