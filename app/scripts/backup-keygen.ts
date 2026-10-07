/**
 * Genera la coppia di chiavi per cifrare i backup (uso: `pnpm backup:keygen [percorso-chiave-privata.pem]`).
 * - La chiave PRIVATA si scrive in un file (non sovrascrive nulla) e va custodita FUORI da questo computer e dal server:
 *   chi la perde non riapre piu' i backup, e nessuno (nemmeno io) puo' recuperarla.
 * - La chiave PUBBLICA si stampa gia' pronta per BACKUP_PUBLIC_KEY (una riga sola, con i ritorni a capo come \n).
 */
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { generateBackupKeyPair } from "../src/modules/backup";

async function main() {
  const target = resolve(process.argv[2] ?? "backup-private-key.pem");
  const { publicKey, privateKey } = generateBackupKeyPair();
  // flag "wx": fallisce se il file esiste gia', cosi' non si perde per errore una chiave in uso.
  await writeFile(target, privateKey, { flag: "wx", mode: 0o600 });

  console.log(`Chiave PRIVATA scritta in: ${target}`);
  console.log("Spostala subito in un posto sicuro fuori da questo computer (gestore di password, chiavetta) e cancella la copia qui.\n");
  console.log("Aggiungi questa riga a .env.local (e alle variabili d'ambiente di produzione):\n");
  console.log(`BACKUP_PUBLIC_KEY="${publicKey.trim().replace(/\n/g, "\\n")}"`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
