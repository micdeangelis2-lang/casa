/**
 * Importa l'elenco ufficiale dei Comuni italiani (ISTAT) nella gerarchia dei territori.
 * Uso: `pnpm territory:import` (scarica da ISTAT) oppure `pnpm territory:import percorso/Elenco-comuni-italiani.csv`.
 * Idempotente: si puo' rilanciare per aggiornare i dati; lo stato di verifica deciso dall'utente non si tocca.
 */
import { readFile } from "node:fs/promises";
import type { Pool } from "pg";
import { getDb } from "../src/platform/db/client";
import { runInUnitOfWork } from "../src/platform/db/unit-of-work";
import { importIstat, parseIstatCsv } from "../src/modules/territory";

const ISTAT_URL = "https://www.istat.it/storage/codici-unita-amministrative/Elenco-comuni-italiani.csv";

async function loadCsv(path: string | undefined): Promise<string> {
  // Il file ISTAT e' in ISO-8859-1.
  if (path) return new TextDecoder("latin1").decode(await readFile(path));
  const response = await fetch(ISTAT_URL);
  if (!response.ok) throw new Error(`Download ISTAT non riuscito: HTTP ${response.status}`);
  return new TextDecoder("latin1").decode(await response.arrayBuffer());
}

async function main() {
  const rows = parseIstatCsv(await loadCsv(process.argv[2]));
  console.log(`Letti ${rows.length} Comuni dall'elenco ISTAT.`);
  const db = getDb();
  try {
    const result = await runInUnitOfWork(db, { type: "system", id: "istat-import" }, (uow) => importIstat(uow, rows));
    if (!result.ok) throw new Error(Object.values(result.errors).flat().join("; "));
    console.log(`Importazione completata: ${result.value.territories} territori creati o aggiornati.`);
  } finally {
    await (db as unknown as { $client: Pool }).$client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
