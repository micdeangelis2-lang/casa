import type { AuditRecorder } from "@/platform/audit";
import type { Calc } from "@/shared/calc";
import type { DerivedDeadline } from "@/modules/rules";
import type { HolidayRule } from "../domain/holidays";
import type { CompletionKind, DeadlineCategory, OccurrenceStatus, Priority } from "../domain/deadline";

export type Level = "national" | "regional" | "municipal" | "condominium" | "contract";

export type NewDeadline = {
  title: string;
  description: string | null;
  category: DeadlineCategory;
  level: Level;
  legalBasis: string | null;
  assetId: string | null;
  responsiblePartyId: string | null;
  professionalPartyId: string | null;
  matterId: string | null;
  calc: Calc;
  shiftToBusinessDay: boolean;
  priority: Priority;
  consequences: string | null;
  requiredDocuments: string | null;
  leadDays: number[];
  proofRequired: boolean;
  origin: "manual" | "rule";
  ruleKey: string | null;
  outcomeKey: string | null;
  ruleVersionId: string | null;
  explanation: unknown;
};

export type DeadlineRow = NewDeadline & { id: string; stale: boolean; archived: boolean };

export type OccurrenceRow = {
  id: string;
  deadlineId: string;
  dueOn: string;
  status: OccurrenceStatus;
  completedOn: string | null;
  completionKind: CompletionKind | null;
  snoozedUntil: string | null;
  note: string | null;
};

export type OccurrenceView = OccurrenceRow & {
  title: string;
  category: DeadlineCategory;
  level: Level;
  priority: Priority;
  assetId: string | null;
  assetName: string | null;
  proofRequired: boolean;
  stale: boolean;
  origin: "manual" | "rule";
  archived: boolean;
  leadDays: number[];
};

export type OccurrenceFilter = {
  statuses?: OccurrenceStatus[];
  from?: string;
  to?: string;
  /** Solo date precedenti a questa (per le scadute). */
  before?: string;
  assetId?: string;
  category?: DeadlineCategory;
  includeArchived?: boolean;
  deadlineId?: string;
};

export type ProofRow = { id: string; occurrenceId: string; documentId: string | null; reference: string | null };

export type NotificationRow = {
  id: string;
  occurrenceId: string;
  deadlineId: string;
  leadDays: number;
  dueOn: string;
  title: string;
  body: string;
  readAt: Date | null;
  emailSentAt: Date | null;
  emailError: string | null;
  createdAt: Date;
};

export interface DeadlineRepository {
  insertDeadline(data: NewDeadline): Promise<string>;
  updateDeadline(id: string, patch: Partial<NewDeadline> & { stale?: boolean }): Promise<void>;
  getDeadline(id: string): Promise<DeadlineRow | null>;
  listDeadlines(args: { assetId?: string; includeArchived?: boolean }): Promise<DeadlineRow[]>;
  derivedFor(assetId: string): Promise<DeadlineRow[]>;
  setArchived(id: string, archived: boolean): Promise<boolean>;

  /** Inserisce la data se non c'e' gia'; restituisce l'id, oppure null se esisteva. */
  insertOccurrence(deadlineId: string, dueOn: string): Promise<string | null>;
  occurrencesOf(deadlineId: string): Promise<OccurrenceRow[]>;
  getOccurrence(id: string): Promise<OccurrenceRow | null>;
  updateOccurrence(id: string, patch: Partial<Omit<OccurrenceRow, "id" | "deadlineId">>): Promise<void>;
  /** Annulla le date ancora aperte dopo `after` che non sono in `keep` (la regola e' cambiata). */
  cancelOpenAfter(deadlineId: string, after: string, keep: string[]): Promise<number>;
  listOccurrences(filter: OccurrenceFilter): Promise<OccurrenceView[]>;

  addProof(occurrenceId: string, proof: { documentId?: string; reference?: string }): Promise<string>;
  proofsOf(occurrenceIds: string[]): Promise<ProofRow[]>;

  /** Inserisce l'avviso se non c'e' gia' (chiave univoca); vero se e' nuovo. */
  insertNotification(n: { occurrenceId: string; leadDays: number; dueOn: string; title: string; body: string }): Promise<boolean>;
  listNotifications(args: { unreadOnly: boolean; limit: number }): Promise<NotificationRow[]>;
  countUnread(): Promise<number>;
  markRead(id: string | null): Promise<void>;
  /** Avvisi non ancora inviati per email, creati dopo `since` (e comunque non piu' vecchi di una settimana). */
  pendingEmails(limit: number, since: Date): Promise<NotificationRow[]>;
  setEmailResult(id: string, result: { sentAt: Date } | { error: string }): Promise<void>;

  holidayRulesFor(territoryChain: string[]): Promise<HolidayRule[]>;
  getSetting(key: string): Promise<unknown>;
  setSetting(key: string, value: unknown): Promise<void>;
}

export type AssetInfo = { name: string; territoryChain: string[]; attributes: Record<string, string | number | boolean> };

export interface DeadlineCollaborators {
  assetInfo(assetId: string): Promise<AssetInfo | null>;
  assetNames(): Promise<Map<string, string>>;
  partyNames(): Promise<Map<string, string>>;
  /** Id delle pratiche esistenti (per il collegamento pratica-scadenza). */
  matterIds(): Promise<Set<string>>;
  documentTitles(ids: string[]): Promise<Map<string, string>>;
  /** Email dell'account del proprietario (destinatario predefinito degli avvisi). */
  ownerEmail(): Promise<string | null>;
}

export interface MailPort {
  /** Vero se c'e' un servizio configurato; altrimenti gli avvisi restano solo nell'app. */
  readonly configured: boolean;
  send(message: { to: string; subject: string; text: string }): Promise<void>;
}

export type DeadlineDeps = { repo: DeadlineRepository; others: DeadlineCollaborators; audit: AuditRecorder };
export type DeadlineReadDeps = Pick<DeadlineDeps, "repo" | "others">;
export type { DerivedDeadline };
