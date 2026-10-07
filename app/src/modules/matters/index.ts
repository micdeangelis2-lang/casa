/**
 * Interfaccia pubblica del modulo Pratiche: una pratica raccoglie contatti incaricati, richieste di documenti,
 * documenti collegati e pareri di professionisti (informativi o validati formalmente: lo decide chi li registra).
 * Le scritture ricevono una `UnitOfWork`, le letture un `Db`.
 */
import type { UnitOfWork } from "@/platform/db/unit-of-work";
import type { Db } from "@/platform/db/types";
import { todayInItaly } from "@/platform/clock";
import { listAssets } from "@/modules/assets";
import { listParties } from "@/modules/directory";
import { documentTitles as readDocumentTitles } from "@/modules/documents";
import type { MatterCollaborators } from "./application/ports";
import * as useCases from "./application/use-cases";
import { drizzleMatterRepository } from "./infrastructure/drizzle-matter-repository";

export { MATTER_STATUSES, type EventKind, type MatterStatus, type OpinionNature, type RequestStatus } from "./domain/matter";
export type { MatterDetail, MatterListItem } from "./application/use-cases";
export { TIMELINE_KINDS, buildChecklist, buildTimeline, timelineCsv, type ChecklistItem, type Timeline, type TimelineCsvLabels, type TimelineEvent, type TimelineKind } from "./domain/dossier";
export { todayInItaly };

function collaborators(db: Db): MatterCollaborators {
  return {
    assetNames: async () => new Map((await listAssets(db, { includeArchived: true })).map((a) => [a.id, a.name])),
    parties: async () => new Map((await listParties(db, { includeArchived: true })).map((p) => [p.id, { name: p.displayName, roles: p.roles }])),
    documentTitles: (ids) => readDocumentTitles(db, ids),
  };
}

const writeDeps = (uow: UnitOfWork) => ({ repo: drizzleMatterRepository(uow.tx), others: collaborators(uow.tx), audit: uow.audit });
const readDeps = (db: Db) => ({ repo: drizzleMatterRepository(db), others: collaborators(db) });

export const createMatter = (uow: UnitOfWork, input: unknown, today = todayInItaly()) => useCases.createMatter(writeDeps(uow), input, today);
export const updateMatter = (uow: UnitOfWork, id: string, input: unknown, today = todayInItaly()) => useCases.updateMatter(writeDeps(uow), id, input, today);
export const assignParty = (uow: UnitOfWork, matterId: string, input: unknown) => useCases.assignParty(writeDeps(uow), matterId, input);
export const unassignParty = (uow: UnitOfWork, matterId: string, partyId: string) => useCases.unassignParty(writeDeps(uow), matterId, partyId);
export const addRequest = (uow: UnitOfWork, matterId: string, input: unknown, today = todayInItaly()) => useCases.addRequest(writeDeps(uow), matterId, input, today);
export const resolveRequest = (uow: UnitOfWork, requestId: string, input: unknown) => useCases.resolveRequest(writeDeps(uow), requestId, input);
export const addOpinion = (uow: UnitOfWork, matterId: string, input: unknown) => useCases.addOpinion(writeDeps(uow), matterId, input);
export const addEvent = (uow: UnitOfWork, matterId: string, input: unknown) => useCases.addEvent(writeDeps(uow), matterId, input);
export const removeEvent = (uow: UnitOfWork, matterId: string, eventId: string) => useCases.removeEvent(writeDeps(uow), matterId, eventId);
export const linkMatterDocument = (uow: UnitOfWork, matterId: string, documentId: string) => useCases.linkMatterDocument(writeDeps(uow), matterId, documentId);
export const unlinkMatterDocument = (uow: UnitOfWork, matterId: string, documentId: string) => useCases.unlinkMatterDocument(writeDeps(uow), matterId, documentId);

export const listMatters = (db: Db, args: Parameters<typeof useCases.listMatters>[1] = {}) => useCases.listMatters(readDeps(db), args);
export const getMatterDetail = (db: Db, id: string) => useCases.getMatterDetail(readDeps(db), id);
