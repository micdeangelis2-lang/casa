import { sql } from "drizzle-orm";
import { check, date, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { party } from "./registry";
import { document } from "./documents";

/**
 * Competenze di un contatto della rubrica (di solito un professionista): iscrizione a un albo, abilitazione, polizza professionale,
 * autorizzazione. Sono dati scritti dal proprietario con gli estremi che ha: l'app non li verifica presso gli albi e non dice se
 * una persona sia abilitata o idonea a un incarico.
 */
export const partyCompetence = pgTable(
  "party_competence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partyId: uuid("party_id")
      .notNull()
      .references(() => party.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    label: text("label").notNull(),
    /** Numero di iscrizione, polizza o autorizzazione, come lo scrive il proprietario. */
    reference: text("reference"),
    issuer: text("issuer"),
    validFrom: date("valid_from", { mode: "string" }),
    validUntil: date("valid_until", { mode: "string" }),
    documentId: uuid("document_id").references(() => document.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("party_competence_kind_check", sql`${t.kind} in ('registration','qualification','insurance','authorization','other')`),
    check("party_competence_dates_check", sql`${t.validFrom} is null or ${t.validUntil} is null or ${t.validUntil} >= ${t.validFrom}`),
    index("party_competence_party_idx").on(t.partyId),
    index("party_competence_document_idx").on(t.documentId),
  ],
);
