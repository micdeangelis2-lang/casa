/**
 * Ripristina un backup cifrato in un ambiente NUOVO e VUOTO, oppure lo verifica soltanto.
 *
 * Uso:
 *   pnpm backup:restore --archive <file.gibk> --key <chiave-privata.pem> [--verify-only]
 *
 * Prima di ripristinare: database appena creato e migrato (`pnpm db:migrate`), cartella dei file vuota.
 * Con --verify-only decifra e controlla tutte le impronte senza scrivere nulla (si puo' fare anche su un ambiente in uso).
 * Il ripristino rifiuta un database che contiene gia' dati, e annulla tutto se un'impronta o la catena dell'audit non tornano.
 */
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import type { Pool } from "pg";
import { getDb } from "../src/platform/db/client";
import { LocalFileStorage } from "../src/platform/storage";
import { decryptStream, restoreFromArchive } from "../src/modules/backup";

async function main() {
  const { values } = parseArgs({
    options: { archive: { type: "string" }, key: { type: "string" }, "verify-only": { type: "boolean", default: false } },
  });
  if (!values.archive || !values.key) throw new Error("Uso: pnpm backup:restore --archive <file.gibk> --key <chiave-privata.pem> [--verify-only]");

  const privateKey = await readFile(values.key, "utf8");
  const storage = new LocalFileStorage(process.env.STORAGE_DIR || ".storage");
  const db = getDb();
  try {
    const dryRun = values["verify-only"] === true;
    const report = await restoreFromArchive(db, storage, decryptStream(createReadStream(values.archive), privateKey), { dryRun });
    console.log(dryRun ? "Archivio verificato (nessun dato scritto)." : "Ripristino completato.");
    console.log(`Creato il ${report.manifest.createdAt}; ${Object.keys(report.tables).length} tabelle, ${report.files} file.`);
    for (const [table, rows] of Object.entries(report.tables)) console.log(`  ${table}: ${rows}`);
    if (report.manifest.missingFiles.length > 0) console.warn(`Attenzione: ${report.manifest.missingFiles.length} file mancavano gia' al momento del backup.`);
    if (report.manifest.auditHead) console.log(`Audit: catena integra fino alla riga ${report.manifest.auditHead.seq}.`);
  } finally {
    await (db as unknown as { $client: Pool }).$client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
