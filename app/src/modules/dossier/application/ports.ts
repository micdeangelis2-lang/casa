import type { AuditRecorder } from "@/platform/audit";
import type { DerivedChecklistItem, DerivedDeadline, Facts, RuleWithVersions } from "@/modules/rules";
import type { DossierStatus } from "../domain/dossier";

export type CategoryRow = { id: string; code: string; name: string };

export type ItemRow = {
  id: string;
  assetId: string;
  categoryId: string;
  title: string;
  status: DossierStatus;
  origin: "manual" | "rule";
  ruleKey: string | null;
  outcomeKey: string | null;
  ruleVersionId: string | null;
  expectedDocumentCategory: string | null;
  ruleNote: string | null;
  explanation: unknown;
  stale: boolean;
  ownerNote: string | null;
  documentIds: string[];
};

export interface DossierRepository {
  listCategories(): Promise<CategoryRow[]>;
  itemsForAsset(assetId: string): Promise<ItemRow[]>;
  getItem(id: string): Promise<ItemRow | null>;
  insertDerived(assetId: string, categoryId: string, item: DerivedChecklistItem): Promise<string>;
  updateDerivation(id: string, categoryId: string, item: DerivedChecklistItem): Promise<void>;
  setStale(id: string, stale: boolean): Promise<void>;
  insertManual(assetId: string, categoryId: string, title: string, ownerNote: string | undefined): Promise<string>;
  setStatus(id: string, status: DossierStatus): Promise<void>;
  setOwnerNote(id: string, note: string | null): Promise<void>;
  deleteManual(id: string): Promise<boolean>;
  link(itemId: string, documentId: string): Promise<void>;
  unlink(itemId: string, documentId: string): Promise<void>;
}

export type DocumentInfo = { id: string; title: string; validTo: string | null; archived: boolean };

export interface DossierCollaborators {
  /** Fatti del bene e catena dei suoi territori; null se il bene non esiste o e' archiviato. */
  factsFor(assetId: string, asOf: string): Promise<{ facts: Facts; territoryChain: ReadonlySet<string> } | null>;
  activeRules(): Promise<RuleWithVersions[]>;
  documents(ids: string[]): Promise<DocumentInfo[]>;
  /** Documenti collegabili (non archiviati), per i selettori. */
  linkableDocuments(): Promise<DocumentInfo[]>;
  /** Categorie documentali: codice -> nome. */
  documentCategoryNames(): Promise<Map<string, string>>;
  assetName(assetId: string): Promise<string | null>;
  /** Allinea le scadenze derivate dalle regole (modulo Scadenze). Solo nelle scritture. */
  syncDeadlines(assetId: string, derived: DerivedDeadline[], asOf: string): Promise<void>;
  activeAssetIds(): Promise<string[]>;
}

export type DossierDeps = { repo: DossierRepository; others: DossierCollaborators; audit: AuditRecorder };
export type DossierReadDeps = Pick<DossierDeps, "repo" | "others">;

export type EvaluationDiff = { created: number; updated: number; restored: number; staled: number; unchanged: number; skipped: number };
