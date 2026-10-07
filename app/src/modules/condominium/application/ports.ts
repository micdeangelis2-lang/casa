import type { AuditRecorder } from "@/platform/audit";
import type { BudgetKind, BudgetScope, ResolutionOutcome } from "../domain/condominium";

export type CondominiumRow = { id: string; name: string; address: string | null; taxCode: string | null; administratorPartyId: string | null; notes: string | null; archived: boolean };
export type MemberRow = { id: string; condominiumId: string; assetId: string; unitLabel: string | null };
export type TableRow = { id: string; condominiumId: string; name: string; note: string | null };
export type ShareRow = { tableId: string; assetId: string; milli: number };
export type OtherShareRow = { id: string; tableId: string; label: string; milli: number };
export type YearRow = { id: string; condominiumId: string; label: string; startsOn: string; endsOn: string };
export type BudgetRow = { id: string; fiscalYearId: string; kind: BudgetKind; title: string; totalCents: number; millesimalTableId: string | null; scope: BudgetScope; note: string | null; documentId: string | null };
export type InstallmentRow = { id: string; budgetId: string; assetId: string; number: number; dueOn: string; amountCents: number; paidCents: number; paidOn: string | null; documentId: string | null; deadlineId: string | null };
export type MeetingRow = { id: string; condominiumId: string; kind: "ordinary" | "extraordinary"; status: "convened" | "held" | "cancelled"; convenedOn: string | null; meetingOn: string; location: string | null; convocationDocumentId: string | null; minutesDocumentId: string | null; notes: string | null };
export type AgendaRow = { id: string; meetingId: string; position: number; title: string; description: string | null; questions: string | null; documentIds: string[] };
export type ProxyRow = { id: string; meetingId: string; delegatePartyId: string; note: string | null; documentId: string | null };
export type ResolutionRow = {
  id: string;
  meetingId: string;
  agendaItemId: string | null;
  title: string;
  text: string | null;
  outcome: ResolutionOutcome;
  votesFor: number | null;
  votesAgainst: number | null;
  votesAbstain: number | null;
  threshold: number | null;
  thresholdNote: string | null;
  deadlineId: string | null;
  budgetId: string | null;
};
export type WorkRow = { id: string; condominiumId: string; title: string; status: string; budgetCents: number | null; resolutionId: string | null; note: string | null };
export type WorkEntryRow = { id: string; workId: string; kind: "quote" | "progress" | "invoice"; title: string; amountCents: number | null; entryOn: string | null; documentId: string | null };
export type ClaimRow = { id: string; condominiumId: string; kind: string; title: string; description: string | null; status: "open" | "closed"; openedOn: string; closedOn: string | null; matterId: string | null };
export type ContractRow = { id: string; condominiumId: string; kind: "contract" | "certification"; title: string; counterpartyPartyId: string | null; validFrom: string | null; validTo: string | null; documentId: string | null; note: string | null };
export type CondoDocumentRow = { documentId: string; kind: string };

type Insert<T> = Omit<T, "id">;

export interface CondoRepository {
  insertCondominium(d: Insert<CondominiumRow>): Promise<string>;
  updateCondominium(id: string, d: Partial<Insert<CondominiumRow>>): Promise<boolean>;
  getCondominium(id: string): Promise<CondominiumRow | null>;
  listCondominiums(includeArchived: boolean): Promise<CondominiumRow[]>;

  members(condoId: string): Promise<MemberRow[]>;
  addMember(condoId: string, assetId: string, unitLabel: string | null): Promise<void>;
  removeMember(condoId: string, assetId: string): Promise<void>;
  condominiumOfAsset(assetId: string): Promise<string | null>;

  tables(condoId: string): Promise<TableRow[]>;
  insertTable(condoId: string, d: { name: string; note: string | null }): Promise<string>;
  getTable(id: string): Promise<TableRow | null>;
  shares(tableId: string): Promise<ShareRow[]>;
  replaceShares(tableId: string, rows: { assetId: string; milli: number }[]): Promise<void>;
  others(tableId: string): Promise<OtherShareRow[]>;
  replaceOthers(tableId: string, rows: { label: string; milli: number }[]): Promise<void>;

  years(condoId: string): Promise<YearRow[]>;
  insertYear(condoId: string, d: { label: string; startsOn: string; endsOn: string }): Promise<string>;
  getYear(id: string): Promise<YearRow | null>;
  budgets(yearId: string): Promise<BudgetRow[]>;
  insertBudget(yearId: string, d: Omit<BudgetRow, "id" | "fiscalYearId">): Promise<string>;
  getBudget(id: string): Promise<BudgetRow | null>;
  installments(budgetId: string): Promise<InstallmentRow[]>;
  insertInstallments(rows: Insert<InstallmentRow>[]): Promise<string[]>;
  deleteInstallments(budgetId: string): Promise<void>;
  getInstallment(id: string): Promise<InstallmentRow | null>;
  /** Rate con un pagamento tra due date (estremi inclusi), con preventivo e condominio: serve al quadro economico. */
  paidInstallmentsBetween(from: string, to: string): Promise<{ installmentId: string; paidOn: string; paidCents: number; documentId: string | null; number: number; assetId: string; budgetTitle: string; condominiumId: string }[]>;
  updateInstallment(id: string, d: Partial<Pick<InstallmentRow, "paidCents" | "paidOn" | "documentId" | "deadlineId">>): Promise<void>;

  meetings(condoId: string): Promise<MeetingRow[]>;
  insertMeeting(condoId: string, d: Omit<MeetingRow, "id" | "condominiumId">): Promise<string>;
  updateMeeting(id: string, d: Partial<Omit<MeetingRow, "id" | "condominiumId">>): Promise<boolean>;
  getMeeting(id: string): Promise<MeetingRow | null>;
  agenda(meetingId: string): Promise<AgendaRow[]>;
  insertAgendaItem(meetingId: string, d: { title: string; description: string | null; questions: string | null }): Promise<string>;
  updateAgendaItem(id: string, d: { title: string; description: string | null; questions: string | null }): Promise<boolean>;
  getAgendaItem(id: string): Promise<AgendaRow | null>;
  deleteAgendaItem(id: string): Promise<void>;
  setAgendaDocument(agendaItemId: string, documentId: string, linked: boolean): Promise<void>;
  proxies(meetingId: string): Promise<ProxyRow[]>;
  insertProxy(meetingId: string, d: { delegatePartyId: string; note: string | null; documentId: string | null }): Promise<string>;
  deleteProxy(id: string): Promise<void>;
  resolutions(meetingId: string): Promise<ResolutionRow[]>;
  insertResolution(meetingId: string, d: Omit<ResolutionRow, "id" | "meetingId" | "deadlineId" | "budgetId">): Promise<string>;
  updateResolution(id: string, d: Partial<Omit<ResolutionRow, "id" | "meetingId">>): Promise<boolean>;
  getResolution(id: string): Promise<ResolutionRow | null>;

  works(condoId: string): Promise<WorkRow[]>;
  insertWork(condoId: string, d: Omit<WorkRow, "id" | "condominiumId">): Promise<string>;
  updateWork(id: string, d: Partial<Omit<WorkRow, "id" | "condominiumId">>): Promise<boolean>;
  getWork(id: string): Promise<WorkRow | null>;
  entries(workId: string): Promise<WorkEntryRow[]>;
  insertEntry(workId: string, d: Omit<WorkEntryRow, "id" | "workId">): Promise<string>;

  claims(condoId: string): Promise<ClaimRow[]>;
  insertClaim(condoId: string, d: Omit<ClaimRow, "id" | "condominiumId" | "closedOn">): Promise<string>;
  updateClaim(id: string, d: Partial<Omit<ClaimRow, "id" | "condominiumId">>): Promise<boolean>;
  getClaim(id: string): Promise<ClaimRow | null>;

  contracts(condoId: string): Promise<ContractRow[]>;
  insertContract(condoId: string, d: Omit<ContractRow, "id" | "condominiumId">): Promise<string>;

  documents(condoId: string): Promise<CondoDocumentRow[]>;
  linkDocument(condoId: string, documentId: string, kind: string): Promise<void>;
  unlinkDocument(condoId: string, documentId: string): Promise<void>;
}

export interface CondoCollaborators {
  assets(): Promise<{ id: string; name: string }[]>;
  parties(): Promise<Map<string, string>>;
  documentTitles(): Promise<Map<string, string>>;
  matterTitles(): Promise<Map<string, string>>;
  /** Crea una scadenza manuale (modulo Scadenze); restituisce il suo id. */
  createDeadline(d: { title: string; dueOn: string; assetId?: string; level: "condominium"; category: "condominium"; proofRequired?: boolean }): Promise<string | null>;
  /** Chiude le date aperte di una scadenza (es. rata pagata). */
  completeDeadline(deadlineId: string, d: { completedOn: string; reference: string }): Promise<void>;
  /** Archivia la scadenza di una rata sostituita, cosi' non resta un promemoria orfano. */
  archiveDeadline(deadlineId: string): Promise<void>;
}

export type CondoDeps = { repo: CondoRepository; others: CondoCollaborators; audit: AuditRecorder };
export type CondoReadDeps = Pick<CondoDeps, "repo" | "others">;
