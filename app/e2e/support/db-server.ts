/**
 * Postgres in-process (PGlite) esposto su un socket TCP per i test e2e: nessun Docker, nessun account.
 * Avviato da Playwright (webServer) prima dell'app. Il database vive solo in memoria.
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { runInUnitOfWork } from "../../src/platform/db/unit-of-work";
import { importIstat } from "../../src/modules/territory";
import { E2E_DB_PORT, E2E_DB_READY_PORT } from "./env";

async function main() {
  const db = new PGlite();
  await migrate(drizzle(db), { migrationsFolder: resolve(__dirname, "../../drizzle") });

  // Territori di prova (nomi neutri): servono ai test del registro. Il vero elenco ISTAT si importa con `pnpm territory:import`.
  const row = (n: number, name: string) => ({
    regionCode: "90",
    regionName: "Regione Esempio",
    provinceCode: "900",
    provinceName: "Provincia Esempio",
    provinceSigla: "EX",
    municipalityCode: String(900000 + n),
    municipalityName: name,
    cadastralCode: `Z${100 + n}`,
  });
  const seeded = await runInUnitOfWork(drizzle(db) as never, { type: "system", id: "e2e-seed" }, (uow) =>
    importIstat(uow, [row(1, "Comune Alfa"), row(2, "Comune Beta")]),
  );
  if (!seeded.ok) throw new Error("Seed dei territori di prova non riuscito");

  // Predefinito: una sola connessione. Due: l'app (pool a 1) e il test dell'audit che interroga il database.
  // I test sono seriali, quindi le due connessioni non si sovrappongono mai davvero.
  const server = new PGLiteSocketServer({ db, port: E2E_DB_PORT, host: "127.0.0.1", maxConnections: 2 });
  await server.start();
  console.log(`PGlite pronto su 127.0.0.1:${E2E_DB_PORT}`);

  // Playwright verifica la prontezza aprendo e chiudendo connessioni TCP: sul socket di PGlite
  // una connessione che si chiude senza aver parlato rompe quelle successive.
  // Per questo la prontezza si segnala su una porta HTTP separata, mai sul socket del database.
  const ready = createServer((_request, response) => response.end("ok"));
  await new Promise<void>((done) => ready.listen(E2E_DB_READY_PORT, "127.0.0.1", done));

  const shutdown = async () => {
    ready.close();
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
