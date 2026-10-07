/**
 * Interfaccia pubblica del modulo Backup: archivio cifrato con chiave pubblica (backup), esportazione completa in chiaro
 * senza credenziali, storico dei backup e ripristino su un ambiente vuoto. Le scritture ricevono un `Db` e un attore:
 * il modulo apre da se' le sue unita' di lavoro, perche' il lavoro lungo non deve stare dentro una transazione.
 */
import type { AuditActor } from "@/platform/audit";
import { getBackupEnv } from "@/platform/config/env";
import type { Db } from "@/platform/db/types";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { getStorage, type StoragePort } from "@/platform/storage";
import { decryptStream, encryptStream, generateBackupKeyPair } from "@/shared/archive/crypto";
import { createArchive } from "./application/archive";
import { performBackup } from "./application/backup";
import type { BackupDestination, BackupRunRow } from "./application/ports";
import { restoreArchive } from "./application/restore";
import { drizzleBackupRunRepository } from "./infrastructure/drizzle-backup-run-repository";
import { LocalBackupDestination } from "./infrastructure/local-destination";
import { postgresRestoreTarget, postgresSnapshotReader } from "./infrastructure/postgres-snapshot";

export type { BackupRunRow, BackupDestination } from "./application/ports";
export type { RestoreReport } from "./application/restore";
export type { Manifest } from "./domain/archive";
export { generateBackupKeyPair, decryptStream, encryptStream };

export type BackupSettings = { destination: BackupDestination; publicKey: string | undefined; keep: number };

/** Impostazioni lette dall'ambiente; nei test si passano esplicitamente. */
export function backupSettingsFromEnv(): BackupSettings {
  const env = getBackupEnv();
  return { destination: new LocalBackupDestination(env.BACKUP_DIR), publicKey: env.BACKUP_PUBLIC_KEY, keep: env.BACKUP_KEEP };
}

export type BackupOutcome = { ok: true; run: BackupRunRow } | { ok: false; message: string };

/** Fa un backup cifrato adesso e ne registra l'esito (e nell'audit). Non lancia: l'errore e' nell'esito. */
export async function runBackup(
  db: Db,
  actor: AuditActor,
  trigger: "manual" | "scheduled",
  options: { storage?: StoragePort; settings?: BackupSettings } = {},
): Promise<BackupOutcome> {
  const storage = options.storage ?? getStorage();
  const settings = options.settings ?? backupSettingsFromEnv();
  const runs = drizzleBackupRunRepository(db);

  const id = await runInUnitOfWork(db, actor, async (uow) => {
    const runId = await drizzleBackupRunRepository(uow.tx).insertRunning(trigger);
    await uow.audit.record({ action: "backup.start", entityType: "backup", entityId: runId, diff: { trigger } });
    return runId;
  });

  try {
    const result = await performBackup({ reader: postgresSnapshotReader(db), storage, ...settings });
    await runInUnitOfWork(db, actor, async (uow) => {
      await drizzleBackupRunRepository(uow.tx).complete(id, result);
      await uow.audit.record({
        action: "backup.complete",
        entityType: "backup",
        entityId: id,
        diff: { sizeBytes: result.sizeBytes, files: result.fileCount, warning: result.message !== null },
      });
    });
    const run = await runs.get(id);
    return { ok: true, run: run! };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Errore sconosciuto";
    await runInUnitOfWork(db, actor, async (uow) => {
      await drizzleBackupRunRepository(uow.tx).fail(id, message);
      await uow.audit.record({ action: "backup.fail", entityType: "backup", entityId: id, diff: {} });
    });
    return { ok: false, message };
  }
}

/** Esportazione completa in chiaro (senza credenziali): registra l'evento e restituisce il flusso ZIP. */
export async function createExport(db: Db, actor: AuditActor, storage: StoragePort = getStorage()) {
  const archive = await createArchive({ reader: postgresSnapshotReader(db), storage }, { includeAuth: false });
  await runInUnitOfWork(db, actor, (uow) =>
    uow.audit.record({
      action: "backup.export",
      entityType: "backup",
      entityId: "export",
      diff: { files: Object.keys(archive.manifest.files).length, missingFiles: archive.manifest.missingFiles.length },
    }),
  );
  return archive;
}

export const listBackupRuns = (db: Db, limit = 30) => drizzleBackupRunRepository(db).list(limit);
export const getBackupRun = (db: Db, id: string) => drizzleBackupRunRepository(db).get(id);
export const currentAuditHead = (db: Db) => drizzleBackupRunRepository(db).currentAuditHead();

/** Apre un backup per scaricarlo (resta cifrato). */
export async function openBackupArchive(destination: BackupDestination, key: string) {
  return destination.get(key);
}

/** Ripristina un archivio gia' decifrato in un ambiente vuoto (o, con `dryRun`, lo verifica soltanto). */
export function restoreFromArchive(db: Db, storage: StoragePort, source: AsyncIterable<Uint8Array>, options: { dryRun?: boolean } = {}) {
  return restoreArchive({ target: postgresRestoreTarget(db), storage }, source, options);
}
