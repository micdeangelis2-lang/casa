import type { AuditRecorder } from "@/platform/audit";
import type { PaymentKind, PaymentMethod, TaxKind } from "../domain/taxes";

export type TaxTypeRow = { id: string; name: string; kind: TaxKind; territoryId: string | null; source: string | null; notes: string | null; archived: boolean };
export type ObligationRow = {
  id: string;
  assetId: string;
  taxTypeId: string;
  year: number;
  label: string | null;
  dueOn: string | null;
  expectedCents: number | null;
  status: "open" | "closed";
  closedOn: string | null;
  closedNote: string | null;
  askAdviser: boolean;
  note: string | null;
  deadlineId: string | null;
};
export type PaymentRow = { id: string; obligationId: string; paidOn: string; amountCents: number; method: PaymentMethod; kind: PaymentKind; penaltyCents: number | null; interestCents: number | null; reference: string | null; documentId: string | null; note: string | null };
export type ReturnRow = {
  id: string;
  title: string;
  taxTypeId: string | null;
  assetId: string | null;
  year: number;
  dueOn: string | null;
  filedOn: string | null;
  protocol: string | null;
  documentId: string | null;
  askAdviser: boolean;
  note: string | null;
  deadlineId: string | null;
};

type Insert<T> = Omit<T, "id">;

export interface TaxRepository {
  insertType(d: Insert<TaxTypeRow>): Promise<string>;
  updateType(id: string, d: Partial<Insert<TaxTypeRow>>): Promise<boolean>;
  getType(id: string): Promise<TaxTypeRow | null>;
  listTypes(includeArchived: boolean): Promise<TaxTypeRow[]>;

  insertObligation(d: Insert<ObligationRow>): Promise<string>;
  updateObligation(id: string, d: Partial<Insert<ObligationRow>>): Promise<boolean>;
  getObligation(id: string): Promise<ObligationRow | null>;
  listObligations(filter: { year?: number; assetId?: string; taxTypeId?: string }): Promise<ObligationRow[]>;

  payments(obligationId: string): Promise<PaymentRow[]>;
  paymentsOf(obligationIds: string[]): Promise<PaymentRow[]>;
  insertPayment(d: Insert<PaymentRow>): Promise<string>;
  getPayment(id: string): Promise<PaymentRow | null>;
  /** Pagamenti con data tra due date (estremi inclusi), con la voce a cui appartengono: serve al quadro economico. */
  paymentsBetween(from: string, to: string): Promise<{ paymentId: string; paidOn: string; amountCents: number; kind: PaymentKind; penaltyCents: number | null; interestCents: number | null; documentId: string | null; obligationId: string; assetId: string; taxTypeId: string; year: number; label: string | null }[]>;
  deletePayment(id: string): Promise<void>;

  insertReturn(d: Insert<ReturnRow>): Promise<string>;
  updateReturn(id: string, d: Partial<Insert<ReturnRow>>): Promise<boolean>;
  getReturn(id: string): Promise<ReturnRow | null>;
  listReturns(filter: { year?: number; assetId?: string }): Promise<ReturnRow[]>;
}

export interface TaxCollaborators {
  assets(): Promise<{ id: string; name: string; territoryId: string; territoryLabel: string }[]>;
  documentTitles(): Promise<Map<string, string>>;
  /** Crea una scadenza manuale (modulo Scadenze); restituisce il suo id. */
  createDeadline(d: { title: string; dueOn: string; assetId?: string; proofRequired: boolean }): Promise<string | null>;
  /** Chiude le date aperte di una scadenza. */
  completeDeadline(deadlineId: string, d: { completedOn: string; reference: string }): Promise<void>;
  /** Riapre le date chiuse di una scadenza (una voce riaperta o un pagamento tolto). */
  reopenDeadline(deadlineId: string): Promise<void>;
}

export type TaxDeps = { repo: TaxRepository; others: TaxCollaborators; audit: AuditRecorder };
export type TaxReadDeps = Pick<TaxDeps, "repo" | "others">;
