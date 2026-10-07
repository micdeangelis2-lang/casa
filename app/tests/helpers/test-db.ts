import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { resolve } from "node:path";
import * as schema from "@/platform/db/schema";
import type { Db } from "@/platform/db/types";

export type TestDb = { db: Db; close: () => Promise<void> };

const migrationsFolder = resolve(__dirname, "../../drizzle");

/**
 * I test cancellano lo schema `public`: rifiutano qualunque database
 * il cui nome non contenga "test", per non toccare mai dati reali.
 */
function assertDisposableDatabase(url: string): void {
  const dbName = new URL(url).pathname.replace(/^\//, "");
  if (!/test/i.test(dbName)) {
    throw new Error(
      `TEST_DATABASE_URL punta a "${dbName}": i test distruggono lo schema, il nome del database deve contenere "test".`,
    );
  }
}

/**
 * Database per i test di integrazione.
 * - Con `TEST_DATABASE_URL` usa un Postgres reale (CI): lo schema viene ricreato da zero.
 * - Altrimenti usa PGlite, un Postgres in-process: nessun Docker, nessun account.
 * La stessa suite gira in entrambi i modi.
 */
export async function createTestDb(options: { inMemory?: boolean } = {}): Promise<TestDb> {
  const url = process.env.TEST_DATABASE_URL;
  // `inMemory` serve ai test che hanno bisogno di un secondo database indipendente (es. ripristino di un backup).
  if (url && !options.inMemory) {
    assertDisposableDatabase(url);
    const pool = new Pool({ connectionString: url, max: 2 });
    await pool.query("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
    const db = drizzlePg(pool, { schema });
    await migratePg(db, { migrationsFolder });
    return { db, close: () => pool.end() };
  }
  const client = new PGlite();
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder });
  return { db, close: () => client.close() };
}
