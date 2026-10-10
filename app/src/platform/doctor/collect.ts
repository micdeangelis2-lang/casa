/**
 * Raccolta dei dati per la diagnosi dell'installazione (usata da `scripts/doctor.ts` e dalla pagina Impostazioni > Stato).
 * Sola lettura sul database; `probeFolder` crea e cancella un piccolo file di prova nella cartella indicata.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { auditHead, verifyAuditChain } from "../audit";
import type { Db } from "../db/types";
import type { DoctorInput, FolderProbe } from "./checks";

type Rows<T> = { rows: T[] };
export type DoctorCollected = Pick<DoctorInput, "database" | "migrations" | "ownerCount" | "lastBackupAt" | "audit">;

export async function probeFolder(folder: string): Promise<FolderProbe> {
  const dir = resolve(/*turbopackIgnore: true*/ folder);
  const file = resolve(/*turbopackIgnore: true*/ dir, `.doctor-${randomUUID()}.tmp`);
  try {
    await mkdir(/*turbopackIgnore: true*/ dir, { recursive: true });
    await writeFile(/*turbopackIgnore: true*/ file, "ok");
    return { dir, writable: true };
  } catch {
    return { dir, writable: false };
  } finally {
    await rm(/*turbopackIgnore: true*/ file, { force: true });
  }
}

export async function collectDatabase(db: Db, journalPath: string): Promise<DoctorCollected> {
  const started = performance.now();
  try {
    await db.execute(sql`select 1`);
  } catch {
    return { database: { connected: false }, migrations: null, ownerCount: null, lastBackupAt: null, audit: null };
  }
  const latencyMs = Math.round(performance.now() - started);

  const journal = (JSON.parse(await readFile(/*turbopackIgnore: true*/ journalPath, "utf8")) as { entries: { tag: string; when: number }[] }).entries;
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
