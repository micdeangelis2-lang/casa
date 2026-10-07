import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

/**
 * Tipo comune a tutti i driver (node-postgres in produzione, PGlite nei test)
 * e alle transazioni: i repository dipendono da questo, mai dal driver.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
