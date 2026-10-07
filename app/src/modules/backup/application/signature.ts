import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Autenticazione dei backup (F-06 della revisione di sicurezza). La cifratura usa solo la chiave pubblica: chi la conosce puo'
 * fabbricare un `.gibk` valido. Per questo il manifest (che contiene le impronte di ogni tabella e di ogni file, quindi copre
 * tutto l'archivio) si firma con HMAC-SHA256 usando un segreto di server dedicato, `BACKUP_SIGNING_SECRET`. La firma sta nella voce
 * `manifest.sig` subito dopo il manifest. Chi non ha il segreto non puo' produrne una valida; un archivio vecchio (senza firma)
 * si ripristina solo con un'opzione esplicita.
 */

export const SIGNATURE_PATH = "manifest.sig";
const PREFIX = "hmac-sha256:";

const keyOf = (secret: string): Buffer => createHmac("sha256", secret).update("gestione-immobili/firma-backup/v1").digest();
const macOf = (manifest: Uint8Array, secret: string): Buffer => createHmac("sha256", keyOf(secret)).update(manifest).digest();

/** Contenuto della voce `manifest.sig`. */
export function signManifest(manifest: Uint8Array, secret: string): string {
  return `${PREFIX}${macOf(manifest, secret).toString("hex")}`;
}

/** Vero solo se la firma e' ben formata e corrisponde a questo manifest e a questo segreto (confronto a tempo costante). */
export function verifyManifestSignature(manifest: Uint8Array, signature: Uint8Array, secret: string): boolean {
  const text = new TextDecoder().decode(signature).trim();
  if (!text.startsWith(PREFIX)) return false;
  const hex = text.slice(PREFIX.length);
  if (!/^[0-9a-f]{64}$/.test(hex)) return false;
  const given = Buffer.from(hex, "hex");
  const expected = macOf(manifest, secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Impronta annotata dal proprietario: 64 cifre esadecimali (maiuscole e spazi tollerati). Null se non e' una SHA-256. */
function normalizeSha256(value: string): string | null {
  const clean = value.replace(/\s+/g, "").toLowerCase();
  return /^[0-9a-f]{64}$/.test(clean) ? clean : null;
}

/** Calcola la SHA-256 del file cifrato (cosi' com'e' su disco) e rifiuta se non coincide con quella annotata fuori banda. */
export async function assertArchiveSha256(source: AsyncIterable<Uint8Array>, expected: string): Promise<void> {
  const wanted = normalizeSha256(expected);
  if (!wanted) throw new Error("L'impronta indicata non e' una SHA-256 valida (64 cifre esadecimali)");
  const hash = createHash("sha256");
  for await (const chunk of source) hash.update(chunk);
  const actual = hash.digest("hex");
  if (actual !== wanted) throw new Error("L'impronta SHA-256 del file non coincide con quella annotata: il backup potrebbe essere stato sostituito o danneggiato");
}
