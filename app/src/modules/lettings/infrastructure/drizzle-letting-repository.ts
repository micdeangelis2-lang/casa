import { and, asc, desc, eq, gt, gte, inArray, lte, notExists, type SQL } from "drizzle-orm";
import type { Db } from "@/platform/db/types";
import { letting, lettingCode, lettingParty, lettingRent, lettingRentPayment, lettingReport } from "@/platform/db/schema";
import type { CodeRow, LettingPartyRow, LettingRepository, LettingRow, ReceiptRow, RentRow, ReportRow } from "../application/ports";
import type { LettingPartyRole, LettingStatus, LettingType, ReportKind } from "../domain/lettings";

const toLetting = (r: typeof letting.$inferSelect): LettingRow => ({
  id: r.id,
  assetId: r.assetId,
  type: r.type as LettingType,
  title: r.title,
  status: r.status as LettingStatus,
  startsOn: r.startsOn,
  endsOn: r.endsOn,
  managerPartyId: r.managerPartyId,
  monthlyRentCents: r.monthlyRentCents,
  depositCents: r.depositCents,
  depositReceivedOn: r.depositReceivedOn,
  depositReturnedOn: r.depositReturnedOn,
  depositReturnedCents: r.depositReturnedCents,
  registeredOn: r.registeredOn,
  registrationNumber: r.registrationNumber,
  registrationOffice: r.registrationOffice,
  contractDocumentId: r.contractDocumentId,
  note: r.note,
  deadlineId: r.deadlineId,
});
const toParty = (r: typeof lettingParty.$inferSelect): LettingPartyRow => ({ lettingId: r.lettingId, partyId: r.partyId, role: r.role as LettingPartyRole });
const toRent = (r: typeof lettingRent.$inferSelect): RentRow => ({ id: r.id, lettingId: r.lettingId, dueOn: r.dueOn, amountCents: r.amountCents, paidOn: r.paidOn, paidCents: r.paidCents, documentId: r.documentId, deadlineId: r.deadlineId });
const toReceipt = (r: typeof lettingRentPayment.$inferSelect): ReceiptRow => ({ id: r.id, rentId: r.rentId, paidOn: r.paidOn, amountCents: r.amountCents, method: r.method, documentId: r.documentId });
const toCode = (r: typeof lettingCode.$inferSelect): CodeRow => ({ id: r.id, lettingId: r.lettingId, label: r.label, value: r.value, issuer: r.issuer, issuedOn: r.issuedOn, validUntil: r.validUntil, note: r.note });
const toReport = (r: typeof lettingReport.$inferSelect): ReportRow => ({
  id: r.id,
  lettingId: r.lettingId,
  kind: r.kind as ReportKind,
  title: r.title,
  period: r.period,
  dueOn: r.dueOn,
  amountCents: r.amountCents,
  doneOn: r.doneOn,
  documentId: r.documentId,
  note: r.note,
  deadlineId: r.deadlineId,
});

export function drizzleLettingRepository(db: Db): LettingRepository {
  return {
    async insertLetting(d) {
      const [row] = await db.insert(letting).values(d).returning({ id: letting.id });
      return row!.id;
    },
    async updateLetting(id, d) {
      const rows = await db.update(letting).set(d).where(eq(letting.id, id)).returning({ id: letting.id });
      return rows.length > 0;
    },
    async getLetting(id) {
      const [row] = await db.select().from(letting).where(eq(letting.id, id));
      return row ? toLetting(row) : null;
    },
    async listLettings(filter) {
      const conditions: SQL[] = [];
      if (filter.assetId) conditions.push(eq(letting.assetId, filter.assetId));
      return (await db.select().from(letting).where(conditions.length > 0 ? and(...conditions) : undefined).orderBy(desc(letting.createdAt))).map(toLetting);
    },
    async activeTypesOfAsset(assetId) {
      return (await db.select({ type: letting.type }).from(letting).where(and(eq(letting.assetId, assetId), eq(letting.status, "active")))).map((r) => r.type as LettingType);
    },

    async parties(lettingId) {
      return (await db.select().from(lettingParty).where(eq(lettingParty.lettingId, lettingId))).map(toParty);
    },
    async addParty(d) {
      await db.insert(lettingParty).values(d).onConflictDoUpdate({ target: [lettingParty.lettingId, lettingParty.partyId], set: { role: d.role } });
    },
    async removeParty(lettingId, partyId) {
      await db.delete(lettingParty).where(and(eq(lettingParty.lettingId, lettingId), eq(lettingParty.partyId, partyId)));
    },

    async rents(lettingId) {
      return (await db.select().from(lettingRent).where(eq(lettingRent.lettingId, lettingId)).orderBy(asc(lettingRent.dueOn))).map(toRent);
    },
    async insertRents(rows) {
      if (rows.length === 0) return [];
      return (await db.insert(lettingRent).values(rows).returning({ id: lettingRent.id })).map((r) => r.id);
    },
    async deleteRents(lettingId) {
      await db.delete(lettingRent).where(eq(lettingRent.lettingId, lettingId));
    },
    async getRent(id) {
      const [row] = await db.select().from(lettingRent).where(eq(lettingRent.id, id));
      return row ? toRent(row) : null;
    },
    async receiptsBetween(from, to) {
      const receipts = await db
        .select({ receiptId: lettingRentPayment.id, rentId: lettingRent.id, paidOn: lettingRentPayment.paidOn, amountCents: lettingRentPayment.amountCents, documentId: lettingRentPayment.documentId, lettingId: letting.id, lettingTitle: letting.title, assetId: letting.assetId })
        .from(lettingRentPayment)
        .innerJoin(lettingRent, eq(lettingRent.id, lettingRentPayment.rentId))
        .innerJoin(letting, eq(letting.id, lettingRent.lettingId))
        .where(and(gte(lettingRentPayment.paidOn, from), lte(lettingRentPayment.paidOn, to)))
        .orderBy(asc(lettingRentPayment.paidOn));
      // Canoni con un importo pagato ma senza incassi (dati di un archivio precedente agli incassi): contano come un incasso unico.
      const legacy = await db
        .select({ rentId: lettingRent.id, paidOn: lettingRent.paidOn, amountCents: lettingRent.paidCents, documentId: lettingRent.documentId, lettingId: letting.id, lettingTitle: letting.title, assetId: letting.assetId })
        .from(lettingRent)
        .innerJoin(letting, eq(letting.id, lettingRent.lettingId))
        .where(and(gt(lettingRent.paidCents, 0), gte(lettingRent.paidOn, from), lte(lettingRent.paidOn, to), notExists(db.select({ one: lettingRentPayment.id }).from(lettingRentPayment).where(eq(lettingRentPayment.rentId, lettingRent.id)))));
      return [...receipts, ...legacy.map((r) => ({ ...r, receiptId: r.rentId, paidOn: r.paidOn! }))].sort((a, b) => a.paidOn.localeCompare(b.paidOn));
    },
    async receipts(rentId) {
      return (await db.select().from(lettingRentPayment).where(eq(lettingRentPayment.rentId, rentId)).orderBy(asc(lettingRentPayment.paidOn), asc(lettingRentPayment.createdAt))).map(toReceipt);
    },
    async receiptsOfRents(rentIds) {
      if (rentIds.length === 0) return [];
      return (await db.select().from(lettingRentPayment).where(inArray(lettingRentPayment.rentId, rentIds)).orderBy(asc(lettingRentPayment.paidOn), asc(lettingRentPayment.createdAt))).map(toReceipt);
    },
    async getReceipt(id) {
      const [row] = await db.select().from(lettingRentPayment).where(eq(lettingRentPayment.id, id));
      return row ? toReceipt(row) : null;
    },
    async insertReceipt(d) {
      const [row] = await db.insert(lettingRentPayment).values(d).returning({ id: lettingRentPayment.id });
      return row!.id;
    },
    async deleteReceipt(id) {
      await db.delete(lettingRentPayment).where(eq(lettingRentPayment.id, id));
    },
    async deleteReceiptsOf(rentId) {
      await db.delete(lettingRentPayment).where(eq(lettingRentPayment.rentId, rentId));
    },
    async deleteRent(id) {
      await db.delete(lettingRent).where(eq(lettingRent.id, id));
    },
    async updateRent(id, d) {
      await db.update(lettingRent).set(d).where(eq(lettingRent.id, id));
    },

    async codes(lettingId) {
      return (await db.select().from(lettingCode).where(eq(lettingCode.lettingId, lettingId)).orderBy(asc(lettingCode.createdAt))).map(toCode);
    },
    async insertCode(d) {
      const [row] = await db.insert(lettingCode).values(d).returning({ id: lettingCode.id });
      return row!.id;
    },
    async getCode(id) {
      const [row] = await db.select().from(lettingCode).where(eq(lettingCode.id, id));
      return row ? toCode(row) : null;
    },
    async deleteCode(id) {
      await db.delete(lettingCode).where(eq(lettingCode.id, id));
    },

    async reports(lettingId) {
      return (await db.select().from(lettingReport).where(eq(lettingReport.lettingId, lettingId)).orderBy(asc(lettingReport.dueOn), asc(lettingReport.createdAt))).map(toReport);
    },
    async insertReport(d) {
      const [row] = await db.insert(lettingReport).values(d).returning({ id: lettingReport.id });
      return row!.id;
    },
    async getReport(id) {
      const [row] = await db.select().from(lettingReport).where(eq(lettingReport.id, id));
      return row ? toReport(row) : null;
    },
    async updateReport(id, d) {
      await db.update(lettingReport).set(d).where(eq(lettingReport.id, id));
    },
    async deleteReport(id) {
      await db.delete(lettingReport).where(eq(lettingReport.id, id));
    },
  };
}
