import { sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, check, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { asset, territory } from "./registry";
import { document } from "./documents";

/**
 * Regole e dossier (incremento 4). Le regole sono dati: `rule` e' l'identita' stabile, `rule_version` il contenuto.
 * Una versione e' immutabile (un trigger lo impone, vedi la migrazione): solo lo stato di verifica puo' cambiare.
 */

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const rule = pgTable(
  "rule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Identita' stabile attraverso le versioni. */
    key: text("key").notNull(),
    /** Una regola non si cancella: si disattiva e resta nello storico. */
    active: boolean("active").notNull().default(true),
    createdAt,
  },
  (t) => [uniqueIndex("rule_key_uq").on(t.key)],
);

export const ruleVersion = pgTable(
  "rule_version",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => rule.id, { onDelete: "restrict" }),
    versionNo: integer("version_no").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    level: text("level").notNull(),
    territoryId: uuid("territory_id").references(() => territory.id, { onDelete: "restrict" }),
    validFrom: date("valid_from", { mode: "string" }),
    validTo: date("valid_to", { mode: "string" }),
    /** Albero JSON validato da Zod; nullo = si applica sempre. */
    appliesWhen: jsonb("applies_when").$type<unknown>(),
    outcomes: jsonb("outcomes").$type<unknown[]>().notNull(),
    sourceText: text("source_text").notNull(),
    sourceUrl: text("source_url"),
    verificationStatus: text("verification_status").notNull().default("to_verify"),
    changeNote: text("change_note"),
    supersedesVersionId: uuid("supersedes_version_id").references((): AnyPgColumn => ruleVersion.id, { onDelete: "restrict" }),
    createdAt,
  },
  (t) => [
    check("rule_version_level_check", sql`${t.level} in ('national','regional','municipal','condominium','contract')`),
    check("rule_version_verification_check", sql`${t.verificationStatus} in ('draft','to_verify','verified_by_owner','validated_by_professional')`),
    uniqueIndex("rule_version_no_uq").on(t.ruleId, t.versionNo),
    index("rule_version_territory_idx").on(t.territoryId),
    index("rule_version_supersedes_version_idx").on(t.supersedesVersionId),
  ],
);

/** Categorie del dossier (sezione 6 del prompt), a dati. */
export const dossierCategory = pgTable(
  "dossier_category",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    createdAt,
  },
  (t) => [uniqueIndex("dossier_category_code_uq").on(t.code)],
);

/**
 * Voce del dossier di un bene. Puo' essere manuale o derivata da una regola. La derivazione (titolo, categoria,
 * spiegazione, versione) la aggiorna il motore; lo stato, la nota e i documenti collegati sono SOLO del proprietario.
 */
export const dossierItem = pgTable(
  "dossier_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => asset.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => dossierCategory.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    status: text("status").notNull().default("missing"),
    origin: text("origin").notNull(),
    ruleKey: text("rule_key"),
    outcomeKey: text("outcome_key"),
    ruleVersionId: uuid("rule_version_id").references(() => ruleVersion.id, { onDelete: "restrict" }),
    /** Categoria documentale attesa (codice di document_category), se la regola la indica. */
    expectedDocumentCategory: text("expected_document_category"),
    ruleNote: text("rule_note"),
    explanation: jsonb("explanation").$type<unknown>(),
    /** La regola che l'aveva prodotta non si applica piu': la voce resta, decide il proprietario. */
    stale: boolean("stale").notNull().default(false),
    ownerNote: text("owner_note"),
    createdAt,
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check(
      "dossier_item_status_check",
      sql`${t.status} in ('present','missing','requested','to_verify','expired','superseded','not_applicable','validated_by_professional')`,
    ),
    check("dossier_item_origin_check", sql`${t.origin} in ('manual','rule')`),
    check("dossier_item_rule_check", sql`(${t.origin} = 'rule') = (${t.ruleKey} is not null and ${t.outcomeKey} is not null)`),
    uniqueIndex("dossier_item_rule_uq").on(t.assetId, t.ruleKey, t.outcomeKey).where(sql`${t.origin} = 'rule'`),
    index("dossier_item_asset_idx").on(t.assetId),
    index("dossier_item_category_idx").on(t.categoryId),
    index("dossier_item_rule_version_idx").on(t.ruleVersionId),
  ],
);

export const dossierItemDocument = pgTable(
  "dossier_item_document",
  {
    itemId: uuid("item_id")
      .notNull()
      .references(() => dossierItem.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => document.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("dossier_item_document_uq").on(t.itemId, t.documentId), index("dossier_item_document_doc_idx").on(t.documentId)],
);
