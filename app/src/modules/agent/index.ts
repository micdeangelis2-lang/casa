/**
 * Interfaccia pubblica del modulo «Agente»: la scheda di presentazione di un immobile per l'agente immobiliare (vendita o
 * locazione), ricavata dai dati gia' registrati, e i mandati di vendita o affitto con le visite e le proposte che il proprietario
 * registra (`listing_engagement`, `listing_event`). Nessuna stima, nessun verdetto. Le scritture ricevono una `UnitOfWork`.
 */
import type { UnitOfWork } from "@/platform/db/unit-of-work";
import type { Db } from "@/platform/db/types";
import { todayInItaly } from "@/platform/clock";
import { getAssetDetail } from "@/modules/assets";
import { getCondominiumDetail, listCondominiums } from "@/modules/condominium";
import { listOccurrences } from "@/modules/deadlines";
import { listParties } from "@/modules/directory";
import { documentTitles as readDocumentTitles, listDocumentCategories, listDocuments } from "@/modules/documents";
import { getDossier } from "@/modules/dossier";
import { listLettings } from "@/modules/lettings";
import { listWorks } from "@/modules/maintenance";
import { listMatters } from "@/modules/matters";
import type { ListingCollaborators } from "./application/ports";
import * as listingCases from "./application/listing-cases";
import { drizzleListingRepository } from "./infrastructure/drizzle-listing-repository";
import { buildDocumentSection, ordinaryExpenses, recentWorks, type Level } from "./domain/sheet";

export { agentPackageHref, type ChecklistItem, type Level } from "./domain/sheet";

export { LISTING_EVENT_KINDS, LISTING_KINDS, LISTING_OUTCOMES, type ListingEventKind, type ListingKind, type ListingOutcome, type ListingStatus } from "./domain/listing";
export type { EngagementItem, ListingEventItem } from "./application/listing-cases";

function listingCollaborators(db: Db): ListingCollaborators {
  return {
    assetExists: async (assetId) => (await getAssetDetail(db, assetId)) !== null,
    partyNames: async () => new Map((await listParties(db, { includeArchived: true })).map((p) => [p.id, p.displayName])),
    documentTitles: (ids) => readDocumentTitles(db, ids),
  };
}
const listingWriteDeps = (uow: UnitOfWork) => ({ repo: drizzleListingRepository(uow.tx), others: listingCollaborators(uow.tx), audit: uow.audit });

export const addEngagement = (uow: UnitOfWork, input: unknown) => listingCases.addEngagement(listingWriteDeps(uow), input);
export const updateEngagement = (uow: UnitOfWork, id: string, input: unknown) => listingCases.updateEngagement(listingWriteDeps(uow), id, input);
export const setEngagementStatus = (uow: UnitOfWork, id: string, status: string) => listingCases.setEngagementStatus(listingWriteDeps(uow), id, status);
export const removeEngagement = (uow: UnitOfWork, id: string) => listingCases.removeEngagement(listingWriteDeps(uow), id);
export const addListingEvent = (uow: UnitOfWork, engagementId: string, input: unknown) => listingCases.addListingEvent(listingWriteDeps(uow), engagementId, input);
export const updateListingEvent = (uow: UnitOfWork, eventId: string, input: unknown) => listingCases.updateListingEvent(listingWriteDeps(uow), eventId, input);
export const removeListingEvent = (uow: UnitOfWork, eventId: string) => listingCases.removeListingEvent(listingWriteDeps(uow), eventId);
/** I mandati di vendita o affitto di un immobile, con visite e proposte registrate. */
export const listEngagements = (db: Db, assetId: string) => listingCases.listEngagements({ repo: drizzleListingRepository(db), others: listingCollaborators(db) }, assetId);

export type AgentSheetOptions = { cap?: Level; focusCategoryIds?: string[] | null; includeRights?: boolean; today?: string };

/** Compone la scheda; null se l'immobile non esiste. I nomi di titolari si includono solo con `includeRights`; quelli degli inquilini mai. */
export async function getAgentSheet(db: Db, assetId: string, opts: AgentSheetOptions = {}) {
  const today = opts.today ?? todayInItaly();
  const cap = opts.cap ?? "ordinary";
  const asset = await getAssetDetail(db, assetId);
  if (!asset) return null;

  const [documents, categories, dossier, works, lettings, condoList, matters, occurrences] = await Promise.all([
    listDocuments(db, { assetId }),
    listDocumentCategories(db),
    getDossier(db, assetId, today),
    listWorks(db, { assetId, includeClosed: true }),
    listLettings(db, { assetId }, today),
    listCondominiums(db),
    listMatters(db, { assetId, includeClosed: true }),
    listOccurrences(db, "upcoming", { assetId }, today, { windowDays: 365 }),
  ]);

  let condominium: { id: string; name: string; administratorName: string | null; unitLabel: string | null; expenses: ReturnType<typeof ordinaryExpenses> } | null = null;
  for (const c of condoList) {
    const detail = await getCondominiumDetail(db, c.id);
    const member = detail?.members.find((m) => m.assetId === assetId);
    if (detail && member) {
      condominium = { id: detail.id, name: detail.name, administratorName: detail.administratorName, unitLabel: member.unitLabel, expenses: ordinaryExpenses(detail.years, assetId) };
      break;
    }
  }

  const section = buildDocumentSection({
    documents: documents.map((d) => ({ id: d.id, title: d.title, categoryId: d.categoryId, confidentiality: d.confidentiality, issuedOn: d.issuedOn, validTo: d.validTo, verificationStatus: d.verificationStatus })),
    categories: categories.map((c) => ({ id: c.id, name: c.name })),
    cap,
    focusCategoryIds: opts.focusCategoryIds ?? null,
    dossier: (dossier?.categories ?? []).flatMap((c) => c.items.map((i) => ({ title: i.title, status: i.status }))),
    today,
  });

  return {
    today,
    cap,
    asset: { ...asset, rights: opts.includeRights ? asset.rights : [] },
    rightsHidden: !opts.includeRights && asset.rights.length > 0,
    condominium,
    works: recentWorks(works.map((w) => ({ id: w.id, title: w.title, status: w.status, scheduledOn: w.scheduledOn, startedOn: w.startedOn, completedOn: w.completedOn, supplierName: w.supplierName }))),
    lettings: lettings.map((l) => ({ id: l.id, title: l.title, type: l.type, status: l.status, startsOn: l.startsOn, endsOn: l.endsOn, monthlyRentCents: l.monthlyRentCents })),
    documents: section,
    /** Solo per il proprietario (non va nella stampa): pratiche collegate e prossime scadenze del bene. */
    tracking: {
      matters: matters.map((m) => ({ id: m.id, title: m.title, status: m.status, openedOn: m.openedOn, assignees: m.assignees })),
      deadlines: occurrences.map((o) => ({ id: o.deadlineId, title: o.title, dueOn: o.dueOn })),
    },
  };
}
