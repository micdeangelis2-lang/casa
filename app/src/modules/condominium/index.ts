/**
 * Interfaccia pubblica del modulo Condominio: anagrafica, millesimi, esercizi con preventivi e rate ripartite, assemblee con
 * ordine del giorno, deleghe e delibere, lavori, sinistri, contratti. L'app registra e ricorda: non interpreta delibere e non
 * calcola maggioranze di legge (le soglie le scrive il proprietario). Scritture: `UnitOfWork`; letture: `Db`.
 */
import type { UnitOfWork } from "@/platform/db/unit-of-work";
import type { Db } from "@/platform/db/types";
import { todayInItaly } from "@/platform/clock";
import { listAssets } from "@/modules/assets";
import { completeOpenOccurrences, createDeadline, setDeadlineArchived } from "@/modules/deadlines";
import { listParties } from "@/modules/directory";
import { documentTitles as readDocumentTitles } from "@/modules/documents";
import { listPolicies } from "@/modules/insurance";
import { listMatters } from "@/modules/matters";
import type { CondoCollaborators } from "./application/ports";
import * as ownerReview from "./application/owner-review";
import * as useCases from "./application/use-cases";
import { drizzleCondoRepository } from "./infrastructure/drizzle-condo-repository";

export {
  BUDGET_KINDS,
  BUDGET_SCOPES,
  CLAIM_KINDS,
  CONTRACT_KINDS,
  DOCUMENT_KINDS,
  MEETING_KINDS,
  MEETING_STATUSES,
  RESOLUTION_OUTCOMES,
  WORK_ENTRY_KINDS,
  WORK_STATUSES,
  
} from "./domain/condominium";
export { formatMilli, } from "./domain/millesimi";
export { DELIVERY_KINDS, type DeliveryFact, type DeliveryKind, type FinalComparison, type RegisterFilter, type ResolutionRegisterRow, type StatementLine, type YearStatement } from "./domain/owner-review";
export type { CondoReview, OwnerReview, ReviewLabels } from "./application/owner-review";
export type { CondominiumDetail, CondominiumListItem, MeetingDetail } from "./application/use-cases";
export { todayInItaly };

function collaborators(db: Db, uow?: UnitOfWork): CondoCollaborators {
  return {
    assets: async () => (await listAssets(db)).map((a) => ({ id: a.id, name: a.name })),
    parties: async () => new Map((await listParties(db, { includeArchived: true })).map((p) => [p.id, p.displayName])),
    documentTitles: () => readDocumentTitles(db),
    matterTitles: async () => new Map((await listMatters(db, { includeClosed: true })).map((m) => [m.id, m.title])),
    async createDeadline(d) {
      if (!uow) throw new Error("Per creare una scadenza serve un'unita' di lavoro");
      const result = await createDeadline(uow, {
        title: d.title,
        category: d.category,
        level: d.level,
        assetId: d.assetId,
        calc: { type: "manual" },
        firstDueOn: d.dueOn,
        priority: "normal",
        proofRequired: d.proofRequired ?? false,
      });
      return result.ok ? result.value.id : null;
    },
    async completeDeadline(deadlineId, d) {
      if (!uow) throw new Error("Per chiudere una scadenza serve un'unita' di lavoro");
      await completeOpenOccurrences(uow, deadlineId, d);
    },
    async archiveDeadline(deadlineId) {
      if (!uow) throw new Error("Per archiviare una scadenza serve un'unita' di lavoro");
      await setDeadlineArchived(uow, deadlineId, true);
    },
  };
}

const writeDeps = (uow: UnitOfWork) => ({ repo: drizzleCondoRepository(uow.tx), others: collaborators(uow.tx, uow), audit: uow.audit });
const readDeps = (db: Db) => ({ repo: drizzleCondoRepository(db), others: collaborators(db) });

export const createCondominium = (uow: UnitOfWork, input: unknown) => useCases.createCondominium(writeDeps(uow), input);
export const updateCondominium = (uow: UnitOfWork, id: string, input: unknown) => useCases.updateCondominium(writeDeps(uow), id, input);
export const setCondominiumArchived = (uow: UnitOfWork, id: string, archived: boolean) => useCases.setCondominiumArchived(writeDeps(uow), id, archived);
export const addMember = (uow: UnitOfWork, condoId: string, input: unknown) => useCases.addMember(writeDeps(uow), condoId, input);
export const removeMember = (uow: UnitOfWork, condoId: string, assetId: string) => useCases.removeMember(writeDeps(uow), condoId, assetId);
export const createTable = (uow: UnitOfWork, condoId: string, input: unknown) => useCases.createTable(writeDeps(uow), condoId, input);
export const saveOtherShares = (uow: UnitOfWork, tableId: string, input: unknown) => useCases.saveOtherShares(writeDeps(uow), tableId, input);
export const saveShares = (uow: UnitOfWork, tableId: string, input: unknown) => useCases.saveShares(writeDeps(uow), tableId, input);
export const createFiscalYear = (uow: UnitOfWork, condoId: string, input: unknown) => useCases.createFiscalYear(writeDeps(uow), condoId, input);
export const createBudget = (uow: UnitOfWork, yearId: string, input: unknown) => useCases.createBudget(writeDeps(uow), yearId, input);
export const generateInstallments = (uow: UnitOfWork, budgetId: string, input: unknown) => useCases.generateInstallments(writeDeps(uow), budgetId, input);
export const recordPayment = (uow: UnitOfWork, installmentId: string, input: unknown, today = todayInItaly()) => useCases.recordPayment(writeDeps(uow), installmentId, input, today);
export const createMeeting = (uow: UnitOfWork, condoId: string, input: unknown) => useCases.createMeeting(writeDeps(uow), condoId, input);
export const updateMeeting = (uow: UnitOfWork, meetingId: string, input: unknown) => useCases.updateMeeting(writeDeps(uow), meetingId, input);
export const addAgendaItem = (uow: UnitOfWork, meetingId: string, input: unknown) => useCases.addAgendaItem(writeDeps(uow), meetingId, input);
export const updateAgendaItem = (uow: UnitOfWork, itemId: string, input: unknown) => useCases.updateAgendaItem(writeDeps(uow), itemId, input);
export const removeAgendaItem = (uow: UnitOfWork, itemId: string) => useCases.removeAgendaItem(writeDeps(uow), itemId);
export const setAgendaDocument = (uow: UnitOfWork, itemId: string, documentId: string, linked: boolean) => useCases.setAgendaDocument(writeDeps(uow), itemId, documentId, linked);
export const addProxy = (uow: UnitOfWork, meetingId: string, input: unknown) => useCases.addProxy(writeDeps(uow), meetingId, input);
export const removeProxy = (uow: UnitOfWork, meetingId: string, proxyId: string) => useCases.removeProxy(writeDeps(uow), meetingId, proxyId);
export const addResolution = (uow: UnitOfWork, meetingId: string, input: unknown) => useCases.addResolution(writeDeps(uow), meetingId, input);
export const updateResolution = (uow: UnitOfWork, resolutionId: string, input: unknown) => useCases.updateResolution(writeDeps(uow), resolutionId, input);
export const createResolutionDeadline = (uow: UnitOfWork, resolutionId: string, input: unknown) => useCases.createResolutionDeadline(writeDeps(uow), resolutionId, input);
export const linkResolutionBudget = (uow: UnitOfWork, resolutionId: string, budgetId: string | null) => useCases.linkResolutionBudget(writeDeps(uow), resolutionId, budgetId);
export const createWork = (uow: UnitOfWork, condoId: string, input: unknown) => useCases.createWork(writeDeps(uow), condoId, input);
export const updateWork = (uow: UnitOfWork, workId: string, input: unknown) => useCases.updateWork(writeDeps(uow), workId, input);
export const addWorkEntry = (uow: UnitOfWork, workId: string, input: unknown) => useCases.addWorkEntry(writeDeps(uow), workId, input);
export const createClaim = (uow: UnitOfWork, condoId: string, input: unknown, today = todayInItaly()) => useCases.createClaim(writeDeps(uow), condoId, input, today);
export const updateClaim = (uow: UnitOfWork, claimId: string, input: unknown, today = todayInItaly()) => useCases.updateClaim(writeDeps(uow), claimId, input, today);
export const createContract = (uow: UnitOfWork, condoId: string, input: unknown) => useCases.createContract(writeDeps(uow), condoId, input);
export const linkCondoDocument = (uow: UnitOfWork, condoId: string, documentId: string, kind: string) => useCases.linkCondoDocument(writeDeps(uow), condoId, documentId, kind);
export const unlinkCondoDocument = (uow: UnitOfWork, condoId: string, documentId: string) => useCases.unlinkCondoDocument(writeDeps(uow), condoId, documentId);

/** Rate di condominio pagate in un periodo (per il quadro economico). */
export const condominiumLedger = (db: Db, from: string, to: string) => useCases.installmentLedger(readDeps(db), from, to);
export const listCondominiums = (db: Db, includeArchived = false) => useCases.listCondominiums(readDeps(db), includeArchived);
export const getCondominiumDetail = (db: Db, id: string) => useCases.getCondominiumDetail(readDeps(db), id);
export const getMeetingDetail = (db: Db, id: string) => useCases.getMeetingDetail(readDeps(db), id);
/** Viste di controllo per il dialogo con l'amministratore (sola lettura): versamenti, documenti che non risultano, delibere. */
export const getOwnerReview = (db: Db, today = todayInItaly(), includeArchived = false) =>
  ownerReview.getOwnerReview(
    readDeps(db),
    {
      policyAssetIds: async () => new Set((await listPolicies(db, false, today)).filter((p) => p.state !== "expired").flatMap((p) => p.assets.map((a) => a.id))),
    },
    today,
    includeArchived,
  );
export const filterResolutions = ownerReview.filterRegister;
export const statementCsv = ownerReview.statementCsv;
export const deliveriesCsv = ownerReview.deliveriesCsv;
export const resolutionsCsv = ownerReview.resolutionsCsv;
export const listAssetsWithoutCondominium = (db: Db) => useCases.listAssetsWithoutCondominium(readDeps(db));
