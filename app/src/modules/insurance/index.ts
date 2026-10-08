/**
 * Interfaccia pubblica del modulo Assicurazioni: polizze con garanzie copiate a mano, premi, sinistri e comunicazioni.
 * L'app registra e ricorda: non interpreta le condizioni di polizza e non stabilisce se un sinistro sia coperto o quanto
 * verra' liquidato. Scritture: `UnitOfWork`; letture: `Db`.
 */
import type { UnitOfWork } from "@/platform/db/unit-of-work";
import type { Db } from "@/platform/db/types";
import { todayInItaly } from "@/platform/clock";
import { getAssetDetail, listAssets } from "@/modules/assets";
import { listWorks } from "@/modules/maintenance";
import { completeOpenOccurrences, createDeadline, setDeadlineArchived } from "@/modules/deadlines";
import { listParties } from "@/modules/directory";
import { documentTitles as readDocumentTitles, listDocuments } from "@/modules/documents";
import { listMatters } from "@/modules/matters";
import type { InsuranceCollaborators } from "./application/ports";
import * as useCases from "./application/use-cases";
import * as assicuratore from "./application/assicuratore-reads";
import type { ClaimSheetCollaborators } from "./application/assicuratore-reads";
import { drizzleInsuranceRepository } from "./infrastructure/drizzle-insurance-repository";

export { CLAIM_DOCUMENT_ROLES, CLAIM_STATUSES, ENTRY_DIRECTIONS, type ClaimDocumentRole, type ClaimStatus, type EntryDirection } from "./domain/insurance";
export type { ClaimDetail, ClaimItem, PolicyDetail, PolicyItem } from "./application/use-cases";
export type { ClaimSheet, PoliciesByAsset } from "./application/assicuratore-reads";
export { type AssetPolicyRow, type AssetPolicyStatus, type OverviewPolicy, type SheetCheck, type SheetCheckKey } from "./domain/assicuratore-overview";
export { todayInItaly };

/** Dati degli altri moduli per la scheda sinistro (sola lettura). */
function sheetCollaborators(db: Db): ClaimSheetCollaborators {
  return {
    async asset(id) {
      const a = await getAssetDetail(db, id);
      if (!a) return null;
      const today = todayInItaly();
      return {
        id: a.id,
        name: a.name,
        kindKey: a.kind,
        declaredValueCents: a.declaredValueCents,
        address: a.address,
        locality: a.locality,
        territoryLabel: a.territoryLabel,
        postalCode: a.postalCode,
        useKey: a.useType,
        attributes: Object.entries(a.attributes).map(([key, value]) => ({ key, value })),
        cadastral: a.cadastral.filter((c) => !c.validTo || c.validTo >= today).map((c) => ({ sheet: c.sheet, parcel: c.parcel, subunit: c.subunit, category: c.cadastralCategory, consistency: c.consistency })),
        holders: a.rights.filter((r) => !r.validTo || r.validTo >= today).map((r) => ({ name: r.holder.displayName, rightKey: r.rightType, quota: `${r.quotaNumerator}/${r.quotaDenominator}` })),
      };
    },
    async worksOf(assetId) {
      return (await listWorks(db, { assetId, includeClosed: true })).map((w) => ({ id: w.id, title: w.title, status: w.status, completedOn: w.completedOn, startedOn: w.startedOn, scheduledOn: w.scheduledOn, supplierName: w.supplierName, acceptedQuotesCents: w.acceptedQuotesCents, invoicedCents: w.invoicedCents, paidCents: w.paidCents }));
    },
    async documentsOf(assetId) {
      return (await listDocuments(db, { assetId })).map((d) => ({ id: d.id, title: d.title, categoryName: d.categoryName, issuedOn: d.issuedOn }));
    },
  };
}

function collaborators(db: Db, uow?: UnitOfWork): InsuranceCollaborators {
  return {
    assets: async () => (await listAssets(db)).map((a) => ({ id: a.id, name: a.name, declaredValueCents: a.declaredValueCents })),
    parties: async () => new Map((await listParties(db, { includeArchived: true })).map((p) => [p.id, p.displayName])),
    documentTitles: () => readDocumentTitles(db),
    matterTitles: async () => new Map((await listMatters(db, { includeClosed: true })).map((m) => [m.id, m.title])),
    async createDeadline(d) {
      if (!uow) throw new Error("Per creare una scadenza serve un'unita' di lavoro");
      const result = await createDeadline(uow, { title: d.title, category: "insurance", level: "contract", assetId: d.assetId, calc: { type: "manual" }, firstDueOn: d.dueOn, priority: "normal", proofRequired: d.proofRequired });
      return result.ok ? result.value.id : null;
    },
    async archiveDeadline(deadlineId, archived) {
      if (!uow) throw new Error("Per archiviare una scadenza serve un'unita' di lavoro");
      await setDeadlineArchived(uow, deadlineId, archived);
    },
    async completeDeadline(deadlineId, d) {
      if (!uow) throw new Error("Per chiudere una scadenza serve un'unita' di lavoro");
      await completeOpenOccurrences(uow, deadlineId, d);
    },
  };
}

const writeDeps = (uow: UnitOfWork) => ({ repo: drizzleInsuranceRepository(uow.tx), others: collaborators(uow.tx, uow), audit: uow.audit });
const readDeps = (db: Db) => ({ repo: drizzleInsuranceRepository(db), others: collaborators(db) });

export const createPolicy = (uow: UnitOfWork, input: unknown) => useCases.createPolicy(writeDeps(uow), input);
/** Convalida a secco di una polizza (stesse regole di `createPolicy`, nessuna scrittura). */
export const validatePolicyInput = (input: unknown) => useCases.validatePolicy(input);
export const updatePolicy = (uow: UnitOfWork, id: string, input: unknown) => useCases.updatePolicy(writeDeps(uow), id, input);
export const setPolicyArchived = (uow: UnitOfWork, id: string, archived: boolean) => useCases.setPolicyArchived(writeDeps(uow), id, archived);
export const createPolicyDeadline = (uow: UnitOfWork, id: string) => useCases.createPolicyDeadline(writeDeps(uow), id);
export const addCoverage = (uow: UnitOfWork, policyId: string, input: unknown) => useCases.addCoverage(writeDeps(uow), policyId, input);
export const removeCoverage = (uow: UnitOfWork, coverageId: string) => useCases.removeCoverage(writeDeps(uow), coverageId);
export const addPremium = (uow: UnitOfWork, policyId: string, input: unknown) => useCases.addPremium(writeDeps(uow), policyId, input);
export const setPremiumPaid = (uow: UnitOfWork, premiumId: string, input: unknown) => useCases.setPremiumPaid(writeDeps(uow), premiumId, input);
export const removePremium = (uow: UnitOfWork, premiumId: string) => useCases.removePremium(writeDeps(uow), premiumId);
export const createClaim = (uow: UnitOfWork, input: unknown, today = todayInItaly()) => useCases.createClaim(writeDeps(uow), input, today);
export const updateClaim = (uow: UnitOfWork, id: string, input: unknown, today = todayInItaly()) => useCases.updateClaim(writeDeps(uow), id, input, today);
export const setClaimStatus = (uow: UnitOfWork, id: string, status: string, today = todayInItaly()) => useCases.setClaimStatus(writeDeps(uow), id, status, today);
export const addClaimEntry = (uow: UnitOfWork, claimId: string, input: unknown, today = todayInItaly()) => useCases.addClaimEntry(writeDeps(uow), claimId, input, today);
export const addClaimDocument = (uow: UnitOfWork, claimId: string, input: unknown) => useCases.addClaimDocument(writeDeps(uow), claimId, input);
export const removeClaimDocument = (uow: UnitOfWork, claimId: string, documentId: string) => useCases.removeClaimDocument(writeDeps(uow), claimId, documentId);
export const removeClaimEntry = (uow: UnitOfWork, entryId: string) => useCases.removeClaimEntry(writeDeps(uow), entryId);

/** Premi pagati in un periodo (per il quadro economico). */
export const insuranceLedger = (db: Db, from: string, to: string) => useCases.premiumLedger(readDeps(db), from, to);
export const listPolicies = (db: Db, includeArchived = false, today = todayInItaly()) => useCases.listPolicies(readDeps(db), includeArchived, today);
export const getPolicyDetail = (db: Db, id: string, today = todayInItaly()) => useCases.getPolicyDetail(readDeps(db), id, today);
export const listClaims = (db: Db, filter: { policyId?: string; includeClosed?: boolean } = {}) => useCases.listClaims(readDeps(db), filter);
export const getClaimDetail = (db: Db, id: string) => useCases.getClaimDetail(readDeps(db), id);

/** Per ogni bene le polizze registrate (con garanzie copiate a mano) e i beni senza polizza registrata. */
export const policiesByAsset = (db: Db, today = todayInItaly()) => assicuratore.policiesByAsset(readDeps(db), today);
/** Scheda del sinistro per il perito: bene, polizza, storico, lavori, documenti e cronologia, dai soli dati registrati. */
export const getClaimSheet = (db: Db, claimId: string, today = todayInItaly()) => assicuratore.getClaimSheet(readDeps(db), sheetCollaborators(db), claimId, today);
