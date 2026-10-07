import { and, asc, eq, isNull, type SQL } from "drizzle-orm";
import { officeFormTemplate } from "@/platform/db/schema";
import type { Db } from "@/platform/db/types";
import type { RuleVerification } from "@/modules/rules";
import type { FormTemplateRepository, FormTemplateRow } from "../application/ports";

const toRow = (r: typeof officeFormTemplate.$inferSelect): FormTemplateRow => ({
  id: r.id,
  officePartyId: r.officePartyId,
  name: r.name,
  checklist: r.checklist,
  source: r.source,
  verifiedOn: r.verifiedOn,
  verificationStatus: r.verificationStatus as RuleVerification,
  note: r.note,
  archived: r.archivedAt !== null,
});

/** `archived` (booleano del dominio) -> `archivedAt` (colonna). */
const archivedPatch = (archived: boolean | undefined) => (archived === undefined ? {} : { archivedAt: archived ? new Date() : null });

export function drizzleFormTemplateRepository(db: Db): FormTemplateRepository {
  return {
    async list({ officePartyId, includeArchived }) {
      const where: SQL[] = [];
      if (officePartyId) where.push(eq(officeFormTemplate.officePartyId, officePartyId));
      if (!includeArchived) where.push(isNull(officeFormTemplate.archivedAt));
      return (await db.select().from(officeFormTemplate).where(and(...where)).orderBy(asc(officeFormTemplate.name), asc(officeFormTemplate.createdAt))).map(toRow);
    },
    async get(id) {
      const [row] = await db.select().from(officeFormTemplate).where(eq(officeFormTemplate.id, id));
      return row ? toRow(row) : null;
    },
    async insert(d) {
      const { archived, ...rest } = d;
      const [row] = await db.insert(officeFormTemplate).values({ ...rest, ...archivedPatch(archived) }).returning({ id: officeFormTemplate.id });
      return row!.id;
    },
    async update(id, d) {
      const { archived, ...rest } = d;
      await db.update(officeFormTemplate).set({ ...rest, ...archivedPatch(archived) }).where(eq(officeFormTemplate.id, id));
    },
  };
}
