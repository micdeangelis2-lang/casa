/**
 * Interfaccia pubblica del modulo Locazioni e ricettivita': dopo che il proprietario sceglie il tipo reale registra contratto,
 * persone (dalla rubrica), calendario dei canoni, codici identificativi e adempimenti periodici. I requisiti per territorio
 * non sono scritti qui: stanno nelle regole (il tipo di attivita' in corso e' un «fatto» del bene). L'app non dice mai che
 * un'attivita' si puo' avviare o che e' in regola. Scritture: `UnitOfWork`; letture: `Db`.
 */
import type { UnitOfWork } from "@/platform/db/unit-of-work";
import type { Db } from "@/platform/db/types";
import { todayInItaly } from "@/platform/clock";
import { listAssets } from "@/modules/assets";
import { completeOpenOccurrences, createDeadline, getDeadlineDetail, reopenOccurrence, setDeadlineArchived } from "@/modules/deadlines";
import { listParties } from "@/modules/directory";
import { documentTitles as readDocumentTitles } from "@/modules/documents";
import type { LettingCollaborators } from "./application/ports";
import * as useCases from "./application/use-cases";
import { drizzleLettingRepository } from "./infrastructure/drizzle-letting-repository";

export { LETTING_PARTY_ROLES, LETTING_STATUSES, LETTING_TYPES, REPORT_KINDS, isContractType, type LettingPartyRole, type LettingStatus, type LettingType, type ReportKind } from "./domain/lettings";
export type { LettingDetail, LettingItem } from "./application/use-cases";
export { todayInItaly };

function collaborators(db: Db, uow?: UnitOfWork): LettingCollaborators {
  return {
    assets: async () => (await listAssets(db)).map((a) => ({ id: a.id, name: a.name })),
    parties: async () => new Map((await listParties(db, { includeArchived: true })).map((p) => [p.id, p.displayName])),
    documentTitles: () => readDocumentTitles(db),
    async createDeadline(d) {
      if (!uow) throw new Error("Per creare una scadenza serve un'unita' di lavoro");
      const result = await createDeadline(uow, { title: d.title, category: d.category, level: "contract", assetId: d.assetId, calc: { type: "manual" }, firstDueOn: d.dueOn, priority: "normal", proofRequired: d.proofRequired });
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
    async reopenDeadline(deadlineId) {
      if (!uow) throw new Error("Per riaprire una scadenza serve un'unita' di lavoro");
      const detail = await getDeadlineDetail(db, deadlineId, todayInItaly());
      for (const occurrence of detail?.occurrences ?? []) if (occurrence.status === "done") await reopenOccurrence(uow, occurrence.id);
    },
  };
}

const writeDeps = (uow: UnitOfWork) => ({ repo: drizzleLettingRepository(uow.tx), others: collaborators(uow.tx, uow), audit: uow.audit });
const readDeps = (db: Db) => ({ repo: drizzleLettingRepository(db), others: collaborators(db) });

export const createLetting = (uow: UnitOfWork, input: unknown) => useCases.createLetting(writeDeps(uow), input);
export const updateLetting = (uow: UnitOfWork, id: string, input: unknown) => useCases.updateLetting(writeDeps(uow), id, input);
export const setLettingStatus = (uow: UnitOfWork, id: string, status: string, today = todayInItaly()) => useCases.setLettingStatus(writeDeps(uow), id, status, today);
export const addLettingParty = (uow: UnitOfWork, lettingId: string, input: unknown) => useCases.addLettingParty(writeDeps(uow), lettingId, input);
export const removeLettingParty = (uow: UnitOfWork, lettingId: string, partyId: string) => useCases.removeLettingParty(writeDeps(uow), lettingId, partyId);
export const generateRentSchedule = (uow: UnitOfWork, lettingId: string, input: unknown) => useCases.generateRentSchedule(writeDeps(uow), lettingId, input);
export const addRent = (uow: UnitOfWork, lettingId: string, input: unknown) => useCases.addRent(writeDeps(uow), lettingId, input);
export const recordRentPayment = (uow: UnitOfWork, rentId: string, input: unknown, today = todayInItaly()) => useCases.recordRentPayment(writeDeps(uow), rentId, input, today);
export const addRentReceipt = (uow: UnitOfWork, rentId: string, input: unknown, today = todayInItaly()) => useCases.addRentReceipt(writeDeps(uow), rentId, input, today);
export const removeRentReceipt = (uow: UnitOfWork, receiptId: string, today = todayInItaly()) => useCases.removeRentReceipt(writeDeps(uow), receiptId, today);
export const removeRent = (uow: UnitOfWork, rentId: string) => useCases.removeRent(writeDeps(uow), rentId);
export const addCode = (uow: UnitOfWork, lettingId: string, input: unknown) => useCases.addCode(writeDeps(uow), lettingId, input);
export const removeCode = (uow: UnitOfWork, codeId: string) => useCases.removeCode(writeDeps(uow), codeId);
export const addReport = (uow: UnitOfWork, lettingId: string, input: unknown) => useCases.addReport(writeDeps(uow), lettingId, input);
export const markReportDone = (uow: UnitOfWork, reportId: string, input: unknown) => useCases.markReportDone(writeDeps(uow), reportId, input);
export const reopenReport = (uow: UnitOfWork, reportId: string) => useCases.reopenReport(writeDeps(uow), reportId);
export const removeReport = (uow: UnitOfWork, reportId: string) => useCases.removeReport(writeDeps(uow), reportId);

/** Canoni incassati in un periodo (per il quadro economico). */
export const lettingLedger = (db: Db, from: string, to: string) => useCases.rentLedger(readDeps(db), from, to);
export const listLettings = (db: Db, filter: { assetId?: string; status?: string; includeEnded?: boolean } = {}, today = todayInItaly()) => useCases.listLettings(readDeps(db), filter, today);
export const getLettingDetail = (db: Db, id: string, today = todayInItaly()) => useCases.getLettingDetail(readDeps(db), id, today);
export const activeLettingTypes = (db: Db, assetId: string) => useCases.activeLettingTypes(readDeps(db), assetId);
