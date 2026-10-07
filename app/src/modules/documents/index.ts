/**
 * Interfaccia pubblica del modulo Documenti: file con metadati, versioni, categorie a dati, collegamento ai beni,
 * ricerca (titolo, nome file, testo dei PDF) e avviso sui duplicati. Le scritture ricevono una `UnitOfWork`,
 * le letture un `Db`. I byte stanno nello `StoragePort`.
 */
import type { UnitOfWork } from "@/platform/db/unit-of-work";
import type { Db } from "@/platform/db/types";
import { getStorage, type StoragePort } from "@/platform/storage";
import { listAssets } from "@/modules/assets";
import { listParties } from "@/modules/directory";
import type { DocumentCollaborators, ListArgs } from "./application/ports";
import * as useCases from "./application/use-cases";
import { drizzleDocumentRepository } from "./infrastructure/drizzle-document-repository";
import { pdfTextExtractor } from "./infrastructure/pdf-text-extractor";

export {
  CONFIDENTIALITY,
  INLINE_MIME_TYPES,
  MAX_FILE_BYTES,
  VERIFICATION_STATUS,
  sniffFile,
  type Confidentiality,
  type DocumentCategoryView,
  type DocumentSummary,
  type VerificationStatus,
} from "./domain/document";
export type { DocumentDetailView, DocumentListItem, OpenedFile, UploadedFile } from "./application/use-cases";

/** Collega i moduli vicini: il modulo Documenti li usa solo attraverso queste funzioni. */
function collaborators(db: Db): DocumentCollaborators {
  return {
    assets: async () => (await listAssets(db, { includeArchived: true })).map((a) => ({ id: a.id, name: a.name })),
    parties: async () => (await listParties(db, { includeArchived: true })).map((p) => ({ id: p.id, name: p.displayName })),
  };
}

const writeDeps = (uow: UnitOfWork, storage: StoragePort) => ({
  repo: drizzleDocumentRepository(uow.tx),
  others: collaborators(uow.tx),
  storage,
  extractor: pdfTextExtractor,
  audit: uow.audit,
});

export const createDocument = (uow: UnitOfWork, input: unknown, file: useCases.UploadedFile | null, storage = getStorage()) =>
  useCases.createDocument(writeDeps(uow, storage), input, file);
export const addDocumentVersion = (
  uow: UnitOfWork,
  documentId: string,
  input: unknown,
  file: useCases.UploadedFile | null,
  storage = getStorage(),
) => useCases.addDocumentVersion(writeDeps(uow, storage), documentId, input, file);
export const updateDocument = (uow: UnitOfWork, id: string, input: unknown) =>
  useCases.updateDocument(writeDeps(uow, getStorage()), id, input);
export const setDocumentArchived = (uow: UnitOfWork, id: string, archived: boolean) =>
  useCases.setDocumentArchived(writeDeps(uow, getStorage()), id, archived);

const readDeps = (db: Db) => ({ repo: drizzleDocumentRepository(db), others: collaborators(db) });

export const listDocuments = (db: Db, args: ListArgs = {}) => useCases.listDocuments(readDeps(db), args);
export const countDocuments = (db: Db, args: ListArgs = {}) => useCases.countDocuments(readDeps(db), args);
export const documentTitles = (db: Db, ids?: string[]) => useCases.documentTitles(readDeps(db), ids);
/** Documenti per un menu a tendina: `{ value, label }` dei piu' recenti non archiviati (al massimo `PICKER_LIMIT`). */
export const listDocumentOptions = (db: Db, limit?: number) => useCases.documentOptions(readDeps(db), limit);
export const PICKER_LIMIT = useCases.PICKER_LIMIT;
/** Documenti che hanno gia' questo identico file (sha256): per avvisare prima di caricarlo di nuovo. */
export const findDocumentsWithSameFile = (db: Db, bytes: Uint8Array) => useCases.findDocumentsWithSameFile(readDeps(db), bytes);
export const getDocumentDetail = (db: Db, id: string) => useCases.getDocumentDetail(readDeps(db), id);
export const listDocumentCategories = (db: Db) => drizzleDocumentRepository(db).listCategories();
export const openDocumentFile = (db: Db, documentId: string, versionId: string, storage = getStorage()) =>
  useCases.openDocumentFile({ repo: drizzleDocumentRepository(db), storage }, documentId, versionId);
