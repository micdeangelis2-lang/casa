import { sql } from "drizzle-orm";
import { bigint, check, date, index, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { asset, party } from "./registry";
import { document } from "./documents";
import { deadline } from "./deadlines";

/**
 * Locazioni e ricettivita' (incremento 10). Un record per ogni locazione o attivita' su un bene, dopo che il proprietario ha
 * scelto il tipo reale. Requisiti, codici, comunicazioni e imposta di soggiorno NON sono scritti nel codice: variano per
 * territorio e nel tempo, e si descrivono con le regole (modulo Regole). Qui il proprietario registra i propri dati.
 */

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true })
  .notNull()
  .defaultNow()
  .$onUpdate(() => new Date());

export const letting = pgTable(
  "letting",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => asset.id, { onDelete: "cascade" }),
    /** residential | transitional | student | short_term | accommodation */
    type: text("type").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull().default("active"),
    startsOn: date("starts_on"),
    endsOn: date("ends_on"),
    /** Gestore o operatore (dalla rubrica). */
    managerPartyId: uuid("manager_party_id").references(() => party.id, { onDelete: "set null" }),
    monthlyRentCents: bigint("monthly_rent_cents", { mode: "number" }),
    depositCents: bigint("deposit_cents", { mode: "number" }),
    depositReceivedOn: date("deposit_received_on"),
    depositReturnedOn: date("deposit_returned_on"),
    depositReturnedCents: bigint("deposit_returned_cents", { mode: "number" }),
    /** Dati di registrazione del contratto, come li scrive il proprietario. */
    registeredOn: date("registered_on"),
    registrationNumber: text("registration_number"),
    registrationOffice: text("registration_office"),
    contractDocumentId: uuid("contract_document_id").references(() => document.id, { onDelete: "set null" }),
    note: text("note"),
    deadlineId: uuid("deadline_id").references(() => deadline.id, { onDelete: "set null" }),
    createdAt,
    updatedAt,
  },
  (t) => [
    check("letting_type_check", sql`${t.type} in ('residential','transitional','student','short_term','accommodation')`),
    check("letting_status_check", sql`${t.status} in ('planned','active','ended')`),
    check("letting_dates_check", sql`${t.startsOn} is null or ${t.endsOn} is null or ${t.endsOn} >= ${t.startsOn}`),
    check("letting_amounts_check", sql`(${t.monthlyRentCents} is null or ${t.monthlyRentCents} >= 0) and (${t.depositCents} is null or ${t.depositCents} >= 0) and (${t.depositReturnedCents} is null or ${t.depositReturnedCents} >= 0)`),
    index("letting_asset_idx").on(t.assetId),
    index("letting_status_idx").on(t.status),
    index("letting_manager_party_idx").on(t.managerPartyId),
    index("letting_contract_document_idx").on(t.contractDocumentId),
    index("letting_deadline_idx").on(t.deadlineId),
  ],
);

/** Inquilino, occupante o garante: un contatto della rubrica con il suo ruolo in questa locazione. */
export const lettingParty = pgTable(
  "letting_party",
  {
    lettingId: uuid("letting_id")
      .notNull()
      .references(() => letting.id, { onDelete: "cascade" }),
    partyId: uuid("party_id")
      .notNull()
      .references(() => party.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("tenant"),
  },
  (t) => [primaryKey({ columns: [t.lettingId, t.partyId] }), check("letting_party_role_check", sql`${t.role} in ('tenant','occupant','guarantor')`), index("letting_party_party_idx").on(t.partyId)],
);

/** Calendario dei canoni. */
export const lettingRent = pgTable(
  "letting_rent",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lettingId: uuid("letting_id")
      .notNull()
      .references(() => letting.id, { onDelete: "cascade" }),
    dueOn: date("due_on").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    paidOn: date("paid_on"),
    paidCents: bigint("paid_cents", { mode: "number" }).notNull().default(0),
    documentId: uuid("document_id").references(() => document.id, { onDelete: "set null" }),
    deadlineId: uuid("deadline_id").references(() => deadline.id, { onDelete: "set null" }),
    createdAt,
  },
  (t) => [check("letting_rent_amount_check", sql`${t.amountCents} >= 0 and ${t.paidCents} >= 0`), index("letting_rent_letting_idx").on(t.lettingId, t.dueOn), index("letting_rent_document_idx").on(t.documentId), index("letting_rent_deadline_idx").on(t.deadlineId)],
);

/** Incassi di un canone (anche piu' di uno): data, importo, modalita' scritta dal proprietario e documento di prova. */
export const lettingRentPayment = pgTable(
  "letting_rent_payment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rentId: uuid("rent_id")
      .notNull()
      .references(() => lettingRent.id, { onDelete: "cascade" }),
    paidOn: date("paid_on").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    /** Modalita' libera (bonifico, contanti, assegno...): testo del proprietario. */
    method: text("method"),
    documentId: uuid("document_id").references(() => document.id, { onDelete: "set null" }),
    createdAt,
  },
  (t) => [check("letting_rent_payment_amount_check", sql`${t.amountCents} > 0`), index("letting_rent_payment_rent_idx").on(t.rentId, t.paidOn), index("letting_rent_payment_document_idx").on(t.documentId)],
);

/** Codici identificativi (di struttura, di locazione...), scritti dal proprietario con chi li ha rilasciati. */
export const lettingCode = pgTable(
  "letting_code",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lettingId: uuid("letting_id")
      .notNull()
      .references(() => letting.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    value: text("value").notNull(),
    issuer: text("issuer"),
    issuedOn: date("issued_on"),
    validUntil: date("valid_until"),
    note: text("note"),
    createdAt,
  },
  (t) => [index("letting_code_letting_idx").on(t.lettingId)],
);

/** Adempimento periodico: comunicazione, imposta di soggiorno, rilevazione statistica... Cosa serva lo dicono le regole. */
export const lettingReport = pgTable(
  "letting_report",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lettingId: uuid("letting_id")
      .notNull()
      .references(() => letting.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    period: text("period"),
    dueOn: date("due_on"),
    amountCents: bigint("amount_cents", { mode: "number" }),
    doneOn: date("done_on"),
    documentId: uuid("document_id").references(() => document.id, { onDelete: "set null" }),
    note: text("note"),
    deadlineId: uuid("deadline_id").references(() => deadline.id, { onDelete: "set null" }),
    createdAt,
  },
  (t) => [
    check("letting_report_kind_check", sql`${t.kind} in ('communication','tourist_tax','statistics','other')`),
    check("letting_report_amount_check", sql`${t.amountCents} is null or ${t.amountCents} >= 0`),
    index("letting_report_letting_idx").on(t.lettingId),
    index("letting_report_document_idx").on(t.documentId),
    index("letting_report_deadline_idx").on(t.deadlineId),
  ],
);

/**
 * Mandato di gestione affidata a un gestore (property manager, operatore ricettivo). Sostituisce il riconoscimento dal prefisso
 * del titolo di una scadenza: il mandato e' un dato, la scadenza collegata (`deadline_id`) e' solo il promemoria della fine.
 * Il compenso e' un testo scritto dal proprietario: l'app non lo calcola ne' lo giudica.
 */
export const managementMandate = pgTable(
  "management_mandate",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Nullo = il mandato riguarda tutti gli immobili. */
    assetId: uuid("asset_id").references(() => asset.id, { onDelete: "cascade" }),
    managerPartyId: uuid("manager_party_id").references(() => party.id, { onDelete: "set null" }),
    startsOn: date("starts_on"),
    endsOn: date("ends_on"),
    compensation: text("compensation"),
    documentId: uuid("document_id").references(() => document.id, { onDelete: "set null" }),
    note: text("note"),
    deadlineId: uuid("deadline_id").references(() => deadline.id, { onDelete: "set null" }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt,
  },
  (t) => [
    check("management_mandate_dates_check", sql`${t.startsOn} is null or ${t.endsOn} is null or ${t.endsOn} >= ${t.startsOn}`),
    index("management_mandate_asset_idx").on(t.assetId),
    index("management_mandate_manager_party_idx").on(t.managerPartyId),
    index("management_mandate_document_idx").on(t.documentId),
    index("management_mandate_deadline_idx").on(t.deadlineId),
  ],
);
