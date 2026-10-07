import type { StoragePort } from "@/platform/storage";

export type SnapshotTable = { name: string; ndjson: string; rows: number };

/** Fotografia coerente del database in un istante (una sola transazione di sola lettura). */
export type Snapshot = {
  tables: SnapshotTable[];
  auditHead: { seq: number; hash: string } | null;
  /** Impronte delle migrazioni applicate, in ordine. */
  migrations: string[];
};

export interface SnapshotReader {
  read(includeAuth: boolean): Promise<Snapshot>;
}

/** Scrive i dati di un archivio in un database vuoto, in un'unica transazione. */
export interface RestoreTarget {
  migrations(): Promise<string[]>;
  /** Nomi delle tabelle (tra quelle indicate) che contengono gia' dei dati. */
  nonEmptyTables(tables: readonly string[]): Promise<string[]>;
  /**
   * Inserisce le tabelle nell'ordine dato e verifica la catena dell'audit contro `expectedHead`.
   * Se qualcosa non torna annulla tutto (nessun dato a meta').
   */
  restore(tables: SnapshotTable[], expectedHead: { seq: number; hash: string } | null): Promise<void>;
}

/** Dove finiscono gli archivi cifrati dei backup. Oggi il disco; un secondo fornitore sara' un altro adattatore. */
export interface BackupDestination {
  put(key: string, source: AsyncIterable<Uint8Array>): Promise<{ sizeBytes: number; sha256: string }>;
  get(key: string): Promise<ReadableStream<Uint8Array> | null>;
  /** Chiavi presenti, dalla piu' vecchia alla piu' recente (le chiavi iniziano con la data). */
  list(): Promise<string[]>;
  delete(key: string): Promise<void>;
}

export type BackupRunRow = {
  id: string;
  startedAt: Date;
  finishedAt: Date | null;
  trigger: "manual" | "scheduled";
  status: "running" | "completed" | "warning" | "failed";
  destinationKey: string | null;
  sizeBytes: number | null;
  archiveSha256: string | null;
  fileCount: number | null;
  auditSeq: number | null;
  auditHash: string | null;
  message: string | null;
};

export type RunResult = {
  destinationKey: string;
  sizeBytes: number;
  archiveSha256: string;
  fileCount: number;
  auditSeq: number | null;
  auditHash: string | null;
  message: string | null;
};

export interface BackupRunRepository {
  insertRunning(trigger: "manual" | "scheduled"): Promise<string>;
  complete(id: string, result: RunResult): Promise<void>;
  fail(id: string, message: string): Promise<void>;
  list(limit: number): Promise<BackupRunRow[]>;
  get(id: string): Promise<BackupRunRow | null>;
  /** Ultima riga dell'audit adesso, per confrontarla con quella dei backup. */
  currentAuditHead(): Promise<{ seq: number; hash: string } | null>;
}

export type ArchiveDeps = { reader: SnapshotReader; storage: StoragePort };
export type BackupDeps = ArchiveDeps & {
  destination: BackupDestination;
  publicKey: string | undefined;
  keep: number;
  /** Segreto con cui si firma il manifest (F-06). Senza, il backup parte ma non e' autenticato. */
  signingSecret?: string | undefined;
};
