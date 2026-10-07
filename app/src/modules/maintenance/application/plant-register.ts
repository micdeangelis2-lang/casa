import { buildDueEntries, buildPlantGroups, type DueEntry, type PlantDocument, type PlantEntity, type PlantGroup, type PlantSources, type PlantTypeDef } from "../domain/plants";
import type { PlanItem, WarrantyItem, WorkItem } from "./use-cases";

export type PlantRegisterDeps = {
  assets: () => Promise<{ id: string; name: string }[]>;
  plans: (assetId?: string) => Promise<PlanItem[]>;
  warranties: (assetId?: string) => Promise<WarrantyItem[]>;
  works: (assetId?: string) => Promise<WorkItem[]>;
  documentsOf: (assetId: string) => Promise<PlantDocument[]>;
  /** Impianti registrati dell'immobile, con i documenti collegati. */
  plants: (assetId: string) => Promise<PlantEntity[]>;
};

export type PlantRegisterArgs = { assetId?: string; type?: string; types: PlantTypeDef[]; today: string; soonDays: number };
export type PlantRegister = { groups: PlantGroup[]; due: DueEntry[]; assets: { id: string; name: string }[] };

/** Registro degli impianti: unisce, per immobile, piani di ispezione, garanzie, interventi e documenti gia' registrati. Sola lettura. */
export async function plantRegister(deps: PlantRegisterDeps, args: PlantRegisterArgs): Promise<PlantRegister> {
  const allAssets = await deps.assets();
  const assets = args.assetId ? allAssets.filter((a) => a.id === args.assetId) : allAssets;
  const sources: PlantSources[] = await Promise.all(
    assets.map(async (a) => {
      const [plans, warranties, works, documents, plants] = await Promise.all([deps.plans(a.id), deps.warranties(a.id), deps.works(a.id), deps.documentsOf(a.id), deps.plants(a.id)]);
      return {
        assetId: a.id,
        assetName: a.name,
        plants,
        plans: plans.map((p) => ({ plantId: p.plantId, id: p.id, title: p.title, intervalMonths: p.intervalMonths, supplierName: p.supplierName, lastDoneOn: p.lastDoneOn, nextDueOn: p.nextDueOn, deadlineId: p.deadlineId, note: p.note })),
        warranties: warranties.map((w) => ({ plantId: w.plantId, id: w.id, title: w.title, startsOn: w.startsOn, endsOn: w.endsOn, supplierName: w.supplierName, documentTitle: w.documentTitle })),
        works: works.map((w) => ({ plantId: w.plantId, id: w.id, title: w.title, status: w.status, supplierName: w.supplierName, completedOn: w.completedOn, scheduledOn: w.scheduledOn })),
        documents,
      };
    }),
  );
  const groups = buildPlantGroups(sources, args.types, args.today, args.soonDays, args.type);
  return { groups, due: buildDueEntries(groups, args.today, args.soonDays), assets: allAssets };
}
