import { asc, eq } from "drizzle-orm";
import { document, party, partyCompetence } from "@/platform/db/schema";
import type { Db } from "@/platform/db/types";
import type { CompetenceRepository } from "../application/competence-cases";
import type { CompetenceKind, CompetenceRow } from "../domain/competence";

const toCompetence = (r: typeof partyCompetence.$inferSelect): CompetenceRow => ({
  id: r.id,
  partyId: r.partyId,
  kind: r.kind as CompetenceKind,
  label: r.label,
  reference: r.reference,
  issuer: r.issuer,
  validFrom: r.validFrom,
  validUntil: r.validUntil,
  documentId: r.documentId,
  note: r.note,
});

export function drizzleCompetenceRepository(db: Db): CompetenceRepository {
  return {
    async list(partyId) {
      return (await db.select().from(partyCompetence).where(eq(partyCompetence.partyId, partyId)).orderBy(asc(partyCompetence.validUntil), asc(partyCompetence.createdAt))).map(toCompetence);
    },
    async insert(d) {
      const [row] = await db.insert(partyCompetence).values(d).returning({ id: partyCompetence.id });
      return row!.id;
    },
    async get(id) {
      const [row] = await db.select().from(partyCompetence).where(eq(partyCompetence.id, id));
      return row ? toCompetence(row) : null;
    },
    async delete(id) {
      await db.delete(partyCompetence).where(eq(partyCompetence.id, id));
    },
    async partyExists(partyId) {
      return (await db.select({ id: party.id }).from(party).where(eq(party.id, partyId))).length > 0;
    },
    async documentExists(documentId) {
      return (await db.select({ id: document.id }).from(document).where(eq(document.id, documentId))).length > 0;
    },
  };
}
