/**
 * Diagnosi dell'installazione (uso: `pnpm doctor`, opzione `--prod` per applicare le regole di produzione).
 * Raccoglie i dati dall'ambiente reale e li passa alla logica pura in `src/platform/doctor`.
 * Sola lettura sul database; nelle due cartelle (documenti, backup) crea e cancella un piccolo file di prova.
 * Esce con 1 se c'e' almeno un errore.
 */
import { resolve } from "node:path";
import type { Pool } from "pg";
import { getDb } from "../src/platform/db/client";
import type { Db } from "../src/platform/db/types";
import { formatReport, runChecks, type DoctorInput } from "../src/platform/doctor/checks";
import { collectDatabase, probeFolder, type DoctorCollected } from "../src/platform/doctor/collect";

async function main(): Promise<void> {
  const env = process.env;
  const production = process.argv.includes("--prod") || env.NODE_ENV === "production" || env.VERCEL_ENV === "production";

  // Con una DATABASE_URL non valida getDb() lancia: lo spiega il controllo delle variabili.
  let db: Db | null = null;
  try {
    db = getDb();
  } catch {
    db = null;
  }

  try {
    const collected: DoctorCollected = db
      ? await collectDatabase(db, resolve(__dirname, "../drizzle/meta/_journal.json"))
      : { database: null, migrations: null, ownerCount: null, lastBackupAt: null, audit: null };
    const input: DoctorInput = {
      env,
      production,
      now: new Date(),
      ...collected,
      storage: await probeFolder(resolve(env.STORAGE_DIR || ".storage")),
      backupDir: await probeFolder(resolve(env.BACKUP_DIR || "backups")),
    };
    const { text, exitCode } = formatReport(runChecks(input));
    console.log(text);
    process.exitCode = exitCode;
  } finally {
    if (db) await (db as unknown as { $client: Pool }).$client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
