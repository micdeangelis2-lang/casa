/**
 * Interfaccia pubblica del modulo Tributi e pagamenti: tipi di tributo scritti dal proprietario, voci per bene e anno con
 * importo atteso (a mano), pagamenti con prova, dichiarazioni e riepilogo per il consulente. L'app registra e ricorda:
 * non contiene aliquote, non calcola cio' che e' dovuto e non dice mai che un tributo sia dovuto, non dovuto o corretto.
 * Scritture: `UnitOfWork`; letture: `Db`.
 */
import type { UnitOfWork } from "@/platform/db/unit-of-work";
import type { Db } from "@/platform/db/types";
import { todayInItaly } from "@/platform/clock";
import { listAssets } from "@/modules/assets";
import { completeOpenOccurrences, createDeadline, getDeadlineDetail, reopenOccurrence } from "@/modules/deadlines";
import { documentTitles as readDocumentTitles } from "@/modules/documents";
import type { TaxCollaborators } from "./application/ports";
import * as useCases from "./application/use-cases";
import { drizzleTaxRepository } from "./infrastructure/drizzle-tax-repository";

export { PAYMENT_KINDS, PAYMENT_METHODS, TAX_KINDS, summarize, type ObligationState, type PaymentKind, type PaymentMethod, type TaxKind } from "./domain/taxes";
export { summaryCsv } from "./application/summary-csv";
export type { AdviserSummary, ObligationDetail, ObligationItem, ReturnItem, TaxTypeItem } from "./application/use-cases";
export { todayInItaly };

function collaborators(db: Db, uow?: UnitOfWork): TaxCollaborators {
  return {
    assets: async () => (await listAssets(db)).map((a) => ({ id: a.id, name: a.name, territoryId: a.territoryId, territoryLabel: a.territoryLabel })),
    documentTitles: () => readDocumentTitles(db),
    async createDeadline(d) {
      if (!uow) throw new Error("Per creare una scadenza serve un'unita' di lavoro");
      const result = await createDeadline(uow, {
        title: d.title,
        category: "fiscal",
        level: "national",
        assetId: d.assetId,
        calc: { type: "manual" },
        firstDueOn: d.dueOn,
        priority: "normal",
        proofRequired: d.proofRequired,
      });
      return result.ok ? result.value.id : null;
    },
    async completeDeadline(deadlineId, d) {
      if (!uow) throw new Error("Per chiudere una scadenza serve un'unita' di lavoro");
      await completeOpenOccurrences(uow, deadlineId, d);
    },
    async reopenDeadline(deadlineId) {
      if (!uow) throw new Error("Per riaprire una scadenza serve un'unita' di lavoro");
      const detail = await getDeadlineDetail(db, deadlineId, todayInItaly());
      for (const occurrence of detail?.occurrences ?? []) if (occurrence.status === "done") await reopenOccurrence(uow, occurrence.id);
    },
  };
}

const writeDeps = (uow: UnitOfWork) => ({ repo: drizzleTaxRepository(uow.tx), others: collaborators(uow.tx, uow), audit: uow.audit });
const readDeps = (db: Db) => ({ repo: drizzleTaxRepository(db), others: collaborators(db) });

export const createTaxType = (uow: UnitOfWork, input: unknown) => useCases.createTaxType(writeDeps(uow), input);
export const updateTaxType = (uow: UnitOfWork, id: string, input: unknown) => useCases.updateTaxType(writeDeps(uow), id, input);
export const setTaxTypeArchived = (uow: UnitOfWork, id: string, archived: boolean) => useCases.setTaxTypeArchived(writeDeps(uow), id, archived);
export const createObligation = (uow: UnitOfWork, input: unknown) => useCases.createObligation(writeDeps(uow), input);
/** Convalida a secco di una voce / di un pagamento (stesse regole di `createObligation` e `recordPayment`, nessuna scrittura). */
export const validateObligationInput = (input: unknown) => useCases.validateObligation(input);
export const validateTaxPaymentInput = (input: unknown) => useCases.validatePayment(input);
export const updateObligation = (uow: UnitOfWork, id: string, input: unknown) => useCases.updateObligation(writeDeps(uow), id, input);
export const createObligationDeadline = (uow: UnitOfWork, id: string) => useCases.createObligationDeadline(writeDeps(uow), id);
export const closeObligation = (uow: UnitOfWork, id: string, input: unknown, today = todayInItaly()) => useCases.closeObligation(writeDeps(uow), id, input, today);
export const reopenObligation = (uow: UnitOfWork, id: string) => useCases.reopenObligation(writeDeps(uow), id);
export const recordPayment = (uow: UnitOfWork, obligationId: string, input: unknown) => useCases.recordPayment(writeDeps(uow), obligationId, input);
export const removePayment = (uow: UnitOfWork, paymentId: string) => useCases.removePayment(writeDeps(uow), paymentId);
export const createReturn = (uow: UnitOfWork, input: unknown) => useCases.createReturn(writeDeps(uow), input);
export const updateReturn = (uow: UnitOfWork, id: string, input: unknown) => useCases.updateReturn(writeDeps(uow), id, input);

/** Pagamenti di tributi registrati in un periodo (per il quadro economico). */
export const taxLedger = (db: Db, from: string, to: string) => useCases.paymentLedger(readDeps(db), from, to);
export const listTaxTypes = (db: Db, includeArchived = false) => useCases.listTaxTypes(readDeps(db), includeArchived);
export const territoryChoices = (db: Db) => useCases.territoryChoices(readDeps(db));
export const listObligations = (db: Db, filter: { year?: number; assetId?: string; taxTypeId?: string } = {}, today = todayInItaly()) => useCases.listObligations(readDeps(db), filter, today);
export const getObligationDetail = (db: Db, id: string, today = todayInItaly()) => useCases.getObligationDetail(readDeps(db), id, today);
export const listReturns = (db: Db, filter: { year?: number; assetId?: string } = {}, today = todayInItaly()) => useCases.listReturns(readDeps(db), filter, today);
export const yearsWithData = (db: Db) => useCases.yearsWithData(readDeps(db));
export const adviserSummary = (db: Db, year: number, today = todayInItaly()) => useCases.adviserSummary(readDeps(db), year, today);
