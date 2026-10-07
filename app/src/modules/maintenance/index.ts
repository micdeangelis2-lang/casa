/**
 * Interfaccia pubblica del modulo Manutenzioni e lavori: interventi con preventivi, avanzamenti e fatture, garanzie e piani
 * di ispezione periodica (una scadenza ricorrente). L'app registra e ricorda: non valuta preventivi, non dice se un lavoro e'
 * a regola d'arte ne' se una garanzia si applica. Scritture: `UnitOfWork`; letture: `Db`.
 */
import type { UnitOfWork } from "@/platform/db/unit-of-work";
import type { Db } from "@/platform/db/types";
import { todayInItaly } from "@/platform/clock";
import { listAssets } from "@/modules/assets";
import { createDeadline, getDeadlineDetail, setDeadlineArchived } from "@/modules/deadlines";
import { listParties } from "@/modules/directory";
import { documentTitles as readDocumentTitles, getDocumentDetail, listDocuments } from "@/modules/documents";
import type { MaintenanceCollaborators } from "./application/ports";
import * as useCases from "./application/use-cases";
import { plantRegister, type PlantRegisterArgs } from "./application/plant-register";
import { drizzleMaintenanceRepository } from "./infrastructure/drizzle-maintenance-repository";

export { PLANT_KINDS, QUOTE_STATUSES, WORK_STATUSES, type EntryKind, type PlantKind, type QuoteStatus, type WorkStatus } from "./domain/maintenance";
export type { DueState, PlantGroup, PlantTypeDef } from "./domain/plants";
export type { PlanItem, PlantDetail, PlantItem, WarrantyItem, WorkDetail, WorkItem } from "./application/use-cases";
export { todayInItaly };

function collaborators(db: Db, uow?: UnitOfWork): MaintenanceCollaborators {
  return {
    assets: async () => (await listAssets(db)).map((a) => ({ id: a.id, name: a.name })),
    parties: async () => new Map((await listParties(db, { includeArchived: true })).map((p) => [p.id, p.displayName])),
    documentTitles: () => readDocumentTitles(db),
    async createDeadline(d) {
      if (!uow) throw new Error("Per creare una scadenza serve un'unita' di lavoro");
      const result = await createDeadline(uow, {
        title: d.title,
        category: d.category,
        level: d.level,
        assetId: d.assetId,
        calc: d.calc.type === "manual" ? { type: "manual" } : { type: "recurring", anchor: { kind: "date", date: d.calc.anchorOn }, every: { unit: "months", amount: d.calc.everyMonths } },
        ...(d.calc.type === "manual" && { firstDueOn: d.calc.dueOn }),
        priority: "normal",
        proofRequired: d.proofRequired,
      });
      return result.ok ? result.value.id : null;
    },
    async archiveDeadline(deadlineId, archived) {
      if (!uow) throw new Error("Per archiviare una scadenza serve un'unita' di lavoro");
      await setDeadlineArchived(uow, deadlineId, archived);
    },
    async deadlineDates(deadlineId) {
      const detail = await getDeadlineDetail(db, deadlineId, todayInItaly());
      const open = (detail?.occurrences ?? []).filter((o) => o.status === "open").map((o) => o.dueOn).sort();
      const done = (detail?.occurrences ?? []).filter((o) => o.status === "done" && o.completedOn).map((o) => o.completedOn!).sort();
      return { nextDueOn: open[0] ?? null, lastDoneOn: done.at(-1) ?? null };
    },
  };
}

const writeDeps = (uow: UnitOfWork) => ({ repo: drizzleMaintenanceRepository(uow.tx), others: collaborators(uow.tx, uow), audit: uow.audit });
const readDeps = (db: Db) => ({ repo: drizzleMaintenanceRepository(db), others: collaborators(db) });

export const createWork = (uow: UnitOfWork, input: unknown) => useCases.createWork(writeDeps(uow), input);
export const updateWork = (uow: UnitOfWork, id: string, input: unknown, today = todayInItaly()) => useCases.updateWork(writeDeps(uow), id, input, today);
export const setWorkStatus = (uow: UnitOfWork, id: string, status: string, today = todayInItaly()) => useCases.setWorkStatus(writeDeps(uow), id, status, today);
export const addQuote = (uow: UnitOfWork, workId: string, input: unknown) => useCases.addQuote(writeDeps(uow), workId, input);
export const setQuoteStatus = (uow: UnitOfWork, quoteId: string, status: string) => useCases.setQuoteStatus(writeDeps(uow), quoteId, status);
export const addInvoice = (uow: UnitOfWork, workId: string, input: unknown) => useCases.addInvoice(writeDeps(uow), workId, input);
export const setInvoicePaid = (uow: UnitOfWork, invoiceId: string, paidOn: string | null) => useCases.setInvoicePaid(writeDeps(uow), invoiceId, paidOn);
export const addProgress = (uow: UnitOfWork, workId: string, input: unknown, today = todayInItaly()) => useCases.addProgress(writeDeps(uow), workId, input, today);
export const removeEntry = (uow: UnitOfWork, kind: string, entryId: string) => useCases.removeEntry(writeDeps(uow), kind, entryId);
export const createWarranty = (uow: UnitOfWork, input: unknown) => useCases.createWarranty(writeDeps(uow), input);
export const setWarrantyArchived = (uow: UnitOfWork, id: string, archived: boolean) => useCases.setWarrantyArchived(writeDeps(uow), id, archived);
export const createInspectionPlan = (uow: UnitOfWork, input: unknown) => useCases.createInspectionPlan(writeDeps(uow), input);
export const createPlant = (uow: UnitOfWork, input: unknown) => useCases.createPlant(writeDeps(uow), input);
export const updatePlant = (uow: UnitOfWork, id: string, input: unknown) => useCases.updatePlant(writeDeps(uow), id, input);
export const setPlantArchived = (uow: UnitOfWork, id: string, archived: boolean) => useCases.setPlantArchived(writeDeps(uow), id, archived);
export const linkPlantDocument = (uow: UnitOfWork, plantId: string, documentId: string) => useCases.linkPlantDocument(writeDeps(uow), plantId, documentId);
export const unlinkPlantDocument = (uow: UnitOfWork, plantId: string, documentId: string) => useCases.unlinkPlantDocument(writeDeps(uow), plantId, documentId);
/** Collega (o scollega, con `plantId` nullo) un piano, una garanzia o un intervento esistente a un impianto dello stesso immobile. */
export const assignPlant = (uow: UnitOfWork, kind: string, id: string, plantId: string | null) => useCases.assignPlant(writeDeps(uow), kind, id, plantId);
export const setPlanArchived = (uow: UnitOfWork, id: string, archived: boolean) => useCases.setPlanArchived(writeDeps(uow), id, archived);

/** Fatture pagate in un periodo (per il quadro economico). */
export const maintenanceLedger = (db: Db, from: string, to: string) => useCases.invoiceLedger(readDeps(db), from, to);
export const listPlants = (db: Db, filter: { assetId?: string; includeArchived?: boolean } = {}) => useCases.listPlants(readDeps(db), filter);
export const getPlantDetail = (db: Db, id: string) => useCases.getPlantDetail(readDeps(db), id);
export const listWorks = (db: Db, filter: { assetId?: string; status?: string; includeClosed?: boolean } = {}) => useCases.listWorks(readDeps(db), filter);
export const getWorkDetail = (db: Db, id: string, today = todayInItaly()) => useCases.getWorkDetail(readDeps(db), id, today);
export const listWarranties = (db: Db, filter: { assetId?: string; includeArchived?: boolean } = {}, today = todayInItaly()) => useCases.listWarranties(readDeps(db), filter, today);
export const listInspectionPlans = (db: Db, filter: { assetId?: string; includeArchived?: boolean } = {}) => useCases.listInspectionPlans(readDeps(db), filter);

/** Registro degli impianti (sola lettura): per immobile e tipo, con verifiche, garanzie, interventi e documenti gia' registrati. */
export const getPlantRegister = (db: Db, args: PlantRegisterArgs) => {
  const deps = readDeps(db);
  return plantRegister(
    {
      assets: () => deps.others.assets(),
      plans: (assetId) => useCases.listInspectionPlans(deps, { assetId }),
      warranties: (assetId) => useCases.listWarranties(deps, { assetId }, args.today),
      works: (assetId) => useCases.listWorks(deps, { assetId, includeClosed: true }),
      documentsOf: async (assetId) => (await listDocuments(db, { assetId })).map((d) => ({ id: d.id, title: d.title, categoryName: d.categoryName, validTo: d.validTo })),
      plants: async (assetId) => {
        const items = await useCases.listPlants(deps, { assetId });
        const links = await deps.repo.plantDocumentLinks(items.map((p) => p.id));
        return Promise.all(
          items.map(async (p) => {
            const documents = (
              await Promise.all(
                links
                  .filter((l) => l.plantId === p.id)
                  .map(async (l) => {
                    const d = await getDocumentDetail(db, l.documentId);
                    return d ? [{ id: d.id, title: d.title, categoryName: d.categoryName, validTo: d.versions[0]?.validTo ?? null }] : [];
                  }),
              )
            ).flat();
            return { id: p.id, name: p.name, kind: p.kind, installedOn: p.installedOn, serialNumber: p.serialNumber, installerName: p.installerName, maintainerName: p.maintainerName, note: p.note, documents };
          }),
        );
      },
    },
    args,
  );
};
