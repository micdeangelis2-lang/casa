import { sql } from "drizzle-orm";
import { check, date, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { party } from "./registry";

/**
 * Modulistica di un ufficio, scritta dal proprietario: il nome del modulo o della procedura, l'elenco dei documenti che ha
 * annotato (una checklist di testo libero), la fonte da cui li ha ricavati, la data in cui li ha verificati e lo stato di
 * verifica. L'app non conosce moduli o requisiti reali: non dice cosa un ufficio richieda ne' se un elenco sia completo.
 */
export const officeFormTemplate = pgTable(
  "office_form_template",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** L'ufficio (contatto della rubrica con ruolo «ufficio pubblico»). */
    officePartyId: uuid("office_party_id")
      .notNull()
      .references(() => party.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    /** Documenti da presentare, uno per voce, come li ha scritti il proprietario. */
    checklist: text("checklist").array().notNull().default(sql`'{}'::text[]`),
    /** Da dove vengono le informazioni (sito, sportello, comunicazione): serve a ritrovarle, non a dimostrarle. */
    source: text("source"),
    verifiedOn: date("verified_on", { mode: "string" }),
    verificationStatus: text("verification_status").notNull().default("to_verify"),
    note: text("note"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check("office_form_template_verification_check", sql`${t.verificationStatus} in ('draft','to_verify','verified_by_owner','validated_by_professional')`),
    index("office_form_template_office_idx").on(t.officePartyId),
  ],
);
