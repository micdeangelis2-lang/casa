/**
 * Diagnosi dell'installazione (uso: `pnpm doctor`, opzione `--prod` per applicare le regole di produzione).
 * Raccoglie i dati dall'ambiente reale e li passa alla logica pura in `src/platform/doctor`.
 * Sola lettura sul database; nelle due cartelle (documenti, backup) crea e cancella un piccolo file di prova.
 * Esce con 1 se c'e' almeno un errore.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { auditHead, verifyAuditChain } from "../src/platform/audit";
import { getDb } from "../src/platform/db/client";
import type { Db } from "../src/platform/db/types";
import { formatReport, runChecks, type DoctorInput, type FolderProbe } from "../src/platform/doctor/checks";

type Rows<T> = { rows: T[] };
type Collected = Pick<DoctorInput, "database" | "migrations" | "ownerCount" | "lastBackupAt" | "audit">;

async function probeFolder(dir: string): Promise<FolderProbe> {
  const file = resolve(dir, `.doctor-${randomUUID()}.tmp`);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(file, "ok");
    return { dir, writable: true };
  } catch {
    return { dir, writable: false };
  } finally {
    await rm(file, { force: true });
  }
}

async function collectDatabase(db: Db): Promise<Collected> {
  const started = performance.now();
  try {
    await db.execute(sql`select 1`);
  } catch {
    return { database: { connected: false }, migrations: null, ownerCount: null, lastBackupAt: null, audit: null };
  }
  const latencyMs = Math.round(performance.now() - started);

  const journal = (JSON.parse(await readFile(resolve(__dirname, "../drizzle/meta/_journal.json"), "utf8")) as { entries: { tag: string; when: number }[] }).entries;
  let appliedMillis: number[] | null = null;
  try {
    const applied = (await db.execute(sql`select created_at from drizzle.__drizzle_migrations`)) as unknown as Rows<{ created_at: string | number }>;
    appliedMillis = applied.rows.map((r) => Number(r.created_at));
  } catch {
    appliedMillis = null; // tabella assente: nessuna migrazione applicata
  }

  // Le tabelle dell'app esistono solo se le migrazioni sono state applicate.
  let ownerCount: number | null = null;
  let lastBackupAt: Date | null | undefined = null;
  let audit: DoctorInput["audit"] = null;
  if (appliedMillis !== null) {
    try {
      const owners = (await db.execute(sql`select count(*) as total from "user"`)) as unknown as Rows<{ total: string }>;
      ownerCount = Number(owners.rows[0]?.total ?? 0);
      const backups = (await db.execute(
        sql`select finished_at from backup_run where status in ('completed','warning') and finished_at is not null order by finished_at desc limit 1`,
      )) as unknown as Rows<{ finished_at: Date | string }>;
      lastBackupAt = backups.rows[0] ? new Date(backups.rows[0].finished_at) : undefined;
      const chain = await verifyAuditChain(db);
      if (chain.intact) {
        const head = await auditHead(db);
        audit = { intact: true, rows: chain.rows, headSeq: head?.seq ?? null, headHash: chain.headHash };
      } else {
        audit = chain;
      }
    } catch {
      // Schema incompleto: lo segnala il controllo delle migrazioni; qui restano «non verificabili».
    }
  }
  return { database: { connected: true, latencyMs }, migrations: { journal, appliedMillis }, ownerCount, lastBackupAt, audit };
}

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
    const collected: Collected = db
      ? await collectDatabase(db)
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
