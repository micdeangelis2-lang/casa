/**
 * Interfaccia pubblica del modulo Condivisione: pacchetti documentali per un destinatario (ZIP generato a flusso con indice,
 * manifest, elenco CSV ed eventuale scheda in HTML), tetto di riservatezza con avviso, registro delle condivisioni e storia per documento.
 * Le scritture ricevono una `UnitOfWork`, le letture un `Db`.
 */
import type { UnitOfWork } from "@/platform/db/unit-of-work";
import type { Db } from "@/platform/db/types";
import { getStorage, type StoragePort } from "@/platform/storage";
import { getDocumentDetail, listDocuments, openDocumentFile, type Confidentiality } from "@/modules/documents";
import type { CandidateDocument, DocumentForPackage, SharingCollaborators } from "./application/ports";
import * as useCases from "./application/use-cases";
import type { IndexLabels } from "./domain/sharing";
import { drizzleSharingRepository } from "./infrastructure/drizzle-sharing-repository";

export { CONFIDENTIALITY_LEVELS, RECIPIENT_TYPES, type ConfidentialityLevel, type IndexLabels, type RecipientType } from "./domain/sharing";
export { SHEET_KINDS, SHEET_PATH, type SheetKind } from "./domain/sheet";
export type { Candidate, PackageDetail, PackageDownload, PackageListItem, SheetInput } from "./application/use-cases";

function collaborators(db: Db, storage: StoragePort = getStorage()): SharingCollaborators {
  const toCandidate = async (id: string): Promise<DocumentForPackage | null> => {
    const detail = await getDocumentDetail(db, id);
    const current = detail?.versions[0];
    if (!detail || !current) return null;
    return {
      id: detail.id,
      title: detail.title,
      categoryId: detail.categoryId,
      categoryName: detail.categoryName,
      confidentiality: detail.confidentiality as Confidentiality,
      assetIds: detail.assets.map((a) => a.id),
      assetNames: detail.assets.map((a) => a.name),
      sizeBytes: current.sizeBytes,
      filename: current.originalFilename,
      archived: detail.archived,
      currentVersionId: current.id,
      mimeType: current.mimeType,
      sha256: current.sha256,
      issuerName: current.issuerName,
      issuedOn: current.issuedOn,
      validFrom: current.validFrom,
      validTo: current.validTo,
      verificationStatus: current.verificationStatus,
    };
  };

  return {
    async candidates(filter) {
      // Un documento e' candidato se riguarda almeno uno dei beni scelti (o se non si sceglie nessun bene) e sta nelle categorie scelte.
      const summaries = new Map<string, { id: string; categoryId: string }>();
      const assetIds = filter.assetIds ?? [];
      if (assetIds.length === 0) for (const d of await listDocuments(db)) summaries.set(d.id, d);
      else for (const assetId of assetIds) for (const d of await listDocuments(db, { assetId })) summaries.set(d.id, d);
      const picked = [...summaries.values()].filter((d) => !filter.categoryIds || filter.categoryIds.length === 0 || filter.categoryIds.includes(d.categoryId));
      const detailed = await Promise.all(picked.map((d) => toCandidate(d.id)));
      return detailed.filter((d): d is DocumentForPackage => d !== null) satisfies CandidateDocument[];
    },
    async documents(ids) {
      return (await Promise.all(ids.map(toCandidate))).filter((d): d is DocumentForPackage => d !== null);
    },
    openFile: (documentId, versionId) => openDocumentFile(db, documentId, versionId, storage).then((f) => f?.stream ?? null),
  };
}

const writeDeps = (uow: UnitOfWork) => ({ repo: drizzleSharingRepository(uow.tx), others: collaborators(uow.tx), audit: uow.audit });
const readDeps = (db: Db) => ({ repo: drizzleSharingRepository(db), others: collaborators(db) });

/** `sheet`: la scheda in HTML (da un CSV dell'app) da includere nel pacchetto, gia' ricavata dai moduli di lettura e filtrata per il tetto di riservatezza. */
export const createPackage = (uow: UnitOfWork, input: unknown, now = new Date(), sheet?: useCases.SheetInput | null) => useCases.createPackage(writeDeps(uow), input, now, sheet);
export const revokePackage = (uow: UnitOfWork, id: string) => useCases.revokePackage(writeDeps(uow), id);
export const preparePackageDownload = (uow: UnitOfWork, id: string) => useCases.preparePackageDownload(writeDeps(uow), id);

export const packageStream = (db: Db, download: useCases.PackageDownload, labels: IndexLabels, storage?: StoragePort) =>
  useCases.packageStream({ repo: drizzleSharingRepository(db), others: collaborators(db, storage) }, download, labels);
export const candidateDocuments = (db: Db, filter: { assetIds?: string[]; categoryIds?: string[] }, cap: Parameters<typeof useCases.candidates>[2]) => useCases.candidates(readDeps(db), filter, cap);
export const listPackages = (db: Db) => useCases.listPackages(readDeps(db));
export const getPackageDetail = (db: Db, id: string) => useCases.getPackageDetail(readDeps(db), id);
export const documentSharingHistory = (db: Db, documentId: string) => useCases.documentSharingHistory(readDeps(db), documentId);
