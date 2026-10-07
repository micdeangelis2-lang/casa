import type { AuditRecorder } from "@/platform/audit";
import type { PlantKind, QuoteStatus, WorkStatus } from "../domain/maintenance";

export type WorkRow = {
  id: string;
  assetId: string;
  title: string;
  description: string | null;
  status: WorkStatus;
  supplierPartyId: string | null;
  plantId: string | null;
  scheduledOn: string | null;
  startedOn: string | null;
  completedOn: string | null;
  budgetCents: number | null;
  note: string | null;
  deadlineId: string | null;
};
export type QuoteRow = { id: string; workId: string; supplierPartyId: string | null; amountCents: number; quotedOn: string | null; validUntil: string | null; status: QuoteStatus; documentId: string | null; note: string | null };
export type InvoiceRow = { id: string; workId: string; number: string | null; issuedOn: string; amountCents: number; paidOn: string | null; documentId: string | null; note: string | null };
export type ProgressRow = { id: string; workId: string; recordedOn: string; percent: number | null; note: string };
export type WarrantyRow = { id: string; assetId: string; workId: string | null; plantId: string | null; title: string; startsOn: string | null; endsOn: string; supplierPartyId: string | null; documentId: string | null; note: string | null; deadlineId: string | null; archived: boolean };
export type PlanRow = { id: string; assetId: string; title: string; intervalMonths: number; firstDueOn: string; supplierPartyId: string | null; plantId: string | null; note: string | null; deadlineId: string | null; archived: boolean };

export type PlantRow = { id: string; assetId: string; kind: PlantKind; name: string; installedOn: string | null; installerPartyId: string | null; maintainerPartyId: string | null; serialNumber: string | null; note: string | null; archived: boolean };

type Insert<T> = Omit<T, "id">;

export interface MaintenanceRepository {
  plants(filter: { assetId?: string; includeArchived: boolean }): Promise<PlantRow[]>;
  insertPlant(d: Insert<PlantRow>): Promise<string>;
  getPlant(id: string): Promise<PlantRow | null>;
  updatePlant(id: string, d: Partial<Insert<PlantRow>>): Promise<void>;
  plantDocumentIds(plantId: string): Promise<string[]>;
  plantDocumentLinks(plantIds: string[]): Promise<{ plantId: string; documentId: string }[]>;
  linkPlantDocument(plantId: string, documentId: string): Promise<void>;
  unlinkPlantDocument(plantId: string, documentId: string): Promise<void>;

  insertWork(d: Insert<WorkRow>): Promise<string>;
  updateWork(id: string, d: Partial<Insert<WorkRow>>): Promise<boolean>;
  getWork(id: string): Promise<WorkRow | null>;
  listWorks(filter: { assetId?: string }): Promise<WorkRow[]>;

  quotes(workId: string): Promise<QuoteRow[]>;
  quotesOf(workIds: string[]): Promise<QuoteRow[]>;
  insertQuote(d: Insert<QuoteRow>): Promise<string>;
  getQuote(id: string): Promise<QuoteRow | null>;
  updateQuote(id: string, d: Partial<Insert<QuoteRow>>): Promise<void>;
  deleteQuote(id: string): Promise<void>;

  invoices(workId: string): Promise<InvoiceRow[]>;
  invoicesOf(workIds: string[]): Promise<InvoiceRow[]>;
  insertInvoice(d: Insert<InvoiceRow>): Promise<string>;
  getInvoice(id: string): Promise<InvoiceRow | null>;
  /** Fatture pagate tra due date (estremi inclusi), con l'intervento e il bene: serve al quadro economico. */
  paidInvoicesBetween(from: string, to: string): Promise<{ invoiceId: string; paidOn: string; amountCents: number; documentId: string | null; number: string | null; workId: string; workTitle: string; assetId: string }[]>;
  updateInvoice(id: string, d: Partial<Insert<InvoiceRow>>): Promise<void>;
  deleteInvoice(id: string): Promise<void>;

  progress(workId: string): Promise<ProgressRow[]>;
  insertProgress(d: Insert<ProgressRow>): Promise<string>;
  getProgress(id: string): Promise<ProgressRow | null>;
  deleteProgress(id: string): Promise<void>;

  warranties(filter: { assetId?: string; includeArchived: boolean }): Promise<WarrantyRow[]>;
  insertWarranty(d: Insert<WarrantyRow>): Promise<string>;
  getWarranty(id: string): Promise<WarrantyRow | null>;
  updateWarranty(id: string, d: Partial<Insert<WarrantyRow>>): Promise<void>;

  plans(filter: { assetId?: string; includeArchived: boolean }): Promise<PlanRow[]>;
  insertPlan(d: Insert<PlanRow>): Promise<string>;
  getPlan(id: string): Promise<PlanRow | null>;
  updatePlan(id: string, d: Partial<Insert<PlanRow>>): Promise<void>;
}

export interface MaintenanceCollaborators {
  assets(): Promise<{ id: string; name: string }[]>;
  parties(): Promise<Map<string, string>>;
  documentTitles(): Promise<Map<string, string>>;
  /** Crea una scadenza (manuale o ricorrente) nel modulo Scadenze; restituisce il suo id. */
  createDeadline(d: {
    title: string;
    assetId: string;
    category: "technical" | "contractual";
    level: "national" | "contract";
    calc: { type: "manual"; dueOn: string } | { type: "recurring"; anchorOn: string; everyMonths: number };
    proofRequired: boolean;
  }): Promise<string | null>;
  archiveDeadline(deadlineId: string, archived: boolean): Promise<void>;
  /** Prossima data aperta e ultima eseguita di una scadenza (per il piano di ispezione). */
  deadlineDates(deadlineId: string): Promise<{ nextDueOn: string | null; lastDoneOn: string | null }>;
}

export type MaintenanceDeps = { repo: MaintenanceRepository; others: MaintenanceCollaborators; audit: AuditRecorder };
export type MaintenanceReadDeps = Pick<MaintenanceDeps, "repo" | "others">;
