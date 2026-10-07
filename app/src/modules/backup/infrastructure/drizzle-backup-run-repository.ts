import { desc, eq, sql } from "drizzle-orm";
import { auditLog, backupRun } from "@/platform/db/schema";
import type { Db } from "@/platform/db/types";
import type { BackupRunRepository, BackupRunRow } from "../application/ports";

const toRow = (r: typeof backupRun.$inferSelect): BackupRunRow => ({
  id: r.id,
  startedAt: r.startedAt,
  finishedAt: r.finishedAt,
  trigger: r.trigger as BackupRunRow["trigger"],
  status: r.status as BackupRunRow["status"],
  destinationKey: r.destinationKey,
  sizeBytes: r.sizeBytes,
  archiveSha256: r.archiveSha256,
  fileCount: r.fileCount,
  auditSeq: r.auditSeq,
  auditHash: r.auditHash,
  message: r.message,
});

export function drizzleBackupRunRepository(db: Db): BackupRunRepository {
  return {
    async insertRunning(trigger) {
      const [row] = await db.insert(backupRun).values({ trigger }).returning({ id: backupRun.id });
      return row!.id;
    },

    async complete(id, result) {
      await db
        .update(backupRun)
        .set({
          status: result.message ? "warning" : "completed",
          finishedAt: new Date(),
          destinationKey: result.destinationKey,
          sizeBytes: result.sizeBytes,
          archiveSha256: result.archiveSha256,
          fileCount: result.fileCount,
          auditSeq: result.auditSeq,
          auditHash: result.auditHash,
          message: result.message,
        })
        .where(eq(backupRun.id, id));
    },

    async fail(id, message) {
      await db.update(backupRun).set({ status: "failed", finishedAt: new Date(), message }).where(eq(backupRun.id, id));
    },

    async list(limit) {
      return (await db.select().from(backupRun).orderBy(desc(backupRun.startedAt)).limit(limit)).map(toRow);
    },

    async get(id) {
      const [row] = await db.select().from(backupRun).where(eq(backupRun.id, id));
      return row ? toRow(row) : null;
    },

    async currentAuditHead() {
      const [row] = await db.select({ seq: auditLog.seq, hash: auditLog.hash }).from(auditLog).orderBy(sql`${auditLog.seq} desc`).limit(1);
      return row ?? null;
    },
  };
}
