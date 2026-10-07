import type { AuditRecorder } from "@/platform/audit";
import type { ClaimStatus, EntryDirection } from "../domain/insurance";

export type PolicyRow = {
  id: string;
  title: string;
  insurerPartyId: string | null;
  agentPartyId: string | null;
  policyNumber: string | null;
  startsOn: string | null;
  endsOn: string | null;
  premiumCents: number | null;
  note: string | null;
  documentId: string | null;
  deadlineId: string | null;
  archived: boolean;
};
export type CoverageRow = { id: string; policyId: string; title: string; sumInsuredCents: number | null; deductibleCents: number | null; note: string | null };
export type PremiumRow = { id: string; policyId: string; dueOn: string; amountCents: number; paidOn: string | null; documentId: string | null; deadlineId: string | null };
export type ClaimRow = {
  id: string;
  policyId: string;
  assetId: string | null;
  title: string;
  claimNumber: string | null;
  occurredOn: string;
  reportedOn: string | null;
  status: ClaimStatus;
  claimedCents: number | null;
  receivedCents: number | null;
  adjusterPartyId: string | null;
  matterId: string | null;
  description: string | null;
  closedOn: string | null;
};
export type ClaimEntryRow = { id: string; claimId: string; entryOn: string; direction: EntryDirection; summary: string; documentId: string | null };

type Insert<T> = Omit<T, "id">;

export interface InsuranceRepository {
  insertPolicy(d: Insert<PolicyRow>): Promise<string>;
  updatePolicy(id: string, d: Partial<Insert<PolicyRow>>): Promise<boolean>;
  getPolicy(id: string): Promise<PolicyRow | null>;
  listPolicies(includeArchived: boolean): Promise<PolicyRow[]>;
  policyAssets(policyId: string): Promise<string[]>;
  allPolicyAssets(): Promise<{ policyId: string; assetId: string }[]>;
  setPolicyAssets(policyId: string, assetIds: string[]): Promise<void>;

  coverages(policyId: string): Promise<CoverageRow[]>;
  insertCoverage(d: Insert<CoverageRow>): Promise<string>;
  getCoverage(id: string): Promise<CoverageRow | null>;
  deleteCoverage(id: string): Promise<void>;

  premiums(policyId: string): Promise<PremiumRow[]>;
  allPremiums(): Promise<PremiumRow[]>;
  insertPremium(d: Insert<PremiumRow>): Promise<string>;
  getPremium(id: string): Promise<PremiumRow | null>;
  /** Premi pagati tra due date (estremi inclusi): serve al quadro economico. */
  paidPremiumsBetween(from: string, to: string): Promise<(PremiumRow & { paidOn: string })[]>;
  updatePremium(id: string, d: Partial<Insert<PremiumRow>>): Promise<void>;
  deletePremium(id: string): Promise<void>;

  insertClaim(d: Insert<ClaimRow>): Promise<string>;
  updateClaim(id: string, d: Partial<Insert<ClaimRow>>): Promise<boolean>;
  getClaim(id: string): Promise<ClaimRow | null>;
  listClaims(filter: { policyId?: string }): Promise<ClaimRow[]>;
  entries(claimId: string): Promise<ClaimEntryRow[]>;
  insertEntry(d: Insert<ClaimEntryRow>): Promise<string>;
  getEntry(id: string): Promise<ClaimEntryRow | null>;
  deleteEntry(id: string): Promise<void>;
}

export interface InsuranceCollaborators {
  assets(): Promise<{ id: string; name: string }[]>;
  parties(): Promise<Map<string, string>>;
  documentTitles(): Promise<Map<string, string>>;
  matterTitles(): Promise<Map<string, string>>;
  /** Crea una scadenza manuale (modulo Scadenze); restituisce il suo id. */
  createDeadline(d: { title: string; dueOn: string; assetId?: string; proofRequired: boolean }): Promise<string | null>;
  archiveDeadline(deadlineId: string, archived: boolean): Promise<void>;
  completeDeadline(deadlineId: string, d: { completedOn: string; reference: string }): Promise<void>;
}

export type InsuranceDeps = { repo: InsuranceRepository; others: InsuranceCollaborators; audit: AuditRecorder };
export type InsuranceReadDeps = Pick<InsuranceDeps, "repo" | "others">;
