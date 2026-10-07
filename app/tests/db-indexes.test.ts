import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "./helpers/test-db";

/**
 * Postgres non crea da solo un indice sulle colonne delle chiavi esterne: senza, ogni cancellazione a cascata (o ogni
 * join dal lato "figlio") diventa una scansione completa della tabella figlia, sempre piu' lenta al crescere dei dati.
 * Il test interroga il catalogo di un database migrato e fallisce se le colonne di una chiave esterna non sono il PREFISSO
 * di almeno un indice (compresi chiave primaria e vincoli univoci).
 */

/** Eccezioni esplicite, "tabella.colonne": poche e motivate. Aggiungerne una richiede una giustificazione qui. */
const EXCEPTIONS: Record<string, string> = {
  "document_category.parent_id": "tabella di riferimento con poche decine di righe, caricata dai dati iniziali e mai cancellata in massa",
  "holiday_rule.territory_id": "tabella di riferimento (poche decine di righe di regole dei festivi): un controllo sulla cancellazione di un territorio la scorre in un istante",
  "tax_type.territory_id": "tabella di riferimento (pochi tipi di tributo configurati dal proprietario): un controllo sulla cancellazione di un territorio la scorre in un istante",
};

type FkRow = { table_name: string; constraint_name: string; columns: string[] };
type IndexRow = { table_name: string; index_name: string; columns: (string | null)[] };

describe("indici sulle chiavi esterne", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  }, 120_000);
  afterAll(async () => {
    await t.close();
  });

  it("ogni colonna di chiave esterna e' il prefisso di un indice", async () => {
    const fks = (
      (await t.db.execute(sql`
        select c.conrelid::regclass::text as table_name, c.conname as constraint_name,
               array(select a.attname::text from unnest(c.conkey) with ordinality k(attnum, ord)
                     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum order by k.ord) as columns
        from pg_constraint c
        join pg_namespace n on n.oid = c.connamespace
        where c.contype = 'f' and n.nspname = 'public'`)) as unknown as { rows: FkRow[] }
    ).rows;
    const indexes = (
      (await t.db.execute(sql`
        select i.indrelid::regclass::text as table_name, ic.relname as index_name,
               array(select a.attname::text from unnest(i.indkey::int2[]) with ordinality k(attnum, ord)
                     left join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum order by k.ord) as columns
        from pg_index i
        join pg_class ic on ic.oid = i.indexrelid
        join pg_namespace n on n.oid = ic.relnamespace
        where n.nspname = 'public' and i.indpred is null`)) as unknown as { rows: IndexRow[] }
    ).rows;

    expect(fks.length).toBeGreaterThan(50); // il catalogo e' stato letto davvero

    const missing: string[] = [];
    for (const fk of fks) {
      const key = `${fk.table_name}.${fk.columns.join(",")}`;
      if (key in EXCEPTIONS) continue;
      const covered = indexes.some(
        (ix) => ix.table_name === fk.table_name && fk.columns.every((col, pos) => ix.columns[pos] === col),
      );
      if (!covered) missing.push(`${key} (vincolo ${fk.constraint_name})`);
    }
    expect(missing, `Chiavi esterne senza indice (aggiungere un index() nello schema Drizzle e generare la migrazione):\n${missing.join("\n")}`).toEqual([]);
  });

  it("le eccezioni dichiarate esistono ancora e hanno una motivazione", async () => {
    for (const [key, reason] of Object.entries(EXCEPTIONS)) {
      expect(reason.trim().length, `eccezione ${key} senza motivo`).toBeGreaterThan(10);
    }
  });
});
