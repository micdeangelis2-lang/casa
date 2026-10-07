import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  check,
  customType,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { asset, party } from "./registry";

/**
 * Documenti (incremento 2). Il file vive nello storage (`file_object.storage_key`), il database tiene i metadati.
 * Una nuova versione non cancella la precedente. La cancellazione e' logica (`archived_at`): i file restano.
 */

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** Categorie documentali a dati: nessuna categoria e' scritta nel codice. */
export const documentCategory = pgTable(
  "document_category",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => documentCategory.id, { onDelete: "restrict" }),
    position: integer("position").notNull().default(0),
    createdAt,
  },
  (t) => [uniqueIndex("document_category_code_uq").on(t.code)],
);

/** Byte conservati nello storage: chiave, impronta e tipo verificato sui byte (non sull'estensione). */
export const fileObject = pgTable(
  "file_object",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storageKey: text("storage_key").notNull(),
    sha256: text("sha256").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    mimeType: text("mime_type").notNull(),
    createdAt,
  },
  (t) => [uniqueIndex("file_object_key_uq").on(t.storageKey), index("file_object_sha_idx").on(t.sha256)],
);

export const document = pgTable(
  "document",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => documentCategory.id, { onDelete: "restrict" }),
    confidentiality: text("confidentiality").notNull().default("ordinary"),
    notes: text("notes"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt,
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check("document_confidentiality_check", sql`${t.confidentiality} in ('ordinary','reserved','highly_reserved')`),
    index("document_title_idx").on(t.title),
    index("document_category_idx").on(t.categoryId),
  ],
);

export const documentVersion = pgTable(
  "document_version",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => document.id, { onDelete: "cascade" }),
    versionNo: integer("version_no").notNull(),
    fileObjectId: uuid("file_object_id")
      .notNull()
      .references(() => fileObject.id, { onDelete: "restrict" }),
    originalFilename: text("original_filename").notNull(),
    issuedOn: date("issued_on", { mode: "string" }),
    validFrom: date("valid_from", { mode: "string" }),
    validTo: date("valid_to", { mode: "string" }),
    issuerPartyId: uuid("issuer_party_id").references(() => party.id, { onDelete: "set null" }),
    verificationStatus: text("verification_status").notNull().default("to_verify"),
    note: text("note"),
    /** Testo incorporato nel file (PDF), se estraibile. Non e' mai scritto nei log ne' nell'audit. */
    extractedText: text("extracted_text"),
    /** Indice di ricerca (dizionario italiano), calcolato dal database. */
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('italian', coalesce(extracted_text, ''))`,
    ),
    createdAt,
  },
  (t) => [
    check(
      "document_version_verification_check",
      sql`${t.verificationStatus} in ('draft','to_verify','verified_by_owner','validated_by_professional')`,
    ),
    uniqueIndex("document_version_no_uq").on(t.documentId, t.versionNo),
    index("document_version_search_idx").using("gin", t.searchVector),
    index("document_version_issuer_idx").on(t.issuerPartyId),
    index("document_version_file_object_idx").on(t.fileObjectId),
  ],
);

/** Documento <-> bene (n:n): un documento puo' riguardare piu' beni. */
export const documentAsset = pgTable(
  "document_asset",
  {
    documentId: uuid("document_id")
      .notNull()
      .references(() => document.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => asset.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.documentId, t.assetId] }), index("document_asset_asset_idx").on(t.assetId)],
);
