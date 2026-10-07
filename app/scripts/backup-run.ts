/** Fa un backup cifrato adesso (uso: `pnpm backup:run`). Utile per pianificarlo anche fuori da Vercel. */
import type { Pool } from "pg";
import { getDb } from "../src/platform/db/client";
import { runBackup } from "../src/modules/backup";

async function main() {
  const db = getDb();
  try {
    const outcome = await runBackup(db, { type: "system", id: "backup-cli" }, "manual");
    if (!outcome.ok) throw new Error(outcome.message);
    const { run } = outcome;
    console.log(`Backup ${run.status === "warning" ? "completato con un avviso" : "completato"}: ${run.destinationKey} (${run.sizeBytes} byte, ${run.fileCount} file)`);
    if (run.message) console.warn(`Avviso: ${run.message}`);
  } finally {
    await (db as unknown as { $client: Pool }).$client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
