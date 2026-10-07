/**
 * Interfaccia pubblica del modulo «Notaio»: la scheda dell'immobile per il notaio, ricavata dai dati gia' registrati
 * (beni, rubrica, documenti, dossier) piu' la provenienza e i gravami che il proprietario scrive (`asset_provenance`,
 * `asset_encumbrance`: dati suoi, non letti da registri). Segnala i dati che non risultano; non dice se un atto sia possibile
 * ne' se il bene sia regolare. Le scritture ricevono una `UnitOfWork`, le letture un `Db`.
 */
import type { UnitOfWork } from "@/platform/db/unit-of-work";
import type { Db } from "@/platform/db/types";
import { todayInItaly } from "@/platform/clock";
import { getAssetDetail } from "@/modules/assets";
import { getParty, listParties } from "@/modules/directory";
import { documentTitles as readDocumentTitles, listDocumentCategories, listDocuments } from "@/modules/documents";
import { getDossier } from "@/modules/dossier";
import type { NotaryCollaborators } from "./application/ports";
import * as useCases from "./application/use-cases";
import { drizzleNotaryRepository } from "./infrastructure/drizzle-notary-repository";
import { buildNotarySheet, type NotarySheet, type SheetParty, type SheetRelatedInput } from "./domain/sheet";

export { notaryPackageHref, buildNotarySheet, sumQuotas, mentionsEncumbrance, type Gap, type GapCode, type NotarySheet, type SheetInput } from "./domain/sheet";
export { ENCUMBRANCE_KINDS, PROVENANCE_KINDS, type EncumbranceKind, type ProvenanceKind } from "./domain/records";
export type { EncumbranceItem, ProvenanceItem } from "./application/use-cases";

function collaborators(db: Db): NotaryCollaborators {
  return {
    assetExists: async (assetId) => (await getAssetDetail(db, assetId)) !== null,
    partyNames: async () => new Map((await listParties(db, { includeArchived: true })).map((p) => [p.id, p.displayName])),
    documentTitles: (ids) => readDocumentTitles(db, ids),
  };
}

const writeDeps = (uow: UnitOfWork) => ({ repo: drizzleNotaryRepository(uow.tx), others: collaborators(uow.tx), audit: uow.audit });
const readDeps = (db: Db) => ({ repo: drizzleNotaryRepository(db), others: collaborators(db) });

export const addProvenance = (uow: UnitOfWork, input: unknown) => useCases.addProvenance(writeDeps(uow), input);
export const updateProvenance = (uow: UnitOfWork, provenanceId: string, input: unknown) => useCases.updateProvenance(writeDeps(uow), provenanceId, input);
export const removeProvenance = (uow: UnitOfWork, provenanceId: string) => useCases.removeProvenance(writeDeps(uow), provenanceId);
export const addEncumbrance = (uow: UnitOfWork, input: unknown) => useCases.addEncumbrance(writeDeps(uow), input);
export const updateEncumbrance = (uow: UnitOfWork, encumbranceId: string, input: unknown) => useCases.updateEncumbrance(writeDeps(uow), encumbranceId, input);
export const removeEncumbrance = (uow: UnitOfWork, encumbranceId: string) => useCases.removeEncumbrance(writeDeps(uow), encumbranceId);
export const listProvenances = (db: Db, assetId: string) => useCases.listProvenances(readDeps(db), assetId);
export const listEncumbrances = (db: Db, assetId: string) => useCases.listEncumbrances(readDeps(db), assetId);

const isCurrent = (validTo: string | null, today: string) => validTo === null || validTo >= today;

/** Compone la scheda di un immobile; null se non esiste. `focusCategoryIds` sceglie le categorie documentali da controllare. */
export async function getNotarySheet(db: Db, assetId: string, opts: { focusCategoryIds?: string[]; today?: string } = {}): Promise<NotarySheet | null> {
  const today = opts.today ?? todayInItaly();
  const asset = await getAssetDetail(db, assetId);
  if (!asset) return null;

  const [documents, categories, dossier, provenances, encumbranceRecords] = await Promise.all([listDocuments(db, { assetId }), listDocumentCategories(db), getDossier(db, assetId, today), listProvenances(db, assetId), listEncumbrances(db, assetId)]);

  const holderIds = [...new Set(asset.rights.map((r) => r.holder.id))];
  const parties: SheetParty[] = (await Promise.all(holderIds.map((id) => getParty(db, id)))).flatMap((p) =>
    p ? [{ id: p.id, displayName: p.displayName, taxCode: p.taxCode, address: p.address, pec: p.pec, email: p.email, phone: p.phone }] : [],
  );

  const links = [
    ...asset.linkedTo.map((l) => ({ ...l, direction: "linkedTo" as const })),
    ...asset.linkedFrom.map((l) => ({ ...l, direction: "linkedFrom" as const })),
  ];
  const related = (
    await Promise.all(
      links.map(async (l): Promise<SheetRelatedInput | null> => {
        const other = await getAssetDetail(db, l.asset.id);
        if (!other) return null;
        return {
          id: other.id,
          name: other.name,
          kind: other.kind,
          direction: l.direction,
          declaredBasis: l.declaredBasis,
          validationStatus: l.validationStatus,
          rightsCount: other.rights.length,
          currentCadastralCount: other.cadastral.filter((c) => isCurrent(c.validTo, today)).length,
        };
      }),
    )
  ).filter((r): r is SheetRelatedInput => r !== null);

  return buildNotarySheet({
    today,
    asset,
    parties,
    documents: documents.map((d) => ({ id: d.id, title: d.title, categoryId: d.categoryId, issuedOn: d.issuedOn, validTo: d.validTo, verificationStatus: d.verificationStatus })),
    categories: categories.map((c) => ({ id: c.id, code: c.code, name: c.name })),
    focusCategoryIds: opts.focusCategoryIds,
    dossierItems: (dossier?.categories ?? []).flatMap((c) => c.items.map((i) => ({ title: i.title, categoryName: c.category.name, status: i.status, documentCount: i.documents.length }))),
    related,
    provenances: provenances.map((p) => ({ id: p.id, kind: p.kind, occurredOn: p.occurredOn, fromName: p.fromName, notaryName: p.notaryName, deedReference: p.deedReference, documentId: p.documentId, documentTitle: p.documentTitle, note: p.note })),
    encumbranceRecords: encumbranceRecords.map((e) => ({ id: e.id, kind: e.kind, title: e.title, registeredOn: e.registeredOn, endedOn: e.endedOn, beneficiaryName: e.beneficiaryName, amountCents: e.amountCents, reference: e.reference, documentId: e.documentId, documentTitle: e.documentTitle, note: e.note })),
  });
}
