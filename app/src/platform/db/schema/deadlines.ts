import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { asset, party, territory } from "./registry";
import { document } from "./documents";
import { ruleVersion } from "./rules";
import { matter } from "./matters";

/**
 * Scadenze e notifiche (incremento 5). `deadline` e' la DEFINIZIONE (titolo, base, regola di calcolo); ogni data e' una
 * `deadline_occurrence` con il proprio stato e le proprie prove. Cosi' una scadenza ricorrente ha uno storico per data.
 */

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** Calendario dei festivi a dati: regole (data fissa o distanza dalla Pasqua), anche per un singolo Comune (santo patrono). */
export const holidayRule = pgTable(
  "holiday_rule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    month: integer("month"),
    day: integer("day"),
    offsetDays: integer("offset_days"),
    territoryId: uuid("territory_id").references(() => territory.id, { onDelete: "cascade" }),
    active: boolean("active").notNull().default(true),
    createdAt,
  },
  (t) => [
    check("holiday_rule_kind_check", sql`${t.kind} in ('fixed','easter_offset')`),
    check(
      "holiday_rule_shape_check",
      sql`(${t.kind} = 'fixed' and ${t.month} between 1 and 12 and ${t.day} between 1 and 31) or (${t.kind} = 'easter_offset' and ${t.offsetDays} is not null)`,
    ),
  ],
);

export const deadline = pgTable(
  "deadline",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    description: text("description"),
    category: text("category").notNull(),
    level: text("level").notNull(),
    legalBasis: text("legal_basis"),
    assetId: uuid("asset_id").references(() => asset.id, { onDelete: "cascade" }),
    responsiblePartyId: uuid("responsible_party_id").references(() => party.id, { onDelete: "set null" }),
    professionalPartyId: uuid("professional_party_id").references(() => party.id, { onDelete: "set null" }),
    /** Pratica a cui la scadenza e' collegata (facoltativa). */
    matterId: uuid("matter_id").references(() => matter.id, { onDelete: "set null" }),
    /** Regola di calcolo (fixed_annual, relative_to, recurring, manual): mai date assolute del futuro. */
    calc: jsonb("calc").$type<unknown>().notNull(),
    shiftToBusinessDay: boolean("shift_to_business_day").notNull().default(false),
    priority: text("priority").notNull().default("normal"),
    consequences: text("consequences"),
    requiredDocuments: text("required_documents"),
    /** Giorni di preavviso degli avvisi (es. 30, 7, 1, 0). */
    leadDays: integer("lead_days").array().notNull().default(sql`'{30,7,1,0}'::integer[]`),
    proofRequired: boolean("proof_required").notNull().default(false),
    origin: text("origin").notNull().default("manual"),
    ruleKey: text("rule_key"),
    outcomeKey: text("outcome_key"),
    ruleVersionId: uuid("rule_version_id").references(() => ruleVersion.id, { onDelete: "restrict" }),
    explanation: jsonb("explanation").$type<unknown>(),
    /** La regola che l'aveva prodotta non si applica piu': resta, decide il proprietario. */
    stale: boolean("stale").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt,
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check("deadline_category_check", sql`${t.category} in ('fiscal','insurance','technical','condominium','contractual','letting','hospitality','administrative','other')`),
    check("deadline_priority_check", sql`${t.priority} in ('low','normal','high','urgent')`),
    check("deadline_origin_check", sql`${t.origin} in ('manual','rule')`),
    check("deadline_level_check", sql`${t.level} in ('national','regional','municipal','condominium','contract')`),
    check("deadline_rule_check", sql`(${t.origin} = 'rule') = (${t.ruleKey} is not null and ${t.outcomeKey} is not null)`),
    uniqueIndex("deadline_rule_uq").on(t.assetId, t.ruleKey, t.outcomeKey).where(sql`${t.origin} = 'rule'`),
    index("deadline_asset_idx").on(t.assetId),
    index("deadline_responsible_party_idx").on(t.responsiblePartyId),
    index("deadline_professional_party_idx").on(t.professionalPartyId),
    index("deadline_matter_idx").on(t.matterId),
    index("deadline_rule_version_idx").on(t.ruleVersionId),
  ],
);

export const deadlineOccurrence = pgTable(
  "deadline_occurrence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deadlineId: uuid("deadline_id")
      .notNull()
      .references(() => deadline.id, { onDelete: "cascade" }),
    dueOn: date("due_on", { mode: "string" }).notNull(),
    status: text("status").notNull().default("open"),
    completedOn: date("completed_on", { mode: "string" }),
    /** Chi ha chiuso: il proprietario, una verifica automatica o un professionista. */
    completionKind: text("completion_kind"),
    snoozedUntil: date("snoozed_until", { mode: "string" }),
    note: text("note"),
    createdAt,
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check("deadline_occurrence_status_check", sql`${t.status} in ('open','done','cancelled')`),
    check("deadline_occurrence_completion_check", sql`${t.completionKind} is null or ${t.completionKind} in ('owner','auto_verified','professional_validated')`),
    uniqueIndex("deadline_occurrence_uq").on(t.deadlineId, t.dueOn),
    index("deadline_occurrence_due_idx").on(t.status, t.dueOn),
  ],
);

/** Prova di adempimento: un documento oppure un riferimento (protocollo, quietanza, bonifico). */
export const deadlineProof = pgTable(
  "deadline_proof",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    occurrenceId: uuid("occurrence_id")
      .notNull()
      .references(() => deadlineOccurrence.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").references(() => document.id, { onDelete: "restrict" }),
    reference: text("reference"),
    createdAt,
  },
  (t) => [
    check("deadline_proof_shape_check", sql`${t.documentId} is not null or ${t.reference} is not null`),
    index("deadline_proof_occurrence_idx").on(t.occurrenceId),
    index("deadline_proof_document_idx").on(t.documentId),
  ],
);

/** Avvisi (outbox): la chiave univoca li rende idempotenti anche se il giro giornaliero parte due volte. */
export const notification = pgTable(
  "notification",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    occurrenceId: uuid("occurrence_id")
      .notNull()
      .references(() => deadlineOccurrence.id, { onDelete: "cascade" }),
    /** Giorni prima della scadenza (>= 0) oppure, se negativo, giorni di ritardo (escalation). */
    leadDays: integer("lead_days").notNull(),
    dueOn: date("due_on", { mode: "string" }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    emailSentAt: timestamp("email_sent_at", { withTimezone: true }),
    emailError: text("email_error"),
    createdAt,
  },
  (t) => [uniqueIndex("notification_key_uq").on(t.occurrenceId, t.leadDays, t.dueOn), index("notification_unread_idx").on(t.readAt, t.dismissedAt)],
);

/** Impostazioni dell'app (una riga per chiave). */
export const appSetting = pgTable("app_setting", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
