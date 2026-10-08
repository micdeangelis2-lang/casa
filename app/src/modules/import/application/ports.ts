import type { Result } from "@/shared/result";
import type { ImportKind } from "../domain/columns";

/** Cio' che l'importazione si aspetta dagli altri moduli, fornito da `index.ts` (letture da `Db`, scritture dalla transazione). */
export interface ImportPorts {
  /** Contatti gia' in rubrica (anche archiviati). */
  existingParties(): Promise<{ id: string; displayName: string; taxCode: string | null; email: string | null }[]>;
  validateParty(input: unknown): Result<unknown>;
  /** Immobili gia' registrati (anche archiviati). */
  existingAssets(): Promise<{ id: string; name: string; address: string | null }[]>;
  validateAsset(input: unknown): Result<unknown>;
  /** Comuni il cui nome contiene `name` (il filtro sul nome esatto lo fa chi chiama). */
  findMunicipalities(name: string): Promise<{ id: string; name: string; label: string }[]>;

  /** Scadenze gia' registrate (anche archiviate o chiuse). */
  existingDeadlines(): Promise<{ title: string; dueOn: string; assetId: string | null }[]>;
  validateDeadline(input: unknown): Result<unknown>;

  /** Locazioni registrate (anche concluse) e le scadenze dei loro canoni. */
  existingLettings(): Promise<{ id: string; title: string }[]>;
  rentDatesOf(lettingId: string): Promise<string[]>;
  validateRent(input: unknown): Result<unknown>;
  validateRentPayment(input: unknown): Result<unknown>;

  /** Tipi di tributo (anche archiviati), voci di tributo e pagamenti gia' registrati di una voce. */
  existingTaxTypes(): Promise<{ id: string; name: string }[]>;
  existingObligations(): Promise<{ id: string; assetId: string; taxTypeId: string; year: number; label: string | null; status: "open" | "closed" }[]>;
  paymentsOf(obligationId: string): Promise<{ paidOn: string; amountCents: number }[]>;
  validateObligation(input: unknown): Result<unknown>;
  validateTaxPayment(input: unknown): Result<unknown>;

  /** Polizze gia' registrate (anche archiviate). */
  existingPolicies(): Promise<{ title: string; policyNumber: string | null; startsOn: string | null }[]>;
  validatePolicy(input: unknown): Result<unknown>;

  /** Scrive una riga «pronta» col modulo competente (dentro la transazione dell'importazione). */
  create(kind: ImportKind, payload: unknown): Promise<Result<unknown>>;
}

/** Etichette italiane per riconoscere i valori scritti a parole (oltre al codice). Fornite dal livello interfaccia. */
export type ImportLabels = {
  roles: Record<string, string>;
  kinds: Record<string, string>;
  uses: Record<string, string>;
  rights: Record<string, string>;
  categories: Record<string, string>;
  levels: Record<string, string>;
  priorities: Record<string, string>;
};

export type RowStatus = "ready" | "duplicate" | "error" | "skipped";

export type RowOutcome = {
  line: number;
  status: RowStatus;
  /** Testo che identifica la riga (nome o denominazione). */
  label: string;
  /** Per «già presente» e «errore»: il motivo. */
  message?: string;
  /** Per «errore»: l'intestazione della colonna a cui si riferisce, se nota. */
  column?: string;
};

/** `skipped`: righe di esempio del modello, mai importate. */
export type ImportCounts = { total: number; ready: number; duplicate: number; error: number; skipped: number };

export type ImportPreview = { ok: true; counts: ImportCounts; rows: RowOutcome[]; ignoredHeaders: string[] };

export type ImportFailure = { ok: false; message: string };
