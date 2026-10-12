/**
 * Inizializza i tipi di tributo italiani predefiniti nel database.
 * Uso: `pnpm tax-types:seed`
 * Idempotente: i tipi gia' presenti per nome vengono saltati.
 */
import type { Pool } from "pg";
import { getDb } from "../src/platform/db/client";
import { runInUnitOfWork } from "../src/platform/db/unit-of-work";
import { seedDefaultTaxTypes } from "../src/modules/taxes";

async function main() {
  const db = getDb();
  try {
    const result = await runInUnitOfWork(db, { type: "system", id: "tax-types-seed" }, (uow) => seedDefaultTaxTypes(uow));
    if (!result.ok) throw new Error(Object.values(result.errors).flat().join("; "));
    console.log(`Inizializzazione tipi di tributo completata: ${result.value.created} creati, ${result.value.skipped} gia' presenti.`);
  } finally {
    await (db as unknown as { $client: Pool }).$client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
