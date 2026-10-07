import { and, asc, eq } from "drizzle-orm";
import { dossierCategory, dossierItem, dossierItemDocument } from "@/platform/db/schema";
import type { Db } from "@/platform/db/types";
import type { DossierStatus } from "../domain/dossier";
import type { DossierRepository, ItemRow } from "../application/ports";

const toRow = (row: typeof dossierItem.$inferSelect, documentIds: string[]): ItemRow => ({
  id: row.id,
  assetId: row.assetId,
  categoryId: row.categoryId,
  title: row.title,
  status: row.status as DossierStatus,
  origin: row.origin as ItemRow["origin"],
  ruleKey: row.ruleKey,
  outcomeKey: row.outcomeKey,
  ruleVersionId: row.ruleVersionId,
  expectedDocumentCategory: row.expectedDocumentCategory,
  ruleNote: row.ruleNote,
  explanation: row.explanation,
  stale: row.stale,
  ownerNote: row.ownerNote,
  documentIds,
});

export function drizzleDossierRepository(db: Db): DossierRepository {
  const documentIdsFor = async (itemIds: string[]) => {
    const map = new Map<string, string[]>();
    if (itemIds.length === 0) return map;
    const rows = await db.select().from(dossierItemDocument);
    for (const r of rows) if (itemIds.includes(r.itemId)) map.set(r.itemId, [...(map.get(r.itemId) ?? []), r.documentId]);
    return map;
  };

  return {
    async listCategories() {
      return db
        .select({ id: dossierCategory.id, code: dossierCategory.code, name: dossierCategory.name })
        .from(dossierCategory)
        .orderBy(asc(dossierCategory.position), asc(dossierCategory.name));
    },

    async itemsForAsset(assetId) {
      const rows = await db.select().from(dossierItem).where(eq(dossierItem.assetId, assetId)).orderBy(asc(dossierItem.createdAt), asc(dossierItem.title));
      const docs = await documentIdsFor(rows.map((r) => r.id));
      return rows.map((r) => toRow(r, docs.get(r.id) ?? []));
    },

    async getItem(id) {
      const [row] = await db.select().from(dossierItem).where(eq(dossierItem.id, id));
      if (!row) return null;
      return toRow(row, (await documentIdsFor([id])).get(id) ?? []);
    },

    async insertDerived(assetId, categoryId, item) {
      const [row] = await db
        .insert(dossierItem)
        .values({
          assetId,
          categoryId,
          title: item.title,
          origin: "rule",
          ruleKey: item.ruleKey,
          outcomeKey: item.outcomeKey,
          ruleVersionId: item.versionId,
          expectedDocumentCategory: item.expectedDocumentCategory,
          ruleNote: item.note,
          explanation: item.explanation,
        })
        .returning({ id: dossierItem.id });
      return row!.id;
    },

    async updateDerivation(id, categoryId, item) {
      await db
        .update(dossierItem)
        .set({
          categoryId,
          title: item.title,
          ruleVersionId: item.versionId,
          expectedDocumentCategory: item.expectedDocumentCategory,
          ruleNote: item.note,
          explanation: item.explanation,
        })
        .where(eq(dossierItem.id, id));
    },

    async setStale(id, stale) {
      await db.update(dossierItem).set({ stale }).where(eq(dossierItem.id, id));
    },

    async insertManual(assetId, categoryId, title, ownerNote) {
      const [row] = await db.insert(dossierItem).values({ assetId, categoryId, title, origin: "manual", ownerNote: ownerNote ?? null }).returning({ id: dossierItem.id });
      return row!.id;
    },

    async setStatus(id, status) {
      await db.update(dossierItem).set({ status }).where(eq(dossierItem.id, id));
    },

    async setOwnerNote(id, note) {
      await db.update(dossierItem).set({ ownerNote: note }).where(eq(dossierItem.id, id));
    },

    async deleteManual(id) {
      const rows = await db.delete(dossierItem).where(and(eq(dossierItem.id, id), eq(dossierItem.origin, "manual"))).returning({ id: dossierItem.id });
      return rows.length > 0;
    },

    async link(itemId, documentId) {
      await db.insert(dossierItemDocument).values({ itemId, documentId }).onConflictDoNothing();
    },

    async unlink(itemId, documentId) {
      await db.delete(dossierItemDocument).where(and(eq(dossierItemDocument.itemId, itemId), eq(dossierItemDocument.documentId, documentId)));
    },
  };
}
