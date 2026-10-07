import { sql } from "drizzle-orm";
import { bigint, check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Registro di audit append-only con catena di hash.
 *
 * `seq`, `at`, `prev_hash` e `hash` sono assegnati da un trigger BEFORE INSERT
 * (vedi la migrazione `audit_chain`): l'applicazione non puo' fornirli ne' falsificarli.
 * I default qui servono solo a rendere gli insert tipizzabili; il trigger li sovrascrive.
 *
 * Garanzia: rende evidente (non impossibile) una manomissione. Chi ha accesso da
 * proprietario del database puo' disattivare i trigger: per questo l'hash di testa
 * deve essere incluso nei backup e mostrato nell'interfaccia.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    seq: bigint("seq", { mode: "number" }).primaryKey().notNull().default(0),
    id: uuid("id").notNull().unique().defaultRandom(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    diff: jsonb("diff").$type<Record<string, unknown>>().notNull().default({}),
    prevHash: text("prev_hash").notNull().default(""),
    hash: text("hash").notNull().default(""),
  },
  // `action like 'area.%'` (elenco filtrato per area e suo conteggio): in un database non-C solo text_pattern_ops puo' usare l'indice.
  (t) => [check("audit_log_actor_type_check", sql`${t.actorType} in ('owner','system')`), index("audit_log_action_idx").on(t.action.op("text_pattern_ops"))],
);

