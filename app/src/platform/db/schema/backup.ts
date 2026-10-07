import { sql } from "drizzle-orm";
import { bigint, check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Storico dei backup (incremento 3). Registra quando e' stato fatto un archivio, dove sta e qual era l'hash
 * di testa dell'audit in quel momento: confrontarlo con quello attuale rende evidente una manomissione.
 */
export const backupRun = pgTable(
  "backup_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    trigger: text("trigger").notNull(),
    status: text("status").notNull().default("running"),
    /** Chiave dell'archivio nella destinazione dei backup. */
    destinationKey: text("destination_key"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    /** Impronta dell'archivio cifrato cosi' come e' stato scritto. */
    archiveSha256: text("archive_sha256"),
    fileCount: integer("file_count"),
    /** Ultima riga dell'audit contenuta nel backup. */
    auditSeq: bigint("audit_seq", { mode: "number" }),
    auditHash: text("audit_hash"),
    /** Messaggio di errore o avvisi (es. file mancanti nello storage). Mai dati personali. */
    message: text("message"),
  },
  (t) => [
    check("backup_run_trigger_check", sql`${t.trigger} in ('manual','scheduled')`),
    check("backup_run_status_check", sql`${t.status} in ('running','completed','warning','failed')`),
    index("backup_run_started_idx").on(t.startedAt),
  ],
);
