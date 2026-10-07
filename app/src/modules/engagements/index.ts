/**
 * Interfaccia pubblica del modulo Incarichi: l'incarico a un professionista (oggetto, data, compenso dichiarato, stato, lettera
 * d'incarico) e gli elaborati consegnati o ricevuti. Sono dati scritti dal proprietario: l'app non valuta ne' il compenso ne'
 * l'esito dell'incarico. Scritture: `UnitOfWork`; letture: `Db`.
 */
import type { UnitOfWork } from "@/platform/db/unit-of-work";
import type { Db } from "@/platform/db/types";
import { listAssets } from "@/modules/assets";
import { listParties } from "@/modules/directory";
import { documentTitles as readDocumentTitles } from "@/modules/documents";
import { listMatters } from "@/modules/matters";
import type { EngagementCollaborators } from "./application/ports";
import * as useCases from "./application/use-cases";
import { drizzleEngagementRepository } from "./infrastructure/drizzle-engagement-repository";

export { DELIVERABLE_DIRECTIONS, ENGAGEMENT_STATUSES, type DeliverableDirection, type EngagementStatus } from "./domain/engagement";
export { groupByProfessional, type EngagementItem } from "./application/use-cases";

function collaborators(db: Db): EngagementCollaborators {
  return {
    partyNames: async () => new Map((await listParties(db, { includeArchived: true })).map((p) => [p.id, p.displayName])),
    assetNames: async () => new Map((await listAssets(db, { includeArchived: true })).map((a) => [a.id, a.name])),
    matterTitles: async () => new Map((await listMatters(db, { includeClosed: true })).map((m) => [m.id, m.title])),
    documentTitles: (ids) => readDocumentTitles(db, ids),
  };
}

const writeDeps = (uow: UnitOfWork) => ({ repo: drizzleEngagementRepository(uow.tx), others: collaborators(uow.tx), audit: uow.audit });
const readDeps = (db: Db) => ({ repo: drizzleEngagementRepository(db), others: collaborators(db) });

export const createEngagement = (uow: UnitOfWork, input: unknown) => useCases.createEngagement(writeDeps(uow), input);
export const updateEngagement = (uow: UnitOfWork, id: string, input: unknown) => useCases.updateEngagement(writeDeps(uow), id, input);
export const setEngagementStatus = (uow: UnitOfWork, id: string, status: string) => useCases.setEngagementStatus(writeDeps(uow), id, status);
export const addDeliverable = (uow: UnitOfWork, engagementId: string, input: unknown) => useCases.addDeliverable(writeDeps(uow), engagementId, input);
export const removeDeliverable = (uow: UnitOfWork, deliverableId: string) => useCases.removeDeliverable(writeDeps(uow), deliverableId);

export const listEngagements = (db: Db, filter: { partyId?: string; assetId?: string; matterId?: string } = {}) => useCases.listEngagements(readDeps(db), filter);
