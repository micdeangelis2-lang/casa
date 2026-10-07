import { and, asc, desc, eq, gte, inArray, lte, type SQL } from "drizzle-orm";
import type { Db } from "@/platform/db/types";
import { taxObligation, taxPayment, taxReturn, taxType } from "@/platform/db/schema";
import type { ObligationRow, PaymentRow, ReturnRow, TaxRepository, TaxTypeRow } from "../application/ports";
import type { PaymentKind, PaymentMethod, TaxKind } from "../domain/taxes";

const toType = (r: typeof taxType.$inferSelect): TaxTypeRow => ({ id: r.id, name: r.name, kind: r.kind as TaxKind, territoryId: r.territoryId, source: r.source, notes: r.notes, archived: r.archivedAt !== null });
const toObligation = (r: typeof taxObligation.$inferSelect): ObligationRow => ({
  id: r.id,
  assetId: r.assetId,
  taxTypeId: r.taxTypeId,
  year: r.year,
  label: r.label,
  dueOn: r.dueOn,
  expectedCents: r.expectedCents,
  status: r.status as ObligationRow["status"],
  closedOn: r.closedOn,
  closedNote: r.closedNote,
  askAdviser: r.askAdviser,
  note: r.note,
  deadlineId: r.deadlineId,
});
const toPayment = (r: typeof taxPayment.$inferSelect): PaymentRow => ({ id: r.id, obligationId: r.obligationId, paidOn: r.paidOn, amountCents: r.amountCents, method: r.method as PaymentMethod, kind: r.kind as PaymentKind, penaltyCents: r.penaltyCents, interestCents: r.interestCents, reference: r.reference, documentId: r.documentId, note: r.note });
const toReturn = (r: typeof taxReturn.$inferSelect): ReturnRow => ({
  id: r.id,
  title: r.title,
  taxTypeId: r.taxTypeId,
  assetId: r.assetId,
  year: r.year,
  dueOn: r.dueOn,
  filedOn: r.filedOn,
  protocol: r.protocol,
  documentId: r.documentId,
  askAdviser: r.askAdviser,
  note: r.note,
  deadlineId: r.deadlineId,
});

export function drizzleTaxRepository(db: Db): TaxRepository {
  return {
    async insertType(d) {
      const [row] = await db.insert(taxType).values({ name: d.name, kind: d.kind, territoryId: d.territoryId, source: d.source, notes: d.notes }).returning({ id: taxType.id });
      return row!.id;
    },
    async updateType(id, d) {
      const { archived, ...rest } = d;
      const rows = await db
        .update(taxType)
        .set({ ...rest, ...(archived !== undefined && { archivedAt: archived ? new Date() : null }) })
        .where(eq(taxType.id, id))
        .returning({ id: taxType.id });
      return rows.length > 0;
    },
    async getType(id) {
      const [row] = await db.select().from(taxType).where(eq(taxType.id, id));
      return row ? toType(row) : null;
    },
    async listTypes(includeArchived) {
      const rows = await db.select().from(taxType).orderBy(asc(taxType.name));
      return rows.map(toType).filter((t) => includeArchived || !t.archived);
    },

    async insertObligation(d) {
      const [row] = await db.insert(taxObligation).values(d).returning({ id: taxObligation.id });
      return row!.id;
    },
    async updateObligation(id, d) {
      const rows = await db.update(taxObligation).set(d).where(eq(taxObligation.id, id)).returning({ id: taxObligation.id });
      return rows.length > 0;
    },
    async getObligation(id) {
      const [row] = await db.select().from(taxObligation).where(eq(taxObligation.id, id));
      return row ? toObligation(row) : null;
    },
    async listObligations(filter) {
      const conditions: SQL[] = [];
      if (filter.year !== undefined) conditions.push(eq(taxObligation.year, filter.year));
      if (filter.assetId) conditions.push(eq(taxObligation.assetId, filter.assetId));
      if (filter.taxTypeId) conditions.push(eq(taxObligation.taxTypeId, filter.taxTypeId));
      const rows = await db
        .select()
        .from(taxObligation)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(taxObligation.year), asc(taxObligation.dueOn), asc(taxObligation.createdAt));
      return rows.map(toObligation);
    },

    async payments(obligationId) {
      return (await db.select().from(taxPayment).where(eq(taxPayment.obligationId, obligationId)).orderBy(asc(taxPayment.paidOn), asc(taxPayment.createdAt))).map(toPayment);
    },
    async paymentsOf(obligationIds) {
      if (obligationIds.length === 0) return [];
      return (await db.select().from(taxPayment).where(inArray(taxPayment.obligationId, obligationIds)).orderBy(asc(taxPayment.paidOn))).map(toPayment);
    },
    async insertPayment(d) {
      const [row] = await db.insert(taxPayment).values(d).returning({ id: taxPayment.id });
      return row!.id;
    },
    async paymentsBetween(from, to) {
      return db
        .select({ paymentId: taxPayment.id, paidOn: taxPayment.paidOn, amountCents: taxPayment.amountCents, kind: taxPayment.kind, penaltyCents: taxPayment.penaltyCents, interestCents: taxPayment.interestCents, documentId: taxPayment.documentId, obligationId: taxObligation.id, assetId: taxObligation.assetId, taxTypeId: taxObligation.taxTypeId, year: taxObligation.year, label: taxObligation.label })
        .from(taxPayment)
        .innerJoin(taxObligation, eq(taxObligation.id, taxPayment.obligationId))
        .where(and(gte(taxPayment.paidOn, from), lte(taxPayment.paidOn, to)))
        .orderBy(asc(taxPayment.paidOn))
        .then((rows) => rows.map((r) => ({ ...r, kind: r.kind as PaymentKind })));
    },
    async getPayment(id) {
      const [row] = await db.select().from(taxPayment).where(eq(taxPayment.id, id));
      return row ? toPayment(row) : null;
    },
    async deletePayment(id) {
      await db.delete(taxPayment).where(eq(taxPayment.id, id));
    },

    async insertReturn(d) {
      const [row] = await db.insert(taxReturn).values(d).returning({ id: taxReturn.id });
      return row!.id;
    },
    async updateReturn(id, d) {
      const rows = await db.update(taxReturn).set(d).where(eq(taxReturn.id, id)).returning({ id: taxReturn.id });
      return rows.length > 0;
    },
    async getReturn(id) {
      const [row] = await db.select().from(taxReturn).where(eq(taxReturn.id, id));
      return row ? toReturn(row) : null;
    },
    async listReturns(filter) {
      const conditions: SQL[] = [];
      if (filter.year !== undefined) conditions.push(eq(taxReturn.year, filter.year));
      if (filter.assetId) conditions.push(eq(taxReturn.assetId, filter.assetId));
      const rows = await db
        .select()
        .from(taxReturn)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(taxReturn.year), asc(taxReturn.dueOn), asc(taxReturn.createdAt));
      return rows.map(toReturn);
    },
  };
}
