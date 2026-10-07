/**
 * Interfaccia pubblica del modulo Dossier: le voci di ogni bene (manuali o derivate dalle regole), lo stato scelto dal
 * proprietario, i documenti collegati e il riepilogo per stato — che conta e basta, senza giudizi di conformita'.
 * Le scritture ricevono una `UnitOfWork`, le letture un `Db`.
 */
import { asc } from "drizzle-orm";
import type { UnitOfWork } from "@/platform/db/unit-of-work";
import type { Db } from "@/platform/db/types";
import { documentCategory } from "@/platform/db/schema";
import { todayInItaly } from "@/platform/clock";
import { getAssetDetail, listAssets } from "@/modules/assets";
import { PICKER_LIMIT, listDocuments } from "@/modules/documents";
import { syncDerivedDeadlines } from "@/modules/deadlines";
import { loadActiveRules } from "@/modules/rules";
import { activeLettingTypes } from "@/modules/lettings";
import { territoryChainIds } from "@/modules/territory";
import type { DocumentInfo, DossierCollaborators } from "./application/ports";
import * as useCases from "./application/use-cases";
import { drizzleDossierRepository } from "./infrastructure/drizzle-dossier-repository";

export { DOSSIER_STATUSES, type DossierStatus } from "./domain/dossier";
export type { DossierItemView, DossierView } from "./application/use-cases";
export type { DocumentInfo, EvaluationDiff } from "./application/ports";
export { todayInItaly };

function collaborators(db: Db, uow?: UnitOfWork): DossierCollaborators {
  const toInfo = (d: { id: string; title: string; validTo: string | null; archived: boolean }): DocumentInfo => ({ id: d.id, title: d.title, validTo: d.validTo, archived: d.archived });
  return {
    async factsFor(assetId, asOf) {
      const detail = await getAssetDetail(db, assetId);
      if (!detail || detail.archived) return null;
      const current = detail.rights.filter((r) => !r.validTo || r.validTo >= asOf);
      return {
        facts: {
          asset: { kind: detail.kind, useType: detail.useType, inCondominium: detail.inCondominium },
          rights: { regimes: [...new Set(current.map((r) => r.rightType))] },
          letting: { types: await activeLettingTypes(db, assetId) },
          attributes: detail.attributes,
        },
        territoryChain: new Set(await territoryChainIds(db, detail.territoryId)),
      };
    },
    activeRules: () => loadActiveRules(db),
    documents: async (ids) => (await listDocuments(db, { includeArchived: true, ids })).map(toInfo),
    linkableDocuments: async () => (await listDocuments(db, { limit: PICKER_LIMIT })).map(toInfo),
    documentCategoryNames: async () =>
      new Map((await db.select({ code: documentCategory.code, name: documentCategory.name }).from(documentCategory).orderBy(asc(documentCategory.position))).map((c) => [c.code, c.name])),
    assetName: async (id) => (await getAssetDetail(db, id))?.name ?? null,
    activeAssetIds: async () => (await listAssets(db)).map((a) => a.id),
    syncDeadlines: async (assetId, derived, asOf) => {
      if (!uow) throw new Error("Per allineare le scadenze serve un'unita' di lavoro");
      await syncDerivedDeadlines(uow, assetId, derived, asOf);
    },
  };
}

const writeDeps = (uow: UnitOfWork) => ({ repo: drizzleDossierRepository(uow.tx), others: collaborators(uow.tx, uow), audit: uow.audit });
const readDeps = (db: Db) => ({ repo: drizzleDossierRepository(db), others: collaborators(db) });

export const evaluateDossier = (uow: UnitOfWork, assetId: string, asOf = todayInItaly()) => useCases.evaluateDossier(writeDeps(uow), assetId, asOf);
export const evaluateAllDossiers = (uow: UnitOfWork, asOf = todayInItaly()) => useCases.evaluateAllAssets(writeDeps(uow), asOf);
export const addManualItem = (uow: UnitOfWork, assetId: string, input: unknown) => useCases.addManualItem(writeDeps(uow), assetId, input);
export const setItemStatus = (uow: UnitOfWork, itemId: string, status: unknown) => useCases.setItemStatus(writeDeps(uow), itemId, status);
export const setItemNote = (uow: UnitOfWork, itemId: string, note: unknown) => useCases.setItemNote(writeDeps(uow), itemId, note);
export const removeManualItem = (uow: UnitOfWork, itemId: string) => useCases.removeManualItem(writeDeps(uow), itemId);
export const linkDocument = (uow: UnitOfWork, itemId: string, documentId: string) => useCases.linkDocument(writeDeps(uow), itemId, documentId);
export const unlinkDocument = (uow: UnitOfWork, itemId: string, documentId: string) => useCases.unlinkDocument(writeDeps(uow), itemId, documentId);

export const getDossier = (db: Db, assetId: string, asOf = todayInItaly()) => useCases.getDossier(readDeps(db), assetId, asOf);
export const listLinkableDocuments = (db: Db) => collaborators(db).linkableDocuments();
export const listDossierCategories = (db: Db) => drizzleDossierRepository(db).listCategories();
