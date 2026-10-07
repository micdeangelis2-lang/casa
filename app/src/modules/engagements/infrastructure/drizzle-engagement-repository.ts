import { and, asc, desc, eq, inArray, type SQL } from "drizzle-orm";
import { engagement, matterDeliverable } from "@/platform/db/schema";
import type { Db } from "@/platform/db/types";
import type { DeliverableDirection, EngagementStatus } from "../domain/engagement";
import type { DeliverableRow, EngagementRepository, EngagementRow } from "../application/ports";

const toEngagement = (r: typeof engagement.$inferSelect): EngagementRow => ({
  id: r.id,
  partyId: r.partyId,
  assetId: r.assetId,
  matterId: r.matterId,
  subject: r.subject,
  engagedOn: r.engagedOn,
  declaredFeeCents: r.declaredFeeCents,
  status: r.status as EngagementStatus,
  documentId: r.documentId,
  note: r.note,
});
const toDeliverable = (r: typeof matterDeliverable.$inferSelect): DeliverableRow => ({
  id: r.id,
  engagementId: r.engagementId,
  direction: r.direction as DeliverableDirection,
  kindLabel: r.kindLabel,
  occurredOn: r.occurredOn,
  documentId: r.documentId,
  note: r.note,
});

export function drizzleEngagementRepository(db: Db): EngagementRepository {
  return {
    async list(filter) {
      const where: SQL[] = [];
      if (filter.partyId) where.push(eq(engagement.partyId, filter.partyId));
      if (filter.assetId) where.push(eq(engagement.assetId, filter.assetId));
      if (filter.matterId) where.push(eq(engagement.matterId, filter.matterId));
      return (await db.select().from(engagement).where(and(...where)).orderBy(desc(engagement.engagedOn), asc(engagement.createdAt))).map(toEngagement);
    },
    async get(id) {
      const [row] = await db.select().from(engagement).where(eq(engagement.id, id));
      return row ? toEngagement(row) : null;
    },
    async insert(d) {
      const [row] = await db.insert(engagement).values(d).returning({ id: engagement.id });
      return row!.id;
    },
    async update(id, d) {
      await db.update(engagement).set(d).where(eq(engagement.id, id));
    },
    async deliverables(engagementIds) {
      if (engagementIds.length === 0) return [];
      return (await db.select().from(matterDeliverable).where(inArray(matterDeliverable.engagementId, engagementIds)).orderBy(asc(matterDeliverable.occurredOn), asc(matterDeliverable.createdAt))).map(toDeliverable);
    },
    async getDeliverable(id) {
      const [row] = await db.select().from(matterDeliverable).where(eq(matterDeliverable.id, id));
      return row ? toDeliverable(row) : null;
    },
    async insertDeliverable(d) {
      const [row] = await db.insert(matterDeliverable).values(d).returning({ id: matterDeliverable.id });
      return row!.id;
    },
    async deleteDeliverable(id) {
      await db.delete(matterDeliverable).where(eq(matterDeliverable.id, id));
    },
  };
}
