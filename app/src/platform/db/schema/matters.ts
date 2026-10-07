import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { asset, party } from "./registry";
import { document, documentVersion } from "./documents";

/**
 * Pratiche e condivisione (incremento 6). Una pratica raccoglie contatti incaricati, richieste di documenti e pareri
 * (informativi o validati formalmente). I pacchetti documentali si generano per un destinatario e restano nel registro.
 */

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true })
  .notNull()
  .defaultNow()
  .$onUpdate(() => new Date());

export const matter = pgTable(
  "matter",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    description: text("description"),
    assetId: uuid("asset_id").references(() => asset.id, { onDelete: "set null" }),
    status: text("status").notNull().default("open"),
    openedOn: date("opened_on", { mode: "string" }).notNull(),
    closedOn: date("closed_on", { mode: "string" }),
    /** Ufficio destinatario (contatto della rubrica), numero di protocollo, data di presentazione e termine di risposta COMUNICATO: dati inseriti dal proprietario, mai calcolati. */
    officePartyId: uuid("office_party_id").references(() => party.id, { onDelete: "set null" }),
    protocolNumber: text("protocol_number"),
    submittedOn: date("submitted_on", { mode: "string" }),
    responseDueOn: date("response_due_on", { mode: "string" }),
    createdAt,
    updatedAt,
  },
  (t) => [
    check("matter_status_check", sql`${t.status} in ('open','in_progress','waiting','closed')`),
    index("matter_asset_idx").on(t.assetId),
    index("matter_office_party_idx").on(t.officePartyId),
  ],
);

/** Fatti della pratica registrati dal proprietario: note, udienze, termini, comunicazioni, incontri. */
export const matterEvent = pgTable(
  "matter_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matter.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    occurredOn: date("occurred_on", { mode: "string" }).notNull(),
    title: text("title").notNull(),
    note: text("note"),
    partyId: uuid("party_id").references(() => party.id, { onDelete: "set null" }),
    documentId: uuid("document_id").references(() => document.id, { onDelete: "set null" }),
    createdAt,
  },
  (t) => [
    check("matter_event_kind_check", sql`${t.kind} in ('note','hearing','term','communication','meeting')`),
    index("matter_event_matter_idx").on(t.matterId, t.occurredOn),
    index("matter_event_party_idx").on(t.partyId),
    index("matter_event_document_idx").on(t.documentId),
  ],
);

export const matterAssignment = pgTable(
  "matter_assignment",
  {
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matter.id, { onDelete: "cascade" }),
    partyId: uuid("party_id")
      .notNull()
      .references(() => party.id, { onDelete: "restrict" }),
    /** Ruolo in questa pratica (es. «perito», «legale»), facoltativo. */
    role: text("role"),
    createdAt,
  },
  (t) => [primaryKey({ columns: [t.matterId, t.partyId] }), index("matter_assignment_party_idx").on(t.partyId)],
);

export const matterDocumentRequest = pgTable(
  "matter_document_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matter.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    requestedFromPartyId: uuid("requested_from_party_id").references(() => party.id, { onDelete: "set null" }),
    status: text("status").notNull().default("requested"),
    requestedOn: date("requested_on", { mode: "string" }).notNull(),
    dueOn: date("due_on", { mode: "string" }),
    /** Il documento ricevuto, quando arriva. */
    documentId: uuid("document_id").references(() => document.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt,
    updatedAt,
  },
  (t) => [check("matter_request_status_check", sql`${t.status} in ('requested','received','not_available')`), index("matter_request_matter_idx").on(t.matterId), index("matter_document_request_requested_from_party_idx").on(t.requestedFromPartyId), index("matter_document_request_document_idx").on(t.documentId)],
);

/** Parere di un professionista: informativo, oppure validato formalmente. Mai una conclusione automatica dell'app. */
export const professionalOpinion = pgTable(
  "professional_opinion",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matter.id, { onDelete: "cascade" }),
    partyId: uuid("party_id")
      .notNull()
      .references(() => party.id, { onDelete: "restrict" }),
    nature: text("nature").notNull(),
    summary: text("summary").notNull(),
    issuedOn: date("issued_on", { mode: "string" }),
    documentId: uuid("document_id").references(() => document.id, { onDelete: "set null" }),
    createdAt,
  },
  (t) => [check("professional_opinion_nature_check", sql`${t.nature} in ('informational','formally_validated')`), index("professional_opinion_matter_idx").on(t.matterId), index("professional_opinion_party_idx").on(t.partyId), index("professional_opinion_document_idx").on(t.documentId)],
);

/** Documenti collegati a una pratica. */
export const matterDocument = pgTable(
  "matter_document",
  {
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matter.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => document.id, { onDelete: "restrict" }),
  },
  (t) => [primaryKey({ columns: [t.matterId, t.documentId] }), index("matter_document_document_idx").on(t.documentId)],
);

/** Pacchetto documentale per un destinatario: contenuto, tetto di riservatezza e impronte. Il file ZIP non si conserva. */
export const sharePackage = pgTable(
  "share_package",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipientType: text("recipient_type").notNull(),
    recipientName: text("recipient_name").notNull(),
    confidentialityCap: text("confidentiality_cap").notNull(),
    note: text("note"),
    fileCount: integer("file_count").notNull().default(0),
    totalBytes: bigint("total_bytes", { mode: "number" }).notNull().default(0),
    /** Istantanea di cio' che e' stato condiviso (destinatario, documenti con i loro metadati di quel momento): lo scarico serve ESATTAMENTE questa. */
    snapshot: jsonb("snapshot").$type<unknown>().notNull(),
    /** Impronta del manifest generato dall'istantanea. */
    manifestSha256: text("manifest_sha256").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt,
  },
  (t) => [
    check("share_package_recipient_check", sql`${t.recipientType} in ('administrator','technician','lawyer','notary','accountant','insurer','tenant','manager','agent','other')`),
    check("share_package_cap_check", sql`${t.confidentialityCap} in ('ordinary','reserved','highly_reserved')`),
  ],
);

export const sharePackageItem = pgTable(
  "share_package_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    packageId: uuid("package_id")
      .notNull()
      .references(() => sharePackage.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => document.id, { onDelete: "restrict" }),
    versionId: uuid("version_id")
      .notNull()
      .references(() => documentVersion.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    /** Percorso nel file ZIP. */
    path: text("path").notNull(),
    sha256: text("sha256").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    /** Riservatezza del documento al momento della condivisione. */
    confidentiality: text("confidentiality").notNull(),
    /** Il documento superava il tetto ed e' stato incluso comunque dal proprietario, dopo l'avviso. */
    overrideAboveCap: boolean("override_above_cap").notNull().default(false),
  },
  (t) => [check("share_package_item_confidentiality_check", sql`${t.confidentiality} in ('ordinary','reserved','highly_reserved')`), uniqueIndex("share_package_item_uq").on(t.packageId, t.versionId), index("share_package_item_document_idx").on(t.documentId), index("share_package_item_version_idx").on(t.versionId)],
);

/** Registro degli eventi di un pacchetto (creazione, scarichi, revoca). */
export const shareLog = pgTable(
  "share_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    packageId: uuid("package_id")
      .notNull()
      .references(() => sharePackage.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("share_log_event_check", sql`${t.event} in ('created','downloaded','revoked')`), index("share_log_package_idx").on(t.packageId)],
);
