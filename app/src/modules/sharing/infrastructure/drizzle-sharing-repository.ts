import { asc, desc, eq, sql } from "drizzle-orm";
import { shareLog, sharePackage, sharePackageItem } from "@/platform/db/schema";
import type { Db } from "@/platform/db/types";
import type { ConfidentialityLevel, ManifestInput, RecipientType } from "../domain/sharing";
import type { LogRow, PackageItemRow, PackageRow, SharingRepository } from "../application/ports";

const toPackage = (r: typeof sharePackage.$inferSelect): PackageRow => ({
  id: r.id,
  recipientType: r.recipientType as RecipientType,
  recipientName: r.recipientName,
  confidentialityCap: r.confidentialityCap as ConfidentialityLevel,
  note: r.note,
  fileCount: r.fileCount,
  totalBytes: r.totalBytes,
  manifestSha256: r.manifestSha256,
  snapshot: r.snapshot as ManifestInput,
  revoked: r.revokedAt !== null,
  createdAt: r.createdAt,
});

export function drizzleSharingRepository(db: Db): SharingRepository {
  return {
    async insertPackage(data) {
      const [row] = await db.insert(sharePackage).values(data).returning({ id: sharePackage.id });
      return row!.id;
    },
    async insertItems(packageId, items) {
      if (items.length > 0) await db.insert(sharePackageItem).values(items.map((i) => ({ ...i, packageId })));
    },
    async log(packageId, event) {
      await db.insert(shareLog).values({ packageId, event });
    },
    async getPackage(id) {
      const [row] = await db.select().from(sharePackage).where(eq(sharePackage.id, id));
      return row ? toPackage(row) : null;
    },
    async items(packageId) {
      return (await db.select().from(sharePackageItem).where(eq(sharePackageItem.packageId, packageId)).orderBy(asc(sharePackageItem.position))).map(
        (r): PackageItemRow => ({
          id: r.id,
          documentId: r.documentId,
          versionId: r.versionId,
          position: r.position,
          path: r.path,
          sha256: r.sha256,
          sizeBytes: r.sizeBytes,
          confidentiality: r.confidentiality as ConfidentialityLevel,
          overrideAboveCap: r.overrideAboveCap,
        }),
      );
    },
    async logs(packageId) {
      return (await db.select().from(shareLog).where(eq(shareLog.packageId, packageId)).orderBy(desc(shareLog.at))).map((r): LogRow => ({ id: r.id, event: r.event as LogRow["event"], at: r.at }));
    },
    async listPackages() {
      const rows = await db.select().from(sharePackage).orderBy(desc(sharePackage.createdAt));
      const counts = await db.select({ packageId: shareLog.packageId, n: sql<number>`count(*)::int` }).from(shareLog).where(eq(shareLog.event, "downloaded")).groupBy(shareLog.packageId);
      const byPackage = new Map(counts.map((c) => [c.packageId, c.n]));
      return rows.map((r) => ({ ...toPackage(r), downloads: byPackage.get(r.id) ?? 0 }));
    },
    async revoke(id) {
      const rows = await db.update(sharePackage).set({ revokedAt: new Date() }).where(eq(sharePackage.id, id)).returning({ id: sharePackage.id });
      return rows.length > 0;
    },
    async packagesForDocument(documentId) {
      const rows = await db
        .select({ p: sharePackage, override: sharePackageItem.overrideAboveCap })
        .from(sharePackageItem)
        .innerJoin(sharePackage, eq(sharePackage.id, sharePackageItem.packageId))
        .where(eq(sharePackageItem.documentId, documentId))
        .orderBy(desc(sharePackage.createdAt));
      return rows.map(({ p, override }) => ({ package: toPackage(p), override }));
    },
  };
}
