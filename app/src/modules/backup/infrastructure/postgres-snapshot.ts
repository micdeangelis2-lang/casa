import { sql } from "drizzle-orm";
import type { Db } from "@/platform/db/types";
import { SEEDED_TABLES, tablesFor } from "../domain/archive";
import type { RestoreTarget, Snapshot, SnapshotReader, SnapshotTable } from "../application/ports";

/** I due driver (node-postgres e PGlite) restituiscono le righe in forme leggermente diverse. */
export function rowsOf<T>(result: unknown): T[] {
  const rows = (result as { rows?: T[] }).rows;
  return rows ?? (result as T[]);
}

/**
 * Ordine di lettura per tabella: deterministico, e per le tabelle che puntano a se stesse (gerarchie)
 * i genitori vengono prima dei figli, cosi' il reinserimento rispetta le chiavi esterne.
 */
const ORDER_BY: Record<string, string> = {
  territory: `case kind when 'country' then 0 when 'region' then 1 when 'province' then 2 when 'municipality' then 3 else 4 end, id`,
  document_category: `(parent_id is not null), id`,
  document_asset: `document_id, asset_id`,
  // Le versioni di una regola si reinseriscono in ordine di numero: una puo' sostituire la precedente.
  rule_version: `rule_id, version_no`,
  dossier_item_document: `item_id, document_id`,
  app_setting: `key`,
  matter_assignment: `matter_id, party_id`,
  matter_document: `matter_id, document_id`,
  plant_document: `plant_id, document_id`,
  millesimal_share: `table_id, asset_id`,
  condo_agenda_document: `agenda_item_id, document_id`,
  condo_document: `condominium_id, document_id`,
  ins_policy_asset: `policy_id, asset_id`,
  ins_claim_document: `claim_id, document_id`,
  letting_party: `letting_id, party_id`,
  audit_log: `seq`,
};

/** Un nome di tabella ammesso e' uno di quelli noti: mai testo arrivato da fuori. */
function assertKnownTable(name: string): string {
  if (!tablesFor(true).includes(name)) throw new Error(`Tabella non prevista nell'archivio: ${name}`);
  return `"${name}"`;
}

async function insertableColumns(db: Db, table: string): Promise<string[]> {
  const result = await db.execute(
    sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = ${table} and is_generated = 'NEVER' order by ordinal_position`,
  );
  return rowsOf<{ column_name: string }>(result).map((r) => r.column_name);
}

async function readMigrations(db: Db): Promise<string[]> {
  const result = await db.execute(sql`select hash from drizzle.__drizzle_migrations order by id`);
  return rowsOf<{ hash: string }>(result).map((r) => r.hash);
}

export function postgresSnapshotReader(db: Db): SnapshotReader {
  return {
    async read(includeAuth): Promise<Snapshot> {
      // Una sola transazione di sola lettura con istantanea fissa: le tabelle sono coerenti tra loro.
      return db.transaction(
        async (tx) => {
          const tables: SnapshotTable[] = [];
          for (const name of tablesFor(includeAuth)) {
            const quoted = assertKnownTable(name);
            const columns = (await insertableColumns(tx, name)).map((c) => `"${c}"`).join(", ");
            const order = ORDER_BY[name] ?? "id";
            const result = await tx.execute(sql.raw(`select row_to_json(x)::text as line from (select ${columns} from ${quoted} order by ${order}) x`));
            const lines = rowsOf<{ line: string }>(result).map((r) => r.line);
            tables.push({ name, ndjson: lines.join("\n"), rows: lines.length });
          }
          const head = rowsOf<{ seq: string | number; hash: string }>(await tx.execute(sql`select seq, hash from audit_log order by seq desc limit 1`))[0];
          return {
            tables,
            auditHead: head ? { seq: Number(head.seq), hash: head.hash } : null,
            migrations: await readMigrations(tx),
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },
  };
}

const BATCH_ROWS = 500;
const BATCH_BYTES = 4_000_000;

export function postgresRestoreTarget(db: Db): RestoreTarget {
  return {
    migrations: () => readMigrations(db),

    async nonEmptyTables(tables) {
      const busy: string[] = [];
      for (const name of tables) {
        if (SEEDED_TABLES.includes(name)) continue;
        const result = await db.execute(sql.raw(`select 1 as one from ${assertKnownTable(name)} limit 1`));
        if (rowsOf(result).length > 0) busy.push(name);
      }
      return busy;
    },

    async restore(tables, expectedHead) {
      await db.transaction(async (tx) => {
        // Il trigger della catena riassegnerebbe seq, istante e hash: si spegne solo per questa transazione
        // (si riaccende prima del commit) cosi' le righe di audit tornano identiche, e poi si verifica la catena.
        await tx.execute(sql`alter table audit_log disable trigger audit_log_chain`);
        // I dati di partenza delle migrazioni lasciano il posto a quelli dell'archivio.
        for (const name of tables.map((t) => t.name).filter((n) => SEEDED_TABLES.includes(n)).reverse()) {
          await tx.execute(sql.raw(`delete from ${assertKnownTable(name)}`));
        }
        for (const table of tables) {
          if (table.rows === 0) continue;
          const quoted = assertKnownTable(table.name);
          const columns = (await insertableColumns(tx, table.name)).map((c) => `"${c}"`).join(", ");
          const lines = table.ndjson.split("\n");
          for (let start = 0; start < lines.length; ) {
            // Lotti limitati per numero di righe e per dimensione (il testo estratto dei PDF puo' essere grande).
            let end = start;
            let size = 0;
            while (end < lines.length && end - start < BATCH_ROWS && (end === start || size + lines[end]!.length < BATCH_BYTES)) {
              size += lines[end]!.length;
              end += 1;
            }
            const batch = `[${lines.slice(start, end).join(",")}]`;
            await tx.execute(
              sql`${sql.raw(`insert into ${quoted} (${columns}) select ${columns} from json_populate_recordset(null::${quoted}, `)}${batch}::json)`,
            );
            start = end;
          }
        }
        await tx.execute(sql`alter table audit_log enable trigger audit_log_chain`);

        const broken = rowsOf<{ seq: string | number | null }>(await tx.execute(sql`select audit_log_verify() as seq`))[0]?.seq;
        if (broken !== null && broken !== undefined) throw new Error(`La catena dell'audit ripristinata non e' integra (riga ${broken})`);
        const head = rowsOf<{ seq: string | number; hash: string }>(await tx.execute(sql`select seq, hash from audit_log order by seq desc limit 1`))[0];
        const actual = head ? { seq: Number(head.seq), hash: head.hash } : null;
        if (JSON.stringify(actual) !== JSON.stringify(expectedHead)) throw new Error("L'hash di testa dell'audit ripristinato non corrisponde a quello dell'archivio");
      });
    },
  };
}
