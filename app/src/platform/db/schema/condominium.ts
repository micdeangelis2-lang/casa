import { sql } from "drizzle-orm";
import { bigint, check, date, index, integer, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { asset, party } from "./registry";
import { document } from "./documents";
import { deadline } from "./deadlines";
import { matter } from "./matters";

/**
 * Condominio (incremento 7). L'app registra e ricorda: non interpreta delibere, non calcola maggioranze di legge.
 * Le soglie di voto le scrive il proprietario; l'app confronta i numeri registrati con quelle e basta.
 */

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true })
  .notNull()
  .defaultNow()
  .$onUpdate(() => new Date());

export const condominium = pgTable(
  "condominium",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    address: text("address"),
    taxCode: text("tax_code"),
    administratorPartyId: uuid("administrator_party_id").references(() => party.id, { onDelete: "set null" }),
    notes: text("notes"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (t) => [index("condominium_name_idx").on(t.name), index("condominium_administrator_party_idx").on(t.administratorPartyId)],
);

/** Un bene fa parte di al piu' un condominio. */
export const condoMembership = pgTable(
  "condo_membership",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    condominiumId: uuid("condominium_id")
      .notNull()
      .references(() => condominium.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => asset.id, { onDelete: "cascade" }),
    /** Come si chiama l'unita' nel condominio (scala, interno). */
    unitLabel: text("unit_label"),
    createdAt,
  },
  (t) => [uniqueIndex("condo_membership_asset_uq").on(t.assetId), index("condo_membership_condo_idx").on(t.condominiumId)],
);

/** Tabella millesimale (generale, scale, ascensore...). I valori sono millesimi. */
export const millesimalTable = pgTable(
  "millesimal_table",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    condominiumId: uuid("condominium_id")
      .notNull()
      .references(() => condominium.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    note: text("note"),
    createdAt,
  },
  (t) => [index("millesimal_table_condo_idx").on(t.condominiumId)],
);

export const millesimalShare = pgTable(
  "millesimal_share",
  {
    tableId: uuid("table_id")
      .notNull()
      .references(() => millesimalTable.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => asset.id, { onDelete: "cascade" }),
    /** Millesimi, anche con decimali (es. 48,25). */
    value: numeric("value", { precision: 12, scale: 4 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.tableId, t.assetId] }), check("millesimal_share_value_check", sql`${t.value} >= 0`), index("millesimal_share_asset_idx").on(t.assetId)],
);

/**
 * Millesimi delle unita' che NON sono del proprietario, per tabella (anche raggruppate: «altri condomini»). Servono a calcolare
 * il totale del palazzo quando un preventivo e' dell'intero palazzo; sono dati inseriti dal proprietario, non verificati.
 */
export const condoUnitOther = pgTable(
  "condo_unit_other",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tableId: uuid("table_id")
      .notNull()
      .references(() => millesimalTable.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    /** Millesimi, anche con decimali (come nelle quote del proprietario). */
    value: numeric("value", { precision: 12, scale: 4 }).notNull(),
    createdAt,
  },
  (t) => [check("condo_unit_other_value_check", sql`${t.value} >= 0`), index("condo_unit_other_table_idx").on(t.tableId)],
);

export const condoFiscalYear = pgTable(
  "condo_fiscal_year",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    condominiumId: uuid("condominium_id")
      .notNull()
      .references(() => condominium.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    startsOn: date("starts_on", { mode: "string" }).notNull(),
    endsOn: date("ends_on", { mode: "string" }).notNull(),
    createdAt,
  },
  (t) => [check("condo_fiscal_year_dates_check", sql`${t.endsOn} >= ${t.startsOn}`), index("condo_fiscal_year_condo_idx").on(t.condominiumId)],
);

/** Preventivo (ordinario o straordinario) o consuntivo di un esercizio; importi in centesimi, inseriti dal proprietario. */
export const condoBudget = pgTable(
  "condo_budget",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fiscalYearId: uuid("fiscal_year_id")
      .notNull()
      .references(() => condoFiscalYear.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    totalCents: bigint("total_cents", { mode: "number" }).notNull(),
    /** Con quale tabella millesimale si ripartisce. */
    millesimalTableId: uuid("millesimal_table_id").references(() => millesimalTable.id, { onDelete: "set null" }),
    /** `owner_only` (predefinito): il totale e' quello da ripartire tra le unita' del proprietario. `building`: il totale e' del palazzo e la quota del proprietario e' una parte. */
    scope: text("scope").notNull().default("owner_only"),
    note: text("note"),
    documentId: uuid("document_id").references(() => document.id, { onDelete: "set null" }),
    createdAt,
  },
  (t) => [check("condo_budget_kind_check", sql`${t.kind} in ('ordinary','extraordinary','final')`), check("condo_budget_scope_check", sql`${t.scope} in ('building','owner_only')`), check("condo_budget_total_check", sql`${t.totalCents} >= 0`), index("condo_budget_year_idx").on(t.fiscalYearId), index("condo_budget_millesimal_table_idx").on(t.millesimalTableId), index("condo_budget_document_idx").on(t.documentId)],
);

/** Rata di un preventivo per un bene (la quota millesimale del proprietario per quell'unita'). */
export const condoInstallment = pgTable(
  "condo_installment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    budgetId: uuid("budget_id")
      .notNull()
      .references(() => condoBudget.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => asset.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    dueOn: date("due_on", { mode: "string" }).notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    paidCents: bigint("paid_cents", { mode: "number" }).notNull().default(0),
    paidOn: date("paid_on", { mode: "string" }),
    /** Prova di pagamento (documento dell'archivio), facoltativa. */
    documentId: uuid("document_id").references(() => document.id, { onDelete: "set null" }),
    /** Scadenza collegata (modulo Scadenze), se creata. */
    deadlineId: uuid("deadline_id").references(() => deadline.id, { onDelete: "set null" }),
    createdAt,
  },
  (t) => [
    check("condo_installment_amount_check", sql`${t.amountCents} >= 0 and ${t.paidCents} >= 0`),
    uniqueIndex("condo_installment_uq").on(t.budgetId, t.assetId, t.number),
    index("condo_installment_due_idx").on(t.dueOn),
    index("condo_installment_asset_idx").on(t.assetId),
    index("condo_installment_deadline_idx").on(t.deadlineId),
    index("condo_installment_document_idx").on(t.documentId),
  ],
);

export const condoMeeting = pgTable(
  "condo_meeting",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    condominiumId: uuid("condominium_id")
      .notNull()
      .references(() => condominium.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("convened"),
    convenedOn: date("convened_on", { mode: "string" }),
    meetingOn: date("meeting_on", { mode: "string" }).notNull(),
    location: text("location"),
    convocationDocumentId: uuid("convocation_document_id").references(() => document.id, { onDelete: "set null" }),
    minutesDocumentId: uuid("minutes_document_id").references(() => document.id, { onDelete: "set null" }),
    notes: text("notes"),
    createdAt,
    updatedAt,
  },
  (t) => [
    check("condo_meeting_kind_check", sql`${t.kind} in ('ordinary','extraordinary')`),
    check("condo_meeting_status_check", sql`${t.status} in ('convened','held','cancelled')`),
    index("condo_meeting_condo_idx").on(t.condominiumId),
    index("condo_meeting_convocation_document_idx").on(t.convocationDocumentId),
    index("condo_meeting_minutes_document_idx").on(t.minutesDocumentId),
  ],
);

export const condoAgendaItem = pgTable(
  "condo_agenda_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => condoMeeting.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    /** Domande da porre in assemblea: preparate dal proprietario. */
    questions: text("questions"),
    createdAt,
  },
  (t) => [uniqueIndex("condo_agenda_item_uq").on(t.meetingId, t.position)],
);

/** Documenti da leggere per un punto all'ordine del giorno. */
export const condoAgendaDocument = pgTable(
  "condo_agenda_document",
  {
    agendaItemId: uuid("agenda_item_id")
      .notNull()
      .references(() => condoAgendaItem.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => document.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.agendaItemId, t.documentId] }), index("condo_agenda_document_document_idx").on(t.documentId)],
);

export const condoProxy = pgTable(
  "condo_proxy",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => condoMeeting.id, { onDelete: "cascade" }),
    delegatePartyId: uuid("delegate_party_id")
      .notNull()
      .references(() => party.id, { onDelete: "restrict" }),
    note: text("note"),
    documentId: uuid("document_id").references(() => document.id, { onDelete: "set null" }),
    createdAt,
  },
  (t) => [index("condo_proxy_meeting_idx").on(t.meetingId), index("condo_proxy_delegate_party_idx").on(t.delegatePartyId), index("condo_proxy_document_idx").on(t.documentId)],
);

export const condoResolution = pgTable(
  "condo_resolution",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => condoMeeting.id, { onDelete: "cascade" }),
    agendaItemId: uuid("agenda_item_id").references(() => condoAgendaItem.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    text: text("text"),
    outcome: text("outcome").notNull().default("not_recorded"),
    /** Millesimi favorevoli, contrari, astenuti, come risultano dal verbale (inseriti a mano). */
    votesForMilli: numeric("votes_for_milli", { precision: 12, scale: 4 }),
    votesAgainstMilli: numeric("votes_against_milli", { precision: 12, scale: 4 }),
    votesAbstainMilli: numeric("votes_abstain_milli", { precision: 12, scale: 4 }),
    /** Soglia in millesimi che SCRIVE il proprietario (non e' un calcolo dell'app) e la sua descrizione. */
    thresholdMilli: numeric("threshold_milli", { precision: 12, scale: 4 }),
    thresholdNote: text("threshold_note"),
    /** Seguito: una scadenza, una spesa (preventivo), un lavoro. */
    deadlineId: uuid("deadline_id").references(() => deadline.id, { onDelete: "set null" }),
    budgetId: uuid("budget_id").references(() => condoBudget.id, { onDelete: "set null" }),
    createdAt,
    updatedAt,
  },
  (t) => [check("condo_resolution_outcome_check", sql`${t.outcome} in ('not_recorded','approved','rejected','postponed')`), index("condo_resolution_meeting_idx").on(t.meetingId), index("condo_resolution_agenda_item_idx").on(t.agendaItemId), index("condo_resolution_deadline_idx").on(t.deadlineId), index("condo_resolution_budget_idx").on(t.budgetId)],
);

export const condoWork = pgTable(
  "condo_work",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    condominiumId: uuid("condominium_id")
      .notNull()
      .references(() => condominium.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    status: text("status").notNull().default("planned"),
    budgetCents: bigint("budget_cents", { mode: "number" }),
    resolutionId: uuid("resolution_id").references(() => condoResolution.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt,
    updatedAt,
  },
  (t) => [check("condo_work_status_check", sql`${t.status} in ('planned','quoted','approved','in_progress','completed')`), index("condo_work_condo_idx").on(t.condominiumId), index("condo_work_resolution_idx").on(t.resolutionId)],
);

/** Preventivi, stati di avanzamento e fatture di un lavoro condominiale. */
export const condoWorkEntry = pgTable(
  "condo_work_entry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workId: uuid("work_id")
      .notNull()
      .references(() => condoWork.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }),
    entryOn: date("entry_on", { mode: "string" }),
    documentId: uuid("document_id").references(() => document.id, { onDelete: "set null" }),
    createdAt,
  },
  (t) => [check("condo_work_entry_kind_check", sql`${t.kind} in ('quote','progress','invoice')`), index("condo_work_entry_work_idx").on(t.workId), index("condo_work_entry_document_idx").on(t.documentId)],
);

/** Sinistri, controversie, segnalazioni e comunicazioni del condominio. */
export const condoClaim = pgTable(
  "condo_claim",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    condominiumId: uuid("condominium_id")
      .notNull()
      .references(() => condominium.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("open"),
    openedOn: date("opened_on", { mode: "string" }).notNull(),
    closedOn: date("closed_on", { mode: "string" }),
    matterId: uuid("matter_id").references(() => matter.id, { onDelete: "set null" }),
    createdAt,
    updatedAt,
  },
  (t) => [
    check("condo_claim_kind_check", sql`${t.kind} in ('claim','dispute','report','communication')`),
    check("condo_claim_status_check", sql`${t.status} in ('open','closed')`),
    index("condo_claim_condo_idx").on(t.condominiumId),
    index("condo_claim_matter_idx").on(t.matterId),
  ],
);

/** Contratti e certificazioni delle parti comuni (ascensore, antincendio...). */
export const condoContract = pgTable(
  "condo_contract",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    condominiumId: uuid("condominium_id")
      .notNull()
      .references(() => condominium.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    counterpartyPartyId: uuid("counterparty_party_id").references(() => party.id, { onDelete: "set null" }),
    validFrom: date("valid_from", { mode: "string" }),
    validTo: date("valid_to", { mode: "string" }),
    documentId: uuid("document_id").references(() => document.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt,
  },
  (t) => [check("condo_contract_kind_check", sql`${t.kind} in ('contract','certification')`), index("condo_contract_condo_idx").on(t.condominiumId), index("condo_contract_counterparty_party_idx").on(t.counterpartyPartyId), index("condo_contract_document_idx").on(t.documentId)],
);

/** Documenti del condominio (regolamento, tabelle...). */
export const condoDocument = pgTable(
  "condo_document",
  {
    condominiumId: uuid("condominium_id")
      .notNull()
      .references(() => condominium.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => document.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("other"),
  },
  (t) => [primaryKey({ columns: [t.condominiumId, t.documentId] }), check("condo_document_kind_check", sql`${t.kind} in ('regulation','millesimal','other')`), index("condo_document_document_idx").on(t.documentId)],
);
