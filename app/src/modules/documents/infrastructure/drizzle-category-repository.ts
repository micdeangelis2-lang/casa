import { asc, count, eq, isNotNull } from "drizzle-orm";
import { document, documentCategory, dossierItem, ruleVersion } from "@/platform/db/schema";
import type { Db } from "@/platform/db/types";
import type { CategoryRepository } from "../application/category-cases";

/** Codici di categoria documentale richiamati da un esito di regola (`expectedDocumentCategory`). */
function outcomeCodes(outcomes: unknown[]): string[] {
  return outcomes.flatMap((o) => {
    const code = o && typeof o === "object" ? (o as { expectedDocumentCategory?: unknown }).expectedDocumentCategory : undefined;
    return typeof code === "string" ? [code] : [];
  });
}

export function drizzleCategoryRepository(db: Db): CategoryRepository {
  return {
    async all() {
      return db
        .select({ id: documentCategory.id, code: documentCategory.code, name: documentCategory.name, parentId: documentCategory.parentId, position: documentCategory.position })
        .from(documentCategory)
        .orderBy(asc(documentCategory.position), asc(documentCategory.name));
    },
    async insert(d) {
      const [row] = await db.insert(documentCategory).values(d).returning({ id: documentCategory.id });
      return row!.id;
    },
    async rename(id, name) {
      await db.update(documentCategory).set({ name }).where(eq(documentCategory.id, id));
    },
    async setPosition(id, position) {
      await db.update(documentCategory).set({ position }).where(eq(documentCategory.id, id));
    },
    async remove(id) {
      await db.delete(documentCategory).where(eq(documentCategory.id, id));
    },
    async documentCounts() {
      const rows = await db.select({ id: document.categoryId, n: count() }).from(document).groupBy(document.categoryId);
      return new Map(rows.map((r) => [r.id, Number(r.n)]));
    },
    async referenceCounts() {
      const counts = new Map<string, number>();
      const bump = (code: string) => counts.set(code, (counts.get(code) ?? 0) + 1);
      const items = await db.select({ code: dossierItem.expectedDocumentCategory }).from(dossierItem).where(isNotNull(dossierItem.expectedDocumentCategory));
      for (const i of items) if (i.code) bump(i.code);
      const versions = await db.select({ outcomes: ruleVersion.outcomes }).from(ruleVersion);
      for (const v of versions) for (const code of new Set(outcomeCodes(v.outcomes))) bump(code);
      return counts;
    },
  };
}
