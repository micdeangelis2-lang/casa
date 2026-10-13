import { getStorage, type StoragePort } from "@/platform/storage";
import { MAX_FILE_BYTES } from "@/modules/documents/client";

/**
 * Caricamento diretto dal browser verso lo storage ("staged upload"): su Vercel una richiesta non supera ~4,5 MB, quindi con
 * Blob configurato il browser carica il file in `staging/<uuid>` e la azione del server lo rilegge da li' per passarlo ai casi
 * d'uso di sempre (che validano dimensione e tipo dai byte e lo scrivono con la chiave definitiva `documents/<uuid>`).
 */
export const STAGING_KEY_PATTERN = /^staging\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Vero se la chiave ha la forma `staging/<uuid-v4 minuscolo>`: niente nome originale, niente estensione. */
export const isStagingKey = (key: string): boolean => STAGING_KEY_PATTERN.test(key);

/** Il caricamento diretto e' attivo solo con lo store Blob collegato; il valore si passa alle pagine come prop. */
export const directUploadEnabled = (): boolean => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

export type StagedFile = { name: string; bytes: Uint8Array };
export type StagedRead = { ok: true; file: StagedFile } | { ok: false; error: string };

const MAX_NAME_LENGTH = 255;

/** Legge il flusso fino a `limit` byte; oltre, annulla la lettura e restituisce null. */
async function readCapped(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Valida la chiave di staging e ne legge i byte (tetto `MAX_FILE_BYTES`). Gli errori sono messaggi per l'utente.
 * `name` e' il nome originale scelto dal browser: serve solo come etichetta, non entra mai nella chiave.
 */
export async function readStagedFile(
  key: string,
  name: string,
  storage: StoragePort = getStorage(),
  limit: number = MAX_FILE_BYTES,
): Promise<StagedRead> {
  if (!isStagingKey(key)) return { ok: false, error: "Il file caricato non è valido. Riprova a caricarlo." };
  const stream = await storage.get(key);
  if (!stream) return { ok: false, error: "Il file caricato non è stato trovato. Riprova a caricarlo." };
  const bytes = await readCapped(stream, limit);
  if (!bytes) return { ok: false, error: `Il file supera il limite di ${limit / (1024 * 1024)} MB` };
  if (bytes.length === 0) return { ok: false, error: "Il file è vuoto" };
  const cleanName = name.replace(/[\\/\u0000-\u001f]/g, "_").trim().slice(0, MAX_NAME_LENGTH);
  return { ok: true, file: { name: cleanName || "documento", bytes } };
}

/** Cancella il file di staging (successo o errore dell'azione). Mai un errore: un residuo non deve rompere l'esito. */
export async function discardStagedFile(key: string, storage: StoragePort = getStorage()): Promise<void> {
  if (!isStagingKey(key)) return;
  try {
    await storage.delete(key);
  } catch {
    // Residuo in staging: innocuo (nome casuale, mai collegato a un documento).
  }
}
