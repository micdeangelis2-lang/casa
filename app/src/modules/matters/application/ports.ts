import type { AuditRecorder } from "@/platform/audit";
import type { EventKind, MatterStatus, OpinionNature, RequestStatus } from "../domain/matter";

export type MatterRow = {
  id: string;
  title: string;
  description: string | null;
  assetId: string | null;
  status: MatterStatus;
  openedOn: string;
  closedOn: string | null;
  officePartyId: string | null;
  protocolNumber: string | null;
  submittedOn: string | null;
  responseDueOn: string | null;
};

export type AssignmentRow = { partyId: string; role: string | null };
export type RequestRow = { id: string; matterId: string; title: string; requestedFromPartyId: string | null; status: RequestStatus; requestedOn: string; dueOn: string | null; documentId: string | null; note: string | null };
export type OpinionRow = { id: string; matterId: string; partyId: string; nature: OpinionNature; summary: string; issuedOn: string | null; documentId: string | null };

export type EventRow = { id: string; matterId: string; kind: EventKind; occurredOn: string; title: string; note: string | null; partyId: string | null; documentId: string | null };

export interface MatterRepository {
  insert(data: Pick<MatterRow, "title" | "description" | "assetId" | "status" | "openedOn" | "officePartyId" | "protocolNumber" | "submittedOn" | "responseDueOn">): Promise<string>;
  update(id: string, patch: Partial<Omit<MatterRow, "id">>): Promise<boolean>;
  get(id: string): Promise<MatterRow | null>;
  list(args: { status?: MatterStatus; assetId?: string; includeClosed: boolean }): Promise<MatterRow[]>;
  assignments(matterId: string): Promise<AssignmentRow[]>;
  assign(matterId: string, partyId: string, role: string | null): Promise<void>;
  unassign(matterId: string, partyId: string): Promise<void>;
  requests(matterId: string): Promise<RequestRow[]>;
  getRequest(id: string): Promise<RequestRow | null>;
  insertRequest(matterId: string, data: { title: string; requestedFromPartyId: string | null; dueOn: string | null; note: string | null; requestedOn: string }): Promise<string>;
  updateRequest(id: string, patch: { status: RequestStatus; documentId: string | null }): Promise<void>;
  opinions(matterId: string): Promise<OpinionRow[]>;
  insertOpinion(matterId: string, data: Omit<OpinionRow, "id" | "matterId">): Promise<string>;
  events(matterId: string): Promise<EventRow[]>;
  insertEvent(matterId: string, data: Omit<EventRow, "id" | "matterId">): Promise<string>;
  deleteEvent(matterId: string, eventId: string): Promise<boolean>;
  documentIds(matterId: string): Promise<string[]>;
  linkDocument(matterId: string, documentId: string): Promise<void>;
  unlinkDocument(matterId: string, documentId: string): Promise<void>;
}

export interface MatterCollaborators {
  assetNames(): Promise<Map<string, string>>;
  parties(): Promise<Map<string, { name: string; roles: string[] }>>;
  documentTitles(ids?: string[]): Promise<Map<string, string>>;
}

export type MatterDeps = { repo: MatterRepository; others: MatterCollaborators; audit: AuditRecorder };
export type MatterReadDeps = Pick<MatterDeps, "repo" | "others">;
