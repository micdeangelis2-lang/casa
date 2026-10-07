import { sql } from "drizzle-orm";
import { bigint, check, date, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { asset, party } from "./registry";
import { document } from "./documents";

/**
 * Scheda del notaio: provenienza e gravami di un immobile come DATI scritti dal proprietario (non letti da registri pubblici).
 * L'app non verifica nulla e non dice se un gravame sia valido, estinto o opponibile: riporta cio' che e' stato inserito.
 */

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** Titolo di provenienza: come l'immobile e' arrivato al proprietario (acquisto, successione, donazione...). */
export const assetProvenance = pgTable(
  "asset_provenance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => asset.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    occurredOn: date("occurred_on", { mode: "string" }),
    /** Da chi (dante causa), dalla rubrica. */
    fromPartyId: uuid("from_party_id").references(() => party.id, { onDelete: "set null" }),
    /** Notaio o pubblico ufficiale che ha ricevuto l'atto, dalla rubrica. */
    notaryPartyId: uuid("notary_party_id").references(() => party.id, { onDelete: "set null" }),
    /** Estremi dell'atto come li scrive il proprietario (repertorio, raccolta, numero). */
    deedReference: text("deed_reference"),
    documentId: uuid("document_id").references(() => document.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt,
  },
  (t) => [
    check("asset_provenance_kind_check", sql`${t.kind} in ('purchase','inheritance','donation','division','exchange','other')`),
    index("asset_provenance_asset_idx").on(t.assetId),
    index("asset_provenance_from_party_idx").on(t.fromPartyId),
    index("asset_provenance_notary_party_idx").on(t.notaryPartyId),
    index("asset_provenance_document_idx").on(t.documentId),
  ],
);

/** Gravame o vincolo registrato dal proprietario (ipoteca, servitu', vincolo, pignoramento, diritto d'uso...). */
export const assetEncumbrance = pgTable(
  "asset_encumbrance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => asset.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    registeredOn: date("registered_on", { mode: "string" }),
    /** Data di cancellazione o estinzione, se il proprietario la conosce. */
    endedOn: date("ended_on", { mode: "string" }),
    /** Creditore o beneficiario, dalla rubrica. */
    beneficiaryPartyId: uuid("beneficiary_party_id").references(() => party.id, { onDelete: "set null" }),
    amountCents: bigint("amount_cents", { mode: "number" }),
    /** Estremi della nota o del documento come li scrive il proprietario. */
    reference: text("reference"),
    documentId: uuid("document_id").references(() => document.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt,
  },
  (t) => [
    check("asset_encumbrance_kind_check", sql`${t.kind} in ('mortgage','easement','restriction','seizure','usage_right','other')`),
    check("asset_encumbrance_amount_check", sql`${t.amountCents} is null or ${t.amountCents} >= 0`),
    check("asset_encumbrance_dates_check", sql`${t.registeredOn} is null or ${t.endedOn} is null or ${t.endedOn} >= ${t.registeredOn}`),
    index("asset_encumbrance_asset_idx").on(t.assetId),
    index("asset_encumbrance_beneficiary_party_idx").on(t.beneficiaryPartyId),
    index("asset_encumbrance_document_idx").on(t.documentId),
  ],
);
