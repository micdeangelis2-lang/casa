/**
 * Database di SVILUPPO locale (`pnpm dev:db`): Postgres in-process (PGlite) con i dati su disco in `.pglite/`,
 * esposto su un socket. Serve finche' non c'e' un branch Neon: nessun Docker, nessun account.
 *
 * Limiti: PGlite non e' Postgres vero e regge poche connessioni (il pool dell'app va tenuto a 1).
 * Chiudilo con Ctrl+C, non uccidendo il processo: serve a scrivere i dati in modo pulito.
 * Per ripartire da zero cancella la cartella `.pglite/`.
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { resolve } from "node:path";

const PORT = 54320;
const DATA_DIR = resolve(__dirname, "../.pglite");

async function main() {
  const db = new PGlite(DATA_DIR);
  await migrate(drizzle(db), { migrationsFolder: resolve(__dirname, "../drizzle") });

  const server = new PGLiteSocketServer({ db, port: PORT, host: "127.0.0.1", maxConnections: 2 });
  await server.start();
  console.log(`Database di sviluppo pronto su 127.0.0.1:${PORT} (dati in ${DATA_DIR})`);

  const shutdown = async () => {
    await server.stop();
    await db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
