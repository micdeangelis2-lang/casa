/**
 * Interfaccia pubblica del modulo Tecnico: la «scheda per il tecnico» di un bene, costruita in sola lettura con i dati
 * degli altri moduli (beni, documenti, dossier, manutenzioni, scadenze, pratiche). Nessuno schema proprio, nessuna scrittura,
 * nessuna riga di audit. Non esprime giudizi di conformita': elenca cio' che risulta dai dati registrati.
 */
import type { Db } from "@/platform/db/types";
import { getAssetDetail } from "@/modules/assets";
import { listOccurrences } from "@/modules/deadlines";
import { listDocumentCategories, listDocuments } from "@/modules/documents";
import { getDossier } from "@/modules/dossier";
import { listInspectionPlans, listWarranties, listWorks } from "@/modules/maintenance";
import { getMatterDetail, listMatters } from "@/modules/matters";
import { todayInItaly } from "@/platform/clock";
import type { BriefSource } from "./domain/brief";
import * as useCases from "./application/use-cases";

export {
  
  
  
  briefCsv,
  workDate,
  type BriefCsvLabels,
  type TechnicalBrief,
} from "./domain/brief";

function collaborators(db: Db, today: string): useCases.TechnicalCollaborators {
  return {
    async source(assetId): Promise<BriefSource | null> {
      const asset = await getAssetDetail(db, assetId);
      if (!asset) return null;
      const [categories, documents, dossier, works, warranties, plans, occurrences, matters] = await Promise.all([
        listDocumentCategories(db),
        listDocuments(db, { assetId }),
        getDossier(db, assetId, today),
        listWorks(db, { assetId, includeClosed: true }),
        listWarranties(db, { assetId }, today),
        listInspectionPlans(db, { assetId }),
        listOccurrences(db, "open", { assetId }, today),
        listMatters(db, { assetId }),
      ]);
      const matterDetails = (await Promise.all(matters.map((m) => getMatterDetail(db, m.id)))).flatMap((m) => (m ? [m] : []));
      return {
        asset: {
          id: asset.id,
          name: asset.name,
          kind: asset.kind,
          useType: asset.useType,
          territoryLabel: asset.territoryLabel,
          locality: asset.locality,
          address: asset.address,
          postalCode: asset.postalCode,
          inCondominium: asset.inCondominium,
          notes: asset.notes,
          attributes: asset.attributes,
          cadastral: asset.cadastral,
          rights: asset.rights.map((r) => ({ holderName: r.holder.displayName, rightType: r.rightType, quotaNumerator: r.quotaNumerator, quotaDenominator: r.quotaDenominator, validFrom: r.validFrom, validTo: r.validTo })),
        },
        categories,
        documents: documents.map((d) => ({ id: d.id, title: d.title, categoryId: d.categoryId, categoryName: d.categoryName, issuedOn: d.issuedOn, validTo: d.validTo, verificationStatus: d.verificationStatus })),
        dossierItems: (dossier?.categories ?? []).flatMap(({ category, items }) =>
          items.map((i) => ({ id: i.id, title: i.title, status: i.status, stale: i.stale, categoryCode: category.code, categoryName: category.name, documentCount: i.documents.length, expiredDocumentCount: i.documents.filter((d) => d.expired).length })),
        ),
        works: works.map((w) => ({ id: w.id, title: w.title, status: w.status, supplierName: w.supplierName, scheduledOn: w.scheduledOn, startedOn: w.startedOn, completedOn: w.completedOn, budgetCents: w.budgetCents, acceptedQuotesCents: w.acceptedQuotesCents, invoicedCents: w.invoicedCents, paidCents: w.paidCents, lastPercent: w.lastPercent })),
        warranties: warranties.map((w) => ({ id: w.id, title: w.title, startsOn: w.startsOn, endsOn: w.endsOn, state: w.state, supplierName: w.supplierName, workTitle: w.workTitle })),
        plans: plans.map((p) => ({ id: p.id, title: p.title, intervalMonths: p.intervalMonths, nextDueOn: p.nextDueOn, lastDoneOn: p.lastDoneOn, supplierName: p.supplierName })),
        deadlines: occurrences.filter((o) => !o.archived).map((o) => ({ id: o.id, title: o.title, dueOn: o.dueOn, overdue: o.overdue })),
        matters: matterDetails.map((m) => ({
          id: m.id,
          title: m.title,
          status: m.status,
          openedOn: m.openedOn,
          assignees: m.assignments.map((a) => a.name),
          openRequests: m.requests.filter((r) => r.status === "requested").map((r) => ({ title: r.title, dueOn: r.dueOn, overdue: r.dueOn !== null && r.dueOn < today })),
        })),
      };
    },
  };
}

export const getTechnicalBrief = (db: Db, assetId: string, today = todayInItaly()) => useCases.getTechnicalBrief({ others: collaborators(db, today) }, assetId, today);
