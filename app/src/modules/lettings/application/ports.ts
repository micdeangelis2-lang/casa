import type { AuditRecorder } from "@/platform/audit";
import type { LettingPartyRole, LettingStatus, LettingType, ReportKind } from "../domain/lettings";

export type LettingRow = {
  id: string;
  assetId: string;
  type: LettingType;
  title: string;
  status: LettingStatus;
  startsOn: string | null;
  endsOn: string | null;
  managerPartyId: string | null;
  monthlyRentCents: number | null;
  depositCents: number | null;
  depositReceivedOn: string | null;
  depositReturnedOn: string | null;
  depositReturnedCents: number | null;
  registeredOn: string | null;
  registrationNumber: string | null;
  registrationOffice: string | null;
  contractDocumentId: string | null;
  note: string | null;
  deadlineId: string | null;
};
export type LettingPartyRow = { lettingId: string; partyId: string; role: LettingPartyRole };
export type RentRow = { id: string; lettingId: string; dueOn: string; amountCents: number; paidOn: string | null; paidCents: number; documentId: string | null; deadlineId: string | null };
export type ReceiptRow = { id: string; rentId: string; paidOn: string; amountCents: number; method: string | null; documentId: string | null };
export type CodeRow = { id: string; lettingId: string; label: string; value: string; issuer: string | null; issuedOn: string | null; validUntil: string | null; note: string | null };
export type ReportRow = { id: string; lettingId: string; kind: ReportKind; title: string; period: string | null; dueOn: string | null; amountCents: number | null; doneOn: string | null; documentId: string | null; note: string | null; deadlineId: string | null };

type Insert<T> = Omit<T, "id">;

export interface LettingRepository {
  insertLetting(d: Insert<LettingRow>): Promise<string>;
  updateLetting(id: string, d: Partial<Insert<LettingRow>>): Promise<boolean>;
  getLetting(id: string): Promise<LettingRow | null>;
  listLettings(filter: { assetId?: string }): Promise<LettingRow[]>;
  activeTypesOfAsset(assetId: string): Promise<LettingType[]>;

  parties(lettingId: string): Promise<LettingPartyRow[]>;
  addParty(d: LettingPartyRow): Promise<void>;
  removeParty(lettingId: string, partyId: string): Promise<void>;

  rents(lettingId: string): Promise<RentRow[]>;
  insertRents(rows: Insert<RentRow>[]): Promise<string[]>;
  deleteRents(lettingId: string): Promise<void>;
  getRent(id: string): Promise<RentRow | null>;
  /** Incassi tra due date (estremi inclusi), con la locazione e il bene: servono al quadro economico. */
  receiptsBetween(from: string, to: string): Promise<{ receiptId: string; rentId: string; paidOn: string; amountCents: number; documentId: string | null; lettingId: string; lettingTitle: string; assetId: string }[]>;
  receipts(rentId: string): Promise<ReceiptRow[]>;
  receiptsOfRents(rentIds: string[]): Promise<ReceiptRow[]>;
  getReceipt(id: string): Promise<ReceiptRow | null>;
  insertReceipt(d: Insert<ReceiptRow>): Promise<string>;
  deleteReceipt(id: string): Promise<void>;
  deleteReceiptsOf(rentId: string): Promise<void>;
  deleteRent(id: string): Promise<void>;
  updateRent(id: string, d: Partial<Insert<RentRow>>): Promise<void>;

  codes(lettingId: string): Promise<CodeRow[]>;
  insertCode(d: Insert<CodeRow>): Promise<string>;
  getCode(id: string): Promise<CodeRow | null>;
  deleteCode(id: string): Promise<void>;

  reports(lettingId: string): Promise<ReportRow[]>;
  insertReport(d: Insert<ReportRow>): Promise<string>;
  getReport(id: string): Promise<ReportRow | null>;
  updateReport(id: string, d: Partial<Insert<ReportRow>>): Promise<void>;
  deleteReport(id: string): Promise<void>;
}

export interface LettingCollaborators {
  assets(): Promise<{ id: string; name: string }[]>;
  parties(): Promise<Map<string, string>>;
  documentTitles(): Promise<Map<string, string>>;
  /** Crea una scadenza manuale (modulo Scadenze); restituisce il suo id. */
  createDeadline(d: { title: string; dueOn: string; assetId: string; category: "letting" | "hospitality"; proofRequired: boolean }): Promise<string | null>;
  completeDeadline(deadlineId: string, d: { completedOn: string; reference: string }): Promise<void>;
  /** Archivia la scadenza di una voce tolta o sostituita, cosi' non resta un promemoria orfano. */
  archiveDeadline(deadlineId: string): Promise<void>;
  /** Riapre le date chiuse di una scadenza (un adempimento o un canone che torna da fare). */
  reopenDeadline(deadlineId: string): Promise<void>;
}

export type LettingDeps = { repo: LettingRepository; others: LettingCollaborators; audit: AuditRecorder };
export type LettingReadDeps = Pick<LettingDeps, "repo" | "others">;
