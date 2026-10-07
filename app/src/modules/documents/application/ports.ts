import type { AuditRecorder } from "@/platform/audit";
import type { StoragePort } from "@/platform/storage";
import type {
  Confidentiality,
  DocumentCategoryView,
  DocumentDetail,
  DocumentSummary,
  VerificationStatus,
  VersionInput,
} from "../domain/document";

export type DocumentCore = {
  title: string;
  categoryId: string;
  confidentiality: Confidentiality;
  notes?: string;
};

export type NewFileObject = { storageKey: string; sha256: string; sizeBytes: number; mimeType: string };

export type NewVersion = VersionInput & {
  fileObjectId: string;
  originalFilename: string;
  extractedText: string | null;
};

export type ListArgs = {
  query?: string;
  assetId?: string;
  categoryId?: string;
  verificationStatus?: VerificationStatus;
  confidentiality?: Confidentiality;
  includeArchived?: boolean;
  /** Solo i documenti con questi identificativi. */
  ids?: string[];
  /** Paginazione: quanti documenti restituire e da quale posizione (l'ordine e' sempre dal piu' recente). */
  limit?: number;
  offset?: number;
};

export type StoredFile = {
  storageKey: string;
  mimeType: string;
  originalFilename: string;
  sizeBytes: number;
};

export type DuplicateMatch = { documentId: string; title: string; reason: "same_file" | "same_data" };

export interface DocumentRepository {
  listCategories(): Promise<DocumentCategoryView[]>;
  insertFileObject(file: NewFileObject): Promise<string>;
  insertDocument(core: DocumentCore): Promise<string>;
  updateDocument(id: string, core: DocumentCore): Promise<boolean>;
  /** Aggiunge una versione con il numero successivo. */
  insertVersion(documentId: string, version: NewVersion): Promise<{ id: string; versionNo: number }>;
  /** Aggiorna i metadati (non il file) di una versione. */
  updateVersion(versionId: string, version: VersionInput): Promise<void>;
  setAssets(documentId: string, assetIds: string[]): Promise<void>;
  getDetail(id: string): Promise<DocumentDetail | null>;
  list(args: ListArgs): Promise<DocumentSummary[]>;
  /** Quanti documenti corrispondono ai filtri (ignora la paginazione). */
  count(args: ListArgs): Promise<number>;
  /** Titoli di tutti i documenti (anche archiviati), o solo di quelli indicati: una lettura leggera, senza versioni. */
  titles(ids?: string[]): Promise<Map<string, string>>;
  /** Identificativo e titolo dei documenti non archiviati piu' recenti, per i menu a tendina. */
  options(limit: number): Promise<{ id: string; title: string }[]>;
  setArchived(id: string, archived: boolean): Promise<boolean>;
  findFile(documentId: string, versionId: string): Promise<StoredFile | null>;
  /** Documenti (anche archiviati) che hanno una versione con questo sha256: per avvisare prima di caricare un file gia' presente. */
  findBySha256(sha256: string): Promise<{ documentId: string; title: string }[]>;
  /** Altri documenti con lo stesso file (sha256) o la stessa terna titolo/emittente/data di emissione. */
  findDuplicates(documentId: string): Promise<DuplicateMatch[]>;
}

/** Estrae il testo incorporato in un file. Restituisce null se non e' possibile o non ce n'e'. */
export interface TextExtractor {
  extract(bytes: Uint8Array, mimeType: string): Promise<string | null>;
}

/** Cio' che il modulo si aspetta dagli altri moduli, fornito dal punto di composizione (index.ts). */
export interface DocumentCollaborators {
  assets(): Promise<{ id: string; name: string }[]>;
  parties(): Promise<{ id: string; name: string }[]>;
}

export type DocumentDeps = {
  repo: DocumentRepository;
  others: DocumentCollaborators;
  storage: StoragePort;
  extractor: TextExtractor;
  audit: AuditRecorder;
};

export type ReadDeps = Pick<DocumentDeps, "repo" | "others">;
