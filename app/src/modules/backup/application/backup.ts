import { randomBytes } from "node:crypto";
import { encryptStream } from "@/shared/archive/crypto";
import { createArchive } from "./archive";
import type { BackupDeps, RunResult } from "./ports";

// Con i millisecondi: l'ordine alfabetico dei nomi deve coincidere con l'ordine di creazione (serve alla rotazione).
const stamp = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(".", "");
const BACKUP_KEY = /^backup-\d{8}T\d{9}Z-[0-9a-f]{8}\.gibk$/;

/**
 * Crea il backup cifrato nella destinazione e toglie i piu' vecchi oltre `keep`.
 * Senza chiave pubblica non parte: un backup in chiaro dei dati personali e delle credenziali non e' un'opzione.
 */
export async function performBackup(deps: BackupDeps, now = new Date()): Promise<RunResult> {
  if (!deps.publicKey) throw new Error("Manca BACKUP_PUBLIC_KEY: genera la coppia di chiavi con `pnpm backup:keygen`");

  const { manifest, stream } = await createArchive(deps, { includeAuth: true, now, signingSecret: deps.signingSecret });
  const key = `backup-${stamp(now)}-${randomBytes(4).toString("hex")}.gibk`;
  const written = await deps.destination.put(key, encryptStream(stream, deps.publicKey));

  // La potatura viene dopo la scrittura riuscita: un backup fallito non deve mai costare quelli buoni.
  const keys = (await deps.destination.list()).filter((k) => BACKUP_KEY.test(k));
  for (const old of keys.slice(0, Math.max(0, keys.length - deps.keep))) {
    if (old !== key) await deps.destination.delete(old);
  }

  const missing = manifest.missingFiles.length;
  return {
    destinationKey: key,
    sizeBytes: written.sizeBytes,
    archiveSha256: written.sha256,
    fileCount: Object.keys(manifest.files).length,
    auditSeq: manifest.auditHead?.seq ?? null,
    auditHash: manifest.auditHead?.hash ?? null,
    message: missing > 0 ? `${missing} file indicati dal database mancano dallo storage e non sono nel backup` : null,
  };
}
