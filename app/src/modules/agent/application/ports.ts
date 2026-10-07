import type { AuditRecorder } from "@/platform/audit";
import type { ListingEventKind, ListingKind, ListingOutcome, ListingStatus } from "../domain/listing";

export type EngagementRow = {
  id: string;
  assetId: string;
  kind: ListingKind;
  agentPartyId: string | null;
  startsOn: string | null;
  endsOn: string | null;
  exclusive: boolean;
  askingCents: number | null;
  commission: string | null;
  documentId: string | null;
  note: string | null;
  status: ListingStatus;
};

export type ListingEventRow = {
  id: string;
  engagementId: string;
  kind: ListingEventKind;
  occurredOn: string;
  amountCents: number | null;
  outcome: ListingOutcome | null;
  contactPartyId: string | null;
  note: string | null;
};

export interface ListingRepository {
  engagements(assetId: string): Promise<EngagementRow[]>;
  insertEngagement(d: Omit<EngagementRow, "id">): Promise<string>;
  getEngagement(id: string): Promise<EngagementRow | null>;
  updateEngagement(id: string, d: Partial<Omit<EngagementRow, "id" | "assetId">>): Promise<void>;
  deleteEngagement(id: string): Promise<void>;
  events(engagementIds: string[]): Promise<ListingEventRow[]>;
  insertEvent(d: Omit<ListingEventRow, "id">): Promise<string>;
  getEvent(id: string): Promise<ListingEventRow | null>;
  deleteEvent(id: string): Promise<void>;
}

export interface ListingCollaborators {
  assetExists(assetId: string): Promise<boolean>;
  partyNames(): Promise<Map<string, string>>;
  documentTitles(ids?: string[]): Promise<Map<string, string>>;
}

export type ListingDeps = { repo: ListingRepository; others: ListingCollaborators; audit: AuditRecorder };
export type ListingReadDeps = Pick<ListingDeps, "repo" | "others">;
