import { asc, eq, isNull } from "drizzle-orm";
import { managementMandate } from "@/platform/db/schema";
import type { Db } from "@/platform/db/types";
import type { MandateRepository, MandateRow } from "../application/ports";

const toMandate = (r: typeof managementMandate.$inferSelect): MandateRow => ({
  id: r.id,
  assetId: r.assetId,
  managerPartyId: r.managerPartyId,
  startsOn: r.startsOn,
  endsOn: r.endsOn,
  compensation: r.compensation,
  documentId: r.documentId,
  note: r.note,
  deadlineId: r.deadlineId,
  archived: r.archivedAt !== null,
});

/** `archived` (booleano del dominio) -> `archivedAt` (colonna). */
const archivedPatch = (archived: boolean | undefined) => (archived === undefined ? {} : { archivedAt: archived ? new Date() : null });

export function drizzleMandateRepository(db: Db): MandateRepository {
  return {
    async list({ includeArchived }) {
      return (await db.select().from(managementMandate).where(includeArchived ? undefined : isNull(managementMandate.archivedAt)).orderBy(asc(managementMandate.endsOn), asc(managementMandate.createdAt))).map(toMandate);
    },
    async insert(d) {
      const { archived, ...rest } = d;
      const [row] = await db.insert(managementMandate).values({ ...rest, ...archivedPatch(archived) }).returning({ id: managementMandate.id });
      return row!.id;
    },
    async get(id) {
      const [row] = await db.select().from(managementMandate).where(eq(managementMandate.id, id));
      return row ? toMandate(row) : null;
    },
    async update(id, d) {
      const { archived, ...rest } = d;
      await db.update(managementMandate).set({ ...rest, ...archivedPatch(archived) }).where(eq(managementMandate.id, id));
    },
  };
}
