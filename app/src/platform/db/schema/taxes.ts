import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { asset, territory } from "./registry";
import { document } from "./documents";
import { deadline } from "./deadlines";

/**
 * Tributi e pagamenti (incremento 8). Importi, scadenze e tipi di tributo sono DATI inseriti dal proprietario: l'app non
 * contiene aliquote ne' calcola quanto sia dovuto. Registra cosa e' atteso (a mano), cosa e' stato pagato e con quale prova.
 */

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true })
  .notNull()
  .defaultNow()
  .$onUpdate(() => new Date());

/** Un tipo di tributo/onere scritto dal proprietario (nome libero, ambito territoriale facoltativo, fonte). */
export const taxType = pgTable(
  "tax_type",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    kind: text("kind").notNull().default("tax"),
    territoryId: uuid("territory_id").references(() => territory.id, { onDelete: "set null" }),
    /** Da dove viene l'informazione (sito, comunicazione, consulente): serve a ritrovarla, non a dimostrarla. */
    source: text("source"),
    notes: text("notes"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (t) => [check("tax_type_kind_check", sql`${t.kind} in ('tax','levy','due','other')`), index("tax_type_name_idx").on(t.name)],
);

/** Quanto e' atteso per un bene, un tipo e un anno. L'importo atteso lo scrive il proprietario (o e' vuoto). */
export const taxObligation = pgTable(
  "tax_obligation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => asset.id, { onDelete: "cascade" }),
    taxTypeId: uuid("tax_type_id")
      .notNull()
      .references(() => taxType.id, { onDelete: "restrict" }),
    year: integer("year").notNull(),
    /** Distingue piu' voci dello stesso tipo nello stesso anno (acconto, saldo, rata). */
    label: text("label"),
    dueOn: date("due_on"),
    expectedCents: bigint("expected_cents", { mode: "number" }),
    status: text("status").notNull().default("open"),
    closedOn: date("closed_on"),
    closedNote: text("closed_note"),
    /** «Da chiedere al consulente»: finisce nel riepilogo da consegnare. */
    askAdviser: boolean("ask_adviser").notNull().default(false),
    note: text("note"),
    deadlineId: uuid("deadline_id").references(() => deadline.id, { onDelete: "set null" }),
    createdAt,
    updatedAt,
  },
  (t) => [
    check("tax_obligation_status_check", sql`${t.status} in ('open','closed')`),
    check("tax_obligation_year_check", sql`${t.year} between 1900 and 2200`),
    check("tax_obligation_expected_check", sql`${t.expectedCents} is null or ${t.expectedCents} >= 0`),
    index("tax_obligation_asset_year_idx").on(t.assetId, t.year),
    index("tax_obligation_year_idx").on(t.year),
    index("tax_obligation_deadline_idx").on(t.deadlineId),
    index("tax_obligation_tax_type_idx").on(t.taxTypeId),
  ],
);

export const taxPayment = pgTable(
  "tax_payment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    obligationId: uuid("obligation_id")
      .notNull()
      .references(() => taxObligation.id, { onDelete: "cascade" }),
    paidOn: date("paid_on").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    method: text("method").notNull().default("other"),
    /** Natura del pagamento, scelta dal proprietario: ordinario, correzione di un pagamento tardivo, altro. L'app non la deduce. */
    kind: text("kind").notNull().default("ordinary"),
    /** Di cui sanzioni e interessi, come dichiarati dal proprietario (nullo = non dichiarati). */
    penaltyCents: bigint("penalty_cents", { mode: "number" }),
    interestCents: bigint("interest_cents", { mode: "number" }),
    /** Riferimento del pagamento (CRO, numero di operazione...). */
    reference: text("reference"),
    /** La prova di pagamento: un documento dell'archivio. */
    documentId: uuid("document_id").references(() => document.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt,
  },
  (t) => [
    check("tax_payment_amount_check", sql`${t.amountCents} > 0`),
    check("tax_payment_method_check", sql`${t.method} in ('bank_transfer','direct_debit','card','cash','payment_slip','other')`),
    check("tax_payment_kind_check", sql`${t.kind} in ('ordinary','late_payment_correction','other')`),
    check("tax_payment_extras_check", sql`(${t.penaltyCents} is null or ${t.penaltyCents} >= 0) and (${t.interestCents} is null or ${t.interestCents} >= 0)`),
    index("tax_payment_obligation_idx").on(t.obligationId),
    index("tax_payment_document_idx").on(t.documentId),
  ],
);

/** Dichiarazione o comunicazione: scadenza, data di presentazione, protocollo, ricevuta. */
export const taxReturn = pgTable(
  "tax_return",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    taxTypeId: uuid("tax_type_id").references(() => taxType.id, { onDelete: "set null" }),
    assetId: uuid("asset_id").references(() => asset.id, { onDelete: "set null" }),
    year: integer("year").notNull(),
    dueOn: date("due_on"),
    filedOn: date("filed_on"),
    protocol: text("protocol"),
    documentId: uuid("document_id").references(() => document.id, { onDelete: "set null" }),
    askAdviser: boolean("ask_adviser").notNull().default(false),
    note: text("note"),
    deadlineId: uuid("deadline_id").references(() => deadline.id, { onDelete: "set null" }),
    createdAt,
    updatedAt,
  },
  (t) => [check("tax_return_year_check", sql`${t.year} between 1900 and 2200`), index("tax_return_year_idx").on(t.year), index("tax_return_tax_type_idx").on(t.taxTypeId), index("tax_return_asset_idx").on(t.assetId), index("tax_return_document_idx").on(t.documentId), index("tax_return_deadline_idx").on(t.deadlineId)],
);
