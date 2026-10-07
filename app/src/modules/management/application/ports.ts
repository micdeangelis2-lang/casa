import type { AuditRecorder } from "@/platform/audit";

export type MandateRow = {
  id: string;
  assetId: string | null;
  managerPartyId: string | null;
  startsOn: string | null;
  endsOn: string | null;
  compensation: string | null;
  documentId: string | null;
  note: string | null;
  deadlineId: string | null;
  archived: boolean;
};

export interface MandateRepository {
  list(filter: { includeArchived: boolean }): Promise<MandateRow[]>;
  insert(d: Omit<MandateRow, "id">): Promise<string>;
  get(id: string): Promise<MandateRow | null>;
  update(id: string, d: Partial<Omit<MandateRow, "id">>): Promise<void>;
}

export interface ManagementCollaborators {
  assetNames(): Promise<Map<string, string>>;
  partyNames(): Promise<Map<string, string>>;
  documentTitles(ids?: string[]): Promise<Map<string, string>>;
  /** Crea la scadenza di fine mandato (modulo Scadenze); restituisce il suo id. */
  createEndDeadline(d: { title: string; assetId: string | null; managerPartyId: string | null; description: string; endsOn: string }): Promise<string | null>;
  archiveDeadline(deadlineId: string, archived: boolean): Promise<void>;
}

export type MandateDeps = { repo: MandateRepository; others: ManagementCollaborators; audit: AuditRecorder };
export type MandateReadDeps = Pick<MandateDeps, "repo" | "others">;
