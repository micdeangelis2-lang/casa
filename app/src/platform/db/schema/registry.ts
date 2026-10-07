import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Anagrafiche di base (incremento 1): territori, rubrica, beni.
 * I valori ammessi per `kind`, `roles`, `right_type`... sono validati dal dominio (Zod) e protetti
 * da vincoli CHECK solo dove il valore e' un insieme chiuso e stabile. Le categorie normative restano dati.
 */

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/** Gerarchia territoriale a dati: nessun Comune e' scritto nel codice. */
export const territory = pgTable(
  "territory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => territory.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    /** Codice ISTAT (regione, unita' sovracomunale o Comune). */
    code: text("code"),
    /** Codice catastale (Belfiore) del Comune. */
    cadastralCode: text("cadastral_code"),
    /** Sigla automobilistica della provincia. */
    provinceSigla: text("province_sigla"),
    source: text("source").notNull().default("manual"),
    verificationStatus: text("verification_status").notNull().default("to_verify"),
    ...timestamps,
  },
  (t) => [
    check("territory_kind_check", sql`${t.kind} in ('country','region','province','municipality','locality')`),
    check(
      "territory_verification_check",
      sql`${t.verificationStatus} in ('draft','to_verify','verified_by_owner','validated_by_professional')`,
    ),
    uniqueIndex("territory_kind_code_uq").on(t.kind, t.code).where(sql`${t.code} is not null`),
    index("territory_parent_idx").on(t.parentId),
    index("territory_kind_name_idx").on(t.kind, t.name),
  ],
);

/** Rubrica: persone ed enti. Un contatto puo' avere piu' ruoli. */
export const party = pgTable(
  "party",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    displayName: text("display_name").notNull(),
    roles: text("roles").array().notNull().default(sql`'{}'::text[]`),
    taxCode: text("tax_code"),
    email: text("email"),
    pec: text("pec"),
    phone: text("phone"),
    address: text("address"),
    notes: text("notes"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("party_name_idx").on(t.displayName)],
);

/** Beni: immobili e pertinenze sono lo stesso tipo di record, distinti da `kind`. */
export const asset = pgTable(
  "asset",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    territoryId: uuid("territory_id")
      .notNull()
      .references(() => territory.id, { onDelete: "restrict" }),
    locality: text("locality"),
    address: text("address"),
    postalCode: text("postal_code"),
    useType: text("use_type"),
    inCondominium: boolean("in_condominium").notNull().default(false),
    notes: text("notes"),
    /** Fatti tecnici liberi usati in futuro dal motore delle regole (anno, impianti, ecc.). */
    attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("asset_territory_idx").on(t.territoryId), index("asset_name_idx").on(t.name)],
);

/** Titolarita': chi detiene quale diritto su un bene e per quale quota. */
export const ownershipRight = pgTable(
  "ownership_right",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => asset.id, { onDelete: "cascade" }),
    holderPartyId: uuid("holder_party_id")
      .notNull()
      .references(() => party.id, { onDelete: "restrict" }),
    rightType: text("right_type").notNull(),
    /** Posizione nell'elenco, cosi' come l'ha scritta l'utente nel modulo. */
    position: integer("position").notNull().default(0),
    quotaNumerator: integer("quota_numerator").notNull().default(1),
    quotaDenominator: integer("quota_denominator").notNull().default(1),
    validFrom: date("valid_from", { mode: "string" }),
    validTo: date("valid_to", { mode: "string" }),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [
    check(
      "ownership_right_type_check",
      sql`${t.rightType} in ('full','co_ownership','usufruct','bare_ownership')`,
    ),
    check(
      "ownership_quota_check",
      sql`${t.quotaNumerator} >= 1 and ${t.quotaDenominator} >= 1 and ${t.quotaNumerator} <= ${t.quotaDenominator}`,
    ),
    index("ownership_right_asset_idx").on(t.assetId),
    index("ownership_right_holder_idx").on(t.holderPartyId),
  ],
);

/** Collegamento DICHIARATO tra un bene accessorio e un bene principale. Nessuna pertinenzialita' presunta. */
export const assetLink = pgTable(
  "asset_link",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ancillaryAssetId: uuid("ancillary_asset_id")
      .notNull()
      .references(() => asset.id, { onDelete: "cascade" }),
    mainAssetId: uuid("main_asset_id")
      .notNull()
      .references(() => asset.id, { onDelete: "cascade" }),
    /** Posizione nell'elenco, cosi' come l'ha scritta l'utente nel modulo. */
    position: integer("position").notNull().default(0),
    declaredBasis: text("declared_basis"),
    validationStatus: text("validation_status").notNull().default("declared"),
    ...timestamps,
  },
  (t) => [
    check("asset_link_distinct_check", sql`${t.ancillaryAssetId} <> ${t.mainAssetId}`),
    check(
      "asset_link_validation_check",
      sql`${t.validationStatus} in ('declared','documented','validated_by_professional')`,
    ),
    uniqueIndex("asset_link_pair_uq").on(t.ancillaryAssetId, t.mainAssetId),
    index("asset_link_main_idx").on(t.mainAssetId),
  ],
);

/** Dati catastali a storico: il catasto cambia nel tempo. */
export const cadastralRecord = pgTable(
  "cadastral_record",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => asset.id, { onDelete: "cascade" }),
    /** Posizione nell'elenco, cosi' come l'ha scritta l'utente nel modulo. */
    position: integer("position").notNull().default(0),
    sheet: text("sheet"),
    parcel: text("parcel"),
    subunit: text("subunit"),
    cadastralCategory: text("cadastral_category"),
    cadastralClass: text("cadastral_class"),
    consistency: text("consistency"),
    /** Rendita in centesimi di euro. */
    incomeCents: bigint("income_cents", { mode: "number" }),
    validFrom: date("valid_from", { mode: "string" }),
    validTo: date("valid_to", { mode: "string" }),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [index("cadastral_record_asset_idx").on(t.assetId)],
);
