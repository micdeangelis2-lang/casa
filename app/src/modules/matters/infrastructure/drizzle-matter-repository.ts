import { and, asc, desc, eq, ne } from "drizzle-orm";
import { matter, matterAssignment, matterDocument, matterDocumentRequest, matterEvent, professionalOpinion } from "@/platform/db/schema";
import type { Db } from "@/platform/db/types";
import type { EventKind, MatterStatus, OpinionNature, RequestStatus } from "../domain/matter";
import type { EventRow, MatterRepository, MatterRow, OpinionRow, RequestRow } from "../application/ports";

const toMatter = (r: typeof matter.$inferSelect): MatterRow => ({
  id: r.id,
  title: r.title,
  description: r.description,
  assetId: r.assetId,
  status: r.status as MatterStatus,
  openedOn: r.openedOn,
  closedOn: r.closedOn,
  officePartyId: r.officePartyId,
  protocolNumber: r.protocolNumber,
  submittedOn: r.submittedOn,
  responseDueOn: r.responseDueOn,
});

const toEvent = (r: typeof matterEvent.$inferSelect): EventRow => ({
  id: r.id,
  matterId: r.matterId,
  kind: r.kind as EventKind,
  occurredOn: r.occurredOn,
  title: r.title,
  note: r.note,
  partyId: r.partyId,
  documentId: r.documentId,
});

const toRequest = (r: typeof matterDocumentRequest.$inferSelect): RequestRow => ({
  id: r.id,
  matterId: r.matterId,
  title: r.title,
  requestedFromPartyId: r.requestedFromPartyId,
  status: r.status as RequestStatus,
  requestedOn: r.requestedOn,
  dueOn: r.dueOn,
  documentId: r.documentId,
  note: r.note,
});

const toOpinion = (r: typeof professionalOpinion.$inferSelect): OpinionRow => ({
  id: r.id,
  matterId: r.matterId,
  partyId: r.partyId,
  nature: r.nature as OpinionNature,
  summary: r.summary,
  issuedOn: r.issuedOn,
  documentId: r.documentId,
});

export function drizzleMatterRepository(db: Db): MatterRepository {
  return {
    async insert(data) {
      const [row] = await db.insert(matter).values(data).returning({ id: matter.id });
      return row!.id;
    },
    async update(id, patch) {
      const rows = await db.update(matter).set(patch).where(eq(matter.id, id)).returning({ id: matter.id });
      return rows.length > 0;
    },
    async get(id) {
      const [row] = await db.select().from(matter).where(eq(matter.id, id));
      return row ? toMatter(row) : null;
    },
    async list({ status, assetId, includeClosed }) {
      const conditions = [];
      if (status) conditions.push(eq(matter.status, status));
      else if (!includeClosed) conditions.push(ne(matter.status, "closed"));
      if (assetId) conditions.push(eq(matter.assetId, assetId));
      return (await db.select().from(matter).where(and(...conditions)).orderBy(desc(matter.openedOn), asc(matter.title))).map(toMatter);
    },
    async assignments(matterId) {
      return db.select({ partyId: matterAssignment.partyId, role: matterAssignment.role }).from(matterAssignment).where(eq(matterAssignment.matterId, matterId)).orderBy(asc(matterAssignment.createdAt));
    },
    async assign(matterId, partyId, role) {
      await db.insert(matterAssignment).values({ matterId, partyId, role }).onConflictDoUpdate({ target: [matterAssignment.matterId, matterAssignment.partyId], set: { role } });
    },
    async unassign(matterId, partyId) {
      await db.delete(matterAssignment).where(and(eq(matterAssignment.matterId, matterId), eq(matterAssignment.partyId, partyId)));
    },
    async requests(matterId) {
      return (await db.select().from(matterDocumentRequest).where(eq(matterDocumentRequest.matterId, matterId)).orderBy(asc(matterDocumentRequest.createdAt))).map(toRequest);
    },
    async getRequest(id) {
      const [row] = await db.select().from(matterDocumentRequest).where(eq(matterDocumentRequest.id, id));
      return row ? toRequest(row) : null;
    },
    async insertRequest(matterId, data) {
      const [row] = await db.insert(matterDocumentRequest).values({ matterId, ...data }).returning({ id: matterDocumentRequest.id });
      return row!.id;
    },
    async updateRequest(id, patch) {
      await db.update(matterDocumentRequest).set(patch).where(eq(matterDocumentRequest.id, id));
    },
    async opinions(matterId) {
      return (await db.select().from(professionalOpinion).where(eq(professionalOpinion.matterId, matterId)).orderBy(desc(professionalOpinion.createdAt))).map(toOpinion);
    },
    async insertOpinion(matterId, data) {
      const [row] = await db.insert(professionalOpinion).values({ matterId, ...data }).returning({ id: professionalOpinion.id });
      return row!.id;
    },
    async events(matterId) {
      return (await db.select().from(matterEvent).where(eq(matterEvent.matterId, matterId)).orderBy(desc(matterEvent.occurredOn), desc(matterEvent.createdAt))).map(toEvent);
    },
    async insertEvent(matterId, data) {
      const [row] = await db.insert(matterEvent).values({ matterId, ...data }).returning({ id: matterEvent.id });
      return row!.id;
    },
    async deleteEvent(matterId, eventId) {
      const rows = await db.delete(matterEvent).where(and(eq(matterEvent.matterId, matterId), eq(matterEvent.id, eventId))).returning({ id: matterEvent.id });
      return rows.length > 0;
    },
    async documentIds(matterId) {
      return (await db.select({ id: matterDocument.documentId }).from(matterDocument).where(eq(matterDocument.matterId, matterId))).map((r) => r.id);
    },
    async linkDocument(matterId, documentId) {
      await db.insert(matterDocument).values({ matterId, documentId }).onConflictDoNothing();
    },
    async unlinkDocument(matterId, documentId) {
      await db.delete(matterDocument).where(and(eq(matterDocument.matterId, matterId), eq(matterDocument.documentId, documentId)));
    },
  };
}
