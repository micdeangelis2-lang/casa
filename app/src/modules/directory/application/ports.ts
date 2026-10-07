import type { AuditRecorder } from "@/platform/audit";
import type { Party, PartyInput, PartyRole } from "../domain/party";

export interface PartyRepository {
  get(id: string): Promise<Party | null>;
  insert(input: PartyInput): Promise<Party>;
  update(id: string, input: PartyInput): Promise<Party | null>;
  setArchived(id: string, archived: boolean): Promise<Party | null>;
  list(args: { query?: string; role?: PartyRole; includeArchived?: boolean }): Promise<Party[]>;
  findByRole(role: PartyRole): Promise<Party | null>;
}

export type DirectoryDeps = { repo: PartyRepository; audit: AuditRecorder };
