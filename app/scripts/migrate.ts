import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { resolve } from "node:path";
import { getDb } from "../src/platform/db/client";

/** Applica le migrazioni in `drizzle/` al database di DATABASE_URL (uso: `pnpm db:migrate`). */
async function main(): Promise<void> {
  // getDb() e' tipizzato sul tipo comune ai driver; qui si sa che e' node-postgres con il suo pool.
  const db = getDb() as unknown as NodePgDatabase & { $client: Pool };
  try {
    await migrate(db, { migrationsFolder: resolve(__dirname, "../drizzle") });
    console.log("Migrazioni applicate.");
  } finally {
    // Chiusura ordinata del pool: niente connessioni troncate lato server.
    await db.$client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
