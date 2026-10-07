import { asc, desc, eq, inArray } from "drizzle-orm";
import { listingEngagement, listingEvent } from "@/platform/db/schema";
import type { Db } from "@/platform/db/types";
import type { EngagementRow, ListingEventRow, ListingRepository } from "../application/ports";
import type { ListingEventKind, ListingKind, ListingOutcome, ListingStatus } from "../domain/listing";

const toEngagement = (r: typeof listingEngagement.$inferSelect): EngagementRow => ({
  id: r.id,
  assetId: r.assetId,
  kind: r.kind as ListingKind,
  agentPartyId: r.agentPartyId,
  startsOn: r.startsOn,
  endsOn: r.endsOn,
  exclusive: r.exclusive,
  askingCents: r.askingCents,
  commission: r.commission,
  documentId: r.documentId,
  note: r.note,
  status: r.status as ListingStatus,
});

const toEvent = (r: typeof listingEvent.$inferSelect): ListingEventRow => ({
  id: r.id,
  engagementId: r.engagementId,
  kind: r.kind as ListingEventKind,
  occurredOn: r.occurredOn,
  amountCents: r.amountCents,
  outcome: r.outcome as ListingOutcome | null,
  contactPartyId: r.contactPartyId,
  note: r.note,
});

export function drizzleListingRepository(db: Db): ListingRepository {
  return {
    async engagements(assetId) {
      return (await db.select().from(listingEngagement).where(eq(listingEngagement.assetId, assetId)).orderBy(desc(listingEngagement.createdAt))).map(toEngagement);
    },
    async insertEngagement(d) {
      const [row] = await db.insert(listingEngagement).values(d).returning({ id: listingEngagement.id });
      return row!.id;
    },
    async getEngagement(id) {
      const [row] = await db.select().from(listingEngagement).where(eq(listingEngagement.id, id));
      return row ? toEngagement(row) : null;
    },
    async updateEngagement(id, d) {
      await db.update(listingEngagement).set(d).where(eq(listingEngagement.id, id));
    },
    async deleteEngagement(id) {
      await db.delete(listingEngagement).where(eq(listingEngagement.id, id));
    },
    async events(engagementIds) {
      if (engagementIds.length === 0) return [];
      return (await db.select().from(listingEvent).where(inArray(listingEvent.engagementId, engagementIds)).orderBy(asc(listingEvent.occurredOn), asc(listingEvent.createdAt))).map(toEvent);
    },
    async insertEvent(d) {
      const [row] = await db.insert(listingEvent).values(d).returning({ id: listingEvent.id });
      return row!.id;
    },
    async updateEvent(id, d) {
      await db.update(listingEvent).set(d).where(eq(listingEvent.id, id));
    },
    async getEvent(id) {
      const [row] = await db.select().from(listingEvent).where(eq(listingEvent.id, id));
      return row ? toEvent(row) : null;
    },
    async deleteEvent(id) {
      await db.delete(listingEvent).where(eq(listingEvent.id, id));
    },
  };
}
