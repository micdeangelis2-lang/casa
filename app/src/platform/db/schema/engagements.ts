import { sql } from "drizzle-orm";
import { bigint, check, date, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { asset, party } from "./registry";
import { document } from "./documents";
import { matter } from "./matters";

/**
 * Incarichi a un professionista e elaborati scambiati. L'incarico e' un dato scritto dal proprietario: oggetto, data, compenso
 * dichiarato (mai calcolato ne' valutato dall'app), stato. Gli elaborati sono consegne e ricezioni con un tipo libero e, se c'e',
 * il documento. Nessun elenco di prestazioni o tariffe e' scritto nel codice.
 */

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const engagement = pgTable(
  "engagement",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Il professionista (contatto della rubrica). */
    partyId: uuid("party_id")
      .notNull()
      .references(() => party.id, { onDelete: "restrict" }),
    assetId: uuid("asset_id").references(() => asset.id, { onDelete: "set null" }),
    matterId: uuid("matter_id").references(() => matter.id, { onDelete: "set null" }),
    subject: text("subject").notNull(),
    engagedOn: date("engaged_on", { mode: "string" }).notNull(),
    /** Compenso dichiarato dal proprietario, in centesimi (facoltativo). */
    declaredFeeCents: bigint("declared_fee_cents", { mode: "number" }),
    status: text("status").notNull().default("active"),
    /** La lettera o il contratto d'incarico. */
    documentId: uuid("document_id").references(() => document.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt,
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check("engagement_status_check", sql`${t.status} in ('active','completed','cancelled')`),
    check("engagement_fee_check", sql`${t.declaredFeeCents} is null or ${t.declaredFeeCents} >= 0`),
    index("engagement_party_idx").on(t.partyId),
    index("engagement_asset_idx").on(t.assetId),
    index("engagement_matter_idx").on(t.matterId),
    index("engagement_document_idx").on(t.documentId),
  ],
);

/** Elaborato di un incarico: consegnato al professionista o ricevuto da lui. */
export const matterDeliverable = pgTable(
  "matter_deliverable",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    engagementId: uuid("engagement_id")
      .notNull()
      .references(() => engagement.id, { onDelete: "cascade" }),
    direction: text("direction").notNull(),
    /** Tipo scritto dal proprietario (relazione, planimetria, bozza, parere...). */
    kindLabel: text("kind_label").notNull(),
    occurredOn: date("occurred_on", { mode: "string" }).notNull(),
    documentId: uuid("document_id").references(() => document.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt,
  },
  (t) => [
    check("matter_deliverable_direction_check", sql`${t.direction} in ('delivered','received')`),
    index("matter_deliverable_engagement_idx").on(t.engagementId, t.occurredOn),
    index("matter_deliverable_document_idx").on(t.documentId),
  ],
);
