import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { asset, party } from "./registry";
import { document } from "./documents";

/**
 * Mandato di vendita o affitto a un agente immobiliare, con le visite e le proposte che il proprietario registra. L'app non
 * stima prezzi, non valuta proposte e non conserva dati personali di chi visita: al piu' un contatto della rubrica scelto dal proprietario.
 */

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const listingEngagement = pgTable(
  "listing_engagement",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => asset.id, { onDelete: "cascade" }),
    /** `sale` (vendita) o `rent` (affitto). */
    kind: text("kind").notNull(),
    agentPartyId: uuid("agent_party_id").references(() => party.id, { onDelete: "set null" }),
    startsOn: date("starts_on", { mode: "string" }),
    endsOn: date("ends_on", { mode: "string" }),
    exclusive: boolean("exclusive").notNull().default(false),
    /** Prezzo o canone richiesto, come lo scrive il proprietario. */
    askingCents: bigint("asking_cents", { mode: "number" }),
    /** Provvigione scritta come testo dal proprietario. */
    commission: text("commission"),
    documentId: uuid("document_id").references(() => document.id, { onDelete: "set null" }),
    note: text("note"),
    status: text("status").notNull().default("active"),
    createdAt,
  },
  (t) => [
    check("listing_engagement_kind_check", sql`${t.kind} in ('sale','rent')`),
    check("listing_engagement_status_check", sql`${t.status} in ('active','ended')`),
    check("listing_engagement_asking_check", sql`${t.askingCents} is null or ${t.askingCents} >= 0`),
    check("listing_engagement_dates_check", sql`${t.startsOn} is null or ${t.endsOn} is null or ${t.endsOn} >= ${t.startsOn}`),
    index("listing_engagement_asset_idx").on(t.assetId),
    index("listing_engagement_agent_party_idx").on(t.agentPartyId),
    index("listing_engagement_document_idx").on(t.documentId),
  ],
);

/** Visita, proposta, controproposta o nota di un mandato. */
export const listingEvent = pgTable(
  "listing_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    engagementId: uuid("engagement_id")
      .notNull()
      .references(() => listingEngagement.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    occurredOn: date("occurred_on", { mode: "string" }).notNull(),
    /** Importo di una proposta o controproposta. */
    amountCents: bigint("amount_cents", { mode: "number" }),
    /** Esito di una proposta, scelto dal proprietario. */
    outcome: text("outcome"),
    contactPartyId: uuid("contact_party_id").references(() => party.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt,
  },
  (t) => [
    check("listing_event_kind_check", sql`${t.kind} in ('visit','proposal','counterproposal','note')`),
    check("listing_event_outcome_check", sql`${t.outcome} is null or ${t.outcome} in ('open','accepted','rejected','withdrawn')`),
    check("listing_event_amount_check", sql`${t.amountCents} is null or ${t.amountCents} >= 0`),
    index("listing_event_engagement_idx").on(t.engagementId, t.occurredOn),
    index("listing_event_contact_party_idx").on(t.contactPartyId),
  ],
);
