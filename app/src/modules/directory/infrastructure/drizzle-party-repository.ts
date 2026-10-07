import { and, arrayContains, asc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { party } from "@/platform/db/schema";
import type { Db } from "@/platform/db/types";
import type { Party, PartyInput, PartyRole } from "../domain/party";
import type { PartyRepository } from "../application/ports";

function toParty(row: typeof party.$inferSelect): Party {
  return {
    id: row.id,
    displayName: row.displayName,
    roles: row.roles as PartyRole[],
    taxCode: row.taxCode,
    email: row.email,
    pec: row.pec,
    phone: row.phone,
    address: row.address,
    notes: row.notes,
    archived: row.archivedAt !== null,
  };
}

const values = (input: PartyInput) => ({
  displayName: input.displayName,
  roles: input.roles,
  taxCode: input.taxCode ?? null,
  email: input.email ?? null,
  pec: input.pec ?? null,
  phone: input.phone ?? null,
  address: input.address ?? null,
  notes: input.notes ?? null,
});

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

export function drizzlePartyRepository(db: Db): PartyRepository {
  return {
    async get(id) {
      const [row] = await db.select().from(party).where(eq(party.id, id));
      return row ? toParty(row) : null;
    },
    async insert(input) {
      const [row] = await db.insert(party).values(values(input)).returning();
      return toParty(row!);
    },
    async update(id, input) {
      const [row] = await db.update(party).set(values(input)).where(eq(party.id, id)).returning();
      return row ? toParty(row) : null;
    },
    async setArchived(id, archived) {
      const [row] = await db
        .update(party)
        .set({ archivedAt: archived ? new Date() : null })
        .where(eq(party.id, id))
        .returning();
      return row ? toParty(row) : null;
    },
    async list({ query, role, includeArchived }) {
      const conditions: (SQL | undefined)[] = [];
      if (!includeArchived) conditions.push(isNull(party.archivedAt));
      if (role) conditions.push(arrayContains(party.roles, [role]));
      if (query?.trim()) {
        const pattern = `%${escapeLike(query.trim())}%`;
        conditions.push(or(ilike(party.displayName, pattern), ilike(party.email, pattern), ilike(party.taxCode, pattern)));
      }
      const rows = await db
        .select()
        .from(party)
        .where(and(...conditions))
        .orderBy(sql`lower(${party.displayName})`, asc(party.createdAt));
      return rows.map(toParty);
    },
    async findByRole(role) {
      const [row] = await db
        .select()
        .from(party)
        .where(and(arrayContains(party.roles, [role]), isNull(party.archivedAt)))
        .orderBy(asc(party.createdAt))
        .limit(1);
      return row ? toParty(row) : null;
    },
  };
}
