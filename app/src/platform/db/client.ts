import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getServerEnv } from "../config/env";
import * as schema from "./schema";
import type { Db } from "./types";

// Il singleton sta su globalThis, non in una variabile di modulo: Next.js puo' istanziare lo stesso modulo
// una volta per ogni livello (pagine, route handler, azioni) e ogni copia aprirebbe un proprio pool.
const globalForDb = globalThis as typeof globalThis & { __gestioneImmobiliDb?: Db };

/**
 * Connessione lazy (nessun Proxy: rompe le librerie che ispezionano l'adattatore).
 * Si usa il driver TCP `pg` con il pooler di Neon perche' servono transazioni
 * interattive: modifica + riga di audit nella stessa transazione.
 */
export function getDb(): Db {
  return (globalForDb.__gestioneImmobiliDb ??= createDb());
}

function createDb(): Db {
  const env = getServerEnv();
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    idleTimeoutMillis: 10_000,
  });
  return drizzle(pool, { schema });
}
