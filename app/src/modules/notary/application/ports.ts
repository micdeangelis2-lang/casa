import type { AuditRecorder } from "@/platform/audit";
import type { EncumbranceKind, ProvenanceKind } from "../domain/records";

export type ProvenanceRow = {
  id: string;
  assetId: string;
  kind: ProvenanceKind;
  occurredOn: string | null;
  fromPartyId: string | null;
  notaryPartyId: string | null;
  deedReference: string | null;
  documentId: string | null;
  note: string | null;
};

export type EncumbranceRow = {
  id: string;
  assetId: string;
  kind: EncumbranceKind;
  title: string;
  registeredOn: string | null;
  endedOn: string | null;
  beneficiaryPartyId: string | null;
  amountCents: number | null;
  reference: string | null;
  documentId: string | null;
  note: string | null;
};

export interface NotaryRepository {
  provenances(assetId: string): Promise<ProvenanceRow[]>;
  insertProvenance(d: Omit<ProvenanceRow, "id">): Promise<string>;
  getProvenance(id: string): Promise<ProvenanceRow | null>;
  deleteProvenance(id: string): Promise<void>;
  encumbrances(assetId: string): Promise<EncumbranceRow[]>;
  insertEncumbrance(d: Omit<EncumbranceRow, "id">): Promise<string>;
  getEncumbrance(id: string): Promise<EncumbranceRow | null>;
  deleteEncumbrance(id: string): Promise<void>;
}

export interface NotaryCollaborators {
  assetExists(assetId: string): Promise<boolean>;
  partyNames(): Promise<Map<string, string>>;
  documentTitles(ids?: string[]): Promise<Map<string, string>>;
}

export type NotaryDeps = { repo: NotaryRepository; others: NotaryCollaborators; audit: AuditRecorder };
export type NotaryReadDeps = Pick<NotaryDeps, "repo" | "others">;
