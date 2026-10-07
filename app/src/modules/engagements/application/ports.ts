import type { AuditRecorder } from "@/platform/audit";
import type { DeliverableDirection, EngagementStatus } from "../domain/engagement";

export type EngagementRow = {
  id: string;
  partyId: string;
  assetId: string | null;
  matterId: string | null;
  subject: string;
  engagedOn: string;
  declaredFeeCents: number | null;
  status: EngagementStatus;
  documentId: string | null;
  note: string | null;
};
export type DeliverableRow = { id: string; engagementId: string; direction: DeliverableDirection; kindLabel: string; occurredOn: string; documentId: string | null; note: string | null };

export interface EngagementRepository {
  list(filter: { partyId?: string; assetId?: string; matterId?: string }): Promise<EngagementRow[]>;
  get(id: string): Promise<EngagementRow | null>;
  insert(d: Omit<EngagementRow, "id">): Promise<string>;
  update(id: string, d: Partial<Omit<EngagementRow, "id">>): Promise<void>;
  deliverables(engagementIds: string[]): Promise<DeliverableRow[]>;
  getDeliverable(id: string): Promise<DeliverableRow | null>;
  insertDeliverable(d: Omit<DeliverableRow, "id">): Promise<string>;
  deleteDeliverable(id: string): Promise<void>;
}

export interface EngagementCollaborators {
  partyNames(): Promise<Map<string, string>>;
  assetNames(): Promise<Map<string, string>>;
  matterTitles(): Promise<Map<string, string>>;
  documentTitles(ids?: string[]): Promise<Map<string, string>>;
}

export type EngagementDeps = { repo: EngagementRepository; others: EngagementCollaborators; audit: AuditRecorder };
export type EngagementReadDeps = Pick<EngagementDeps, "repo" | "others">;
