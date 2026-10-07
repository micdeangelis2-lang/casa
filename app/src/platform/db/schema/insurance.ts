import { sql } from "drizzle-orm";
import { bigint, check, date, index, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { asset, party } from "./registry";
import { document } from "./documents";
import { deadline } from "./deadlines";
import { matter } from "./matters";

/**
 * Assicurazioni e sinistri (incremento 9). Polizze, garanzie, premi e sinistri sono dati inseriti dal proprietario:
 * l'app non interpreta le condizioni di polizza e non stabilisce mai se un sinistro sia coperto o quanto sara' liquidato.
 */

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true })
  .notNull()
  .defaultNow()
  .$onUpdate(() => new Date());

export const insPolicy = pgTable(
  "ins_policy",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    insurerPartyId: uuid("insurer_party_id").references(() => party.id, { onDelete: "set null" }),
    /** Agente o intermediario, se c'e'. */
    agentPartyId: uuid("agent_party_id").references(() => party.id, { onDelete: "set null" }),
    policyNumber: text("policy_number"),
    startsOn: date("starts_on"),
    endsOn: date("ends_on"),
    /** Premio annuo indicato dal proprietario (facoltativo): i premi con scadenza stanno in `ins_premium`. */
    premiumCents: bigint("premium_cents", { mode: "number" }),
    note: text("note"),
    documentId: uuid("document_id").references(() => document.id, { onDelete: "set null" }),
    deadlineId: uuid("deadline_id").references(() => deadline.id, { onDelete: "set null" }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (t) => [check("ins_policy_dates_check", sql`${t.startsOn} is null or ${t.endsOn} is null or ${t.endsOn} >= ${t.startsOn}`), check("ins_policy_premium_check", sql`${t.premiumCents} is null or ${t.premiumCents} >= 0`), index("ins_policy_ends_idx").on(t.endsOn), index("ins_policy_insurer_party_idx").on(t.insurerPartyId), index("ins_policy_agent_party_idx").on(t.agentPartyId), index("ins_policy_document_idx").on(t.documentId), index("ins_policy_deadline_idx").on(t.deadlineId)],
);

/** Una polizza puo' riguardare piu' beni. */
export const insPolicyAsset = pgTable(
  "ins_policy_asset",
  {
    policyId: uuid("policy_id")
      .notNull()
      .references(() => insPolicy.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => asset.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.policyId, t.assetId] }), index("ins_policy_asset_asset_idx").on(t.assetId)],
);

/** Garanzia copiata a mano dalla polizza: titolo, somma assicurata, franchigia. L'app non ne interpreta il significato. */
export const insCoverage = pgTable(
  "ins_coverage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => insPolicy.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    sumInsuredCents: bigint("sum_insured_cents", { mode: "number" }),
    deductibleCents: bigint("deductible_cents", { mode: "number" }),
    note: text("note"),
    createdAt,
  },
  (t) => [check("ins_coverage_amounts_check", sql`(${t.sumInsuredCents} is null or ${t.sumInsuredCents} >= 0) and (${t.deductibleCents} is null or ${t.deductibleCents} >= 0)`), index("ins_coverage_policy_idx").on(t.policyId)],
);

export const insPremium = pgTable(
  "ins_premium",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => insPolicy.id, { onDelete: "cascade" }),
    dueOn: date("due_on").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    paidOn: date("paid_on"),
    /** La ricevuta del pagamento. */
    documentId: uuid("document_id").references(() => document.id, { onDelete: "set null" }),
    deadlineId: uuid("deadline_id").references(() => deadline.id, { onDelete: "set null" }),
    createdAt,
  },
  (t) => [check("ins_premium_amount_check", sql`${t.amountCents} >= 0`), index("ins_premium_policy_idx").on(t.policyId), index("ins_premium_due_idx").on(t.dueOn), index("ins_premium_document_idx").on(t.documentId), index("ins_premium_deadline_idx").on(t.deadlineId)],
);

export const insClaim = pgTable(
  "ins_claim",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => insPolicy.id, { onDelete: "restrict" }),
    assetId: uuid("asset_id").references(() => asset.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    claimNumber: text("claim_number"),
    occurredOn: date("occurred_on").notNull(),
    reportedOn: date("reported_on"),
    status: text("status").notNull().default("open"),
    /** Importi scritti dal proprietario: richiesto e ricevuto. L'app non prevede cosa verra' liquidato. */
    claimedCents: bigint("claimed_cents", { mode: "number" }),
    receivedCents: bigint("received_cents", { mode: "number" }),
    adjusterPartyId: uuid("adjuster_party_id").references(() => party.id, { onDelete: "set null" }),
    matterId: uuid("matter_id").references(() => matter.id, { onDelete: "set null" }),
    description: text("description"),
    closedOn: date("closed_on"),
    createdAt,
    updatedAt,
  },
  (t) => [
    check("ins_claim_status_check", sql`${t.status} in ('open','reported','in_review','settled','closed')`),
    check("ins_claim_amounts_check", sql`(${t.claimedCents} is null or ${t.claimedCents} >= 0) and (${t.receivedCents} is null or ${t.receivedCents} >= 0)`),
    index("ins_claim_policy_idx").on(t.policyId),
    index("ins_claim_asset_idx").on(t.assetId),
    index("ins_claim_adjuster_party_idx").on(t.adjusterPartyId),
    index("ins_claim_matter_idx").on(t.matterId),
  ],
);

/** Comunicazioni del sinistro: cosa e' stato inviato, ricevuto o annotato, con il documento. */
export const insClaimEntry = pgTable(
  "ins_claim_entry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => insClaim.id, { onDelete: "cascade" }),
    entryOn: date("entry_on").notNull(),
    direction: text("direction").notNull().default("note"),
    summary: text("summary").notNull(),
    documentId: uuid("document_id").references(() => document.id, { onDelete: "set null" }),
    createdAt,
  },
  (t) => [check("ins_claim_entry_direction_check", sql`${t.direction} in ('sent','received','note')`), index("ins_claim_entry_claim_idx").on(t.claimId), index("ins_claim_entry_document_idx").on(t.documentId)],
);
