import type { AuditRecorder } from "@/platform/audit";
import type { ConfidentialityLevel, ManifestInput, RecipientType } from "../domain/sharing";

export type CandidateDocument = {
  id: string;
  title: string;
  categoryId: string;
  categoryName: string;
  confidentiality: ConfidentialityLevel;
  assetIds: string[];
  assetNames: string[];
  sizeBytes: number;
  filename: string;
};

/** Il documento con i dati della versione corrente, cio' che finisce in un pacchetto. */
export type DocumentForPackage = CandidateDocument & {
  archived: boolean;
  currentVersionId: string;
  mimeType: string;
  sha256: string;
  issuerName: string | null;
  issuedOn: string | null;
  validFrom: string | null;
  validTo: string | null;
  verificationStatus: string;
};

export type PackageRow = {
  id: string;
  recipientType: RecipientType;
  recipientName: string;
  confidentialityCap: ConfidentialityLevel;
  note: string | null;
  fileCount: number;
  totalBytes: number;
  manifestSha256: string;
  /** Cio' che e' stato condiviso, com'era in quel momento. */
  snapshot: ManifestInput;
  revoked: boolean;
  createdAt: Date;
};

export type PackageItemRow = { id: string; documentId: string; versionId: string; position: number; path: string; sha256: string; sizeBytes: number; confidentiality: ConfidentialityLevel; overrideAboveCap: boolean };
export type LogRow = { id: string; event: "created" | "downloaded" | "revoked"; at: Date };

export interface SharingRepository {
  insertPackage(data: Omit<PackageRow, "id" | "revoked" | "createdAt">): Promise<string>;
  insertItems(packageId: string, items: Omit<PackageItemRow, "id">[]): Promise<void>;
  log(packageId: string, event: LogRow["event"]): Promise<void>;
  getPackage(id: string): Promise<PackageRow | null>;
  items(packageId: string): Promise<PackageItemRow[]>;
  logs(packageId: string): Promise<LogRow[]>;
  listPackages(): Promise<(PackageRow & { downloads: number })[]>;
  revoke(id: string): Promise<boolean>;
  packagesForDocument(documentId: string): Promise<{ package: PackageRow; override: boolean }[]>;
}

export interface SharingCollaborators {
  /** Documenti non archiviati, con la riservatezza e i beni; filtrabili per immobile e categoria. */
  candidates(filter: { assetIds?: string[]; categoryIds?: string[] }): Promise<CandidateDocument[]>;
  documents(ids: string[]): Promise<DocumentForPackage[]>;
  openFile(documentId: string, versionId: string): Promise<ReadableStream<Uint8Array> | null>;
}

export type SharingDeps = { repo: SharingRepository; others: SharingCollaborators; audit: AuditRecorder };
export type SharingReadDeps = Pick<SharingDeps, "repo" | "others">;
