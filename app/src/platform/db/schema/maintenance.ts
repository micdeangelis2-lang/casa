import { sql } from "drizzle-orm";
import { bigint, check, date, index, integer, pgTable, primaryKey, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { asset, party } from "./registry";
import { document } from "./documents";
import { deadline } from "./deadlines";

/**
 * Manutenzioni e lavori (incremento 9): interventi con preventivi, avanzamenti e fatture, garanzie e piani di ispezione periodica.
 * L'app registra e ricorda: non valuta preventivi, non stabilisce se un lavoro sia a regola d'arte ne' se una garanzia si applichi.
 */

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true })
  .notNull()
  .defaultNow()
  .$onUpdate(() => new Date());

/**
 * Impianto di un immobile (termico, elettrico, ascensore...): il tipo e' uno dei codici dei dati del registro impianti. Piani di
 * ispezione, garanzie, interventi e documenti si collegano all'impianto; quelli non collegati restano nel registro per parola chiave.
 */
export const plant = pgTable(
  "plant",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => asset.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    installedOn: date("installed_on"),
    /** Chi lo ha installato e chi lo mantiene (dalla rubrica). */
    installerPartyId: uuid("installer_party_id").references(() => party.id, { onDelete: "set null" }),
    maintainerPartyId: uuid("maintainer_party_id").references(() => party.id, { onDelete: "set null" }),
    serialNumber: text("serial_number"),
    note: text("note"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (t) => [
    check("plant_kind_check", sql`${t.kind} in ('solar','electrical','lift','fire','cooling','gas','heating','water','other')`),
    index("plant_asset_idx").on(t.assetId),
    index("plant_installer_party_idx").on(t.installerPartyId),
    index("plant_maintainer_party_idx").on(t.maintainerPartyId),
  ],
);

/** Documenti collegati a un impianto (libretto, dichiarazioni, verifiche...). */
export const plantDocument = pgTable(
  "plant_document",
  {
    plantId: uuid("plant_id")
      .notNull()
      .references(() => plant.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => document.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.plantId, t.documentId] }), index("plant_document_document_idx").on(t.documentId)],
);

export const maintWork = pgTable(
  "maint_work",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => asset.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("planned"),
    supplierPartyId: uuid("supplier_party_id").references(() => party.id, { onDelete: "set null" }),
    plantId: uuid("plant_id").references(() => plant.id, { onDelete: "set null" }),
    scheduledOn: date("scheduled_on"),
    startedOn: date("started_on"),
    completedOn: date("completed_on"),
    budgetCents: bigint("budget_cents", { mode: "number" }),
    note: text("note"),
    deadlineId: uuid("deadline_id").references(() => deadline.id, { onDelete: "set null" }),
    createdAt,
    updatedAt,
  },
  (t) => [
    check("maint_work_status_check", sql`${t.status} in ('planned','quoted','approved','in_progress','completed','cancelled')`),
    check("maint_work_budget_check", sql`${t.budgetCents} is null or ${t.budgetCents} >= 0`),
    index("maint_work_asset_idx").on(t.assetId),
    index("maint_work_status_idx").on(t.status),
    index("maint_work_supplier_party_idx").on(t.supplierPartyId),
    index("maint_work_deadline_idx").on(t.deadlineId),
    index("maint_work_plant_idx").on(t.plantId),
  ],
);

export const maintQuote = pgTable(
  "maint_quote",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workId: uuid("work_id")
      .notNull()
      .references(() => maintWork.id, { onDelete: "cascade" }),
    supplierPartyId: uuid("supplier_party_id").references(() => party.id, { onDelete: "set null" }),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    quotedOn: date("quoted_on"),
    validUntil: date("valid_until"),
    status: text("status").notNull().default("received"),
    documentId: uuid("document_id").references(() => document.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt,
  },
  (t) => [check("maint_quote_status_check", sql`${t.status} in ('received','accepted','rejected')`), check("maint_quote_amount_check", sql`${t.amountCents} >= 0`), index("maint_quote_work_idx").on(t.workId), index("maint_quote_supplier_party_idx").on(t.supplierPartyId), index("maint_quote_document_idx").on(t.documentId)],
);

export const maintInvoice = pgTable(
  "maint_invoice",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workId: uuid("work_id")
      .notNull()
      .references(() => maintWork.id, { onDelete: "cascade" }),
    number: text("number"),
    issuedOn: date("issued_on").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    paidOn: date("paid_on"),
    documentId: uuid("document_id").references(() => document.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt,
  },
  (t) => [check("maint_invoice_amount_check", sql`${t.amountCents} >= 0`), index("maint_invoice_work_idx").on(t.workId), index("maint_invoice_document_idx").on(t.documentId)],
);

/** Avanzamento: una nota datata, con una percentuale facoltativa scritta dal proprietario. */
export const maintProgress = pgTable(
  "maint_progress",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workId: uuid("work_id")
      .notNull()
      .references(() => maintWork.id, { onDelete: "cascade" }),
    recordedOn: date("recorded_on").notNull(),
    percent: smallint("percent"),
    note: text("note").notNull(),
    createdAt,
  },
  (t) => [check("maint_progress_percent_check", sql`${t.percent} is null or (${t.percent} between 0 and 100)`), index("maint_progress_work_idx").on(t.workId)],
);

export const maintWarranty = pgTable(
  "maint_warranty",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => asset.id, { onDelete: "cascade" }),
    workId: uuid("work_id").references(() => maintWork.id, { onDelete: "set null" }),
    plantId: uuid("plant_id").references(() => plant.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    startsOn: date("starts_on"),
    endsOn: date("ends_on").notNull(),
    supplierPartyId: uuid("supplier_party_id").references(() => party.id, { onDelete: "set null" }),
    documentId: uuid("document_id").references(() => document.id, { onDelete: "set null" }),
    note: text("note"),
    deadlineId: uuid("deadline_id").references(() => deadline.id, { onDelete: "set null" }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt,
  },
  (t) => [check("maint_warranty_dates_check", sql`${t.startsOn} is null or ${t.endsOn} >= ${t.startsOn}`), index("maint_warranty_asset_idx").on(t.assetId), index("maint_warranty_work_idx").on(t.workId), index("maint_warranty_supplier_party_idx").on(t.supplierPartyId), index("maint_warranty_document_idx").on(t.documentId), index("maint_warranty_deadline_idx").on(t.deadlineId), index("maint_warranty_plant_idx").on(t.plantId)],
);

/** Ispezione periodica: la ricorrenza e' una scadenza ricorrente del modulo Scadenze, qui si registra il resto. */
export const maintInspectionPlan = pgTable(
  "maint_inspection_plan",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => asset.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    intervalMonths: integer("interval_months").notNull(),
    firstDueOn: date("first_due_on").notNull(),
    supplierPartyId: uuid("supplier_party_id").references(() => party.id, { onDelete: "set null" }),
    plantId: uuid("plant_id").references(() => plant.id, { onDelete: "set null" }),
    note: text("note"),
    deadlineId: uuid("deadline_id").references(() => deadline.id, { onDelete: "set null" }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt,
  },
  (t) => [check("maint_inspection_interval_check", sql`${t.intervalMonths} between 1 and 120`), index("maint_inspection_asset_idx").on(t.assetId), index("maint_inspection_plan_deadline_idx").on(t.deadlineId), index("maint_inspection_plan_supplier_party_idx").on(t.supplierPartyId), index("maint_inspection_plan_plant_idx").on(t.plantId)],
);
