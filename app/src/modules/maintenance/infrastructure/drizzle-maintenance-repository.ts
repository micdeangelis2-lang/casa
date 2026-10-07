import { and, asc, desc, eq, gte, inArray, isNull, lte, type SQL } from "drizzle-orm";
import type { Db } from "@/platform/db/types";
import { maintInspectionPlan, maintInvoice, maintProgress, maintQuote, maintWarranty, maintWork, plant, plantDocument } from "@/platform/db/schema";
import type { InvoiceRow, MaintenanceRepository, PlanRow, PlantRow, ProgressRow, QuoteRow, WarrantyRow, WorkRow } from "../application/ports";
import type { PlantKind, QuoteStatus, WorkStatus } from "../domain/maintenance";

const toWork = (r: typeof maintWork.$inferSelect): WorkRow => ({
  id: r.id,
  assetId: r.assetId,
  title: r.title,
  description: r.description,
  status: r.status as WorkStatus,
  supplierPartyId: r.supplierPartyId,
  plantId: r.plantId,
  scheduledOn: r.scheduledOn,
  startedOn: r.startedOn,
  completedOn: r.completedOn,
  budgetCents: r.budgetCents,
  note: r.note,
  deadlineId: r.deadlineId,
});
const toQuote = (r: typeof maintQuote.$inferSelect): QuoteRow => ({ id: r.id, workId: r.workId, supplierPartyId: r.supplierPartyId, amountCents: r.amountCents, quotedOn: r.quotedOn, validUntil: r.validUntil, status: r.status as QuoteStatus, documentId: r.documentId, note: r.note });
const toInvoice = (r: typeof maintInvoice.$inferSelect): InvoiceRow => ({ id: r.id, workId: r.workId, number: r.number, issuedOn: r.issuedOn, amountCents: r.amountCents, paidOn: r.paidOn, documentId: r.documentId, note: r.note });
const toProgress = (r: typeof maintProgress.$inferSelect): ProgressRow => ({ id: r.id, workId: r.workId, recordedOn: r.recordedOn, percent: r.percent, note: r.note });
const toWarranty = (r: typeof maintWarranty.$inferSelect): WarrantyRow => ({ id: r.id, assetId: r.assetId, workId: r.workId, plantId: r.plantId, title: r.title, startsOn: r.startsOn, endsOn: r.endsOn, supplierPartyId: r.supplierPartyId, documentId: r.documentId, note: r.note, deadlineId: r.deadlineId, archived: r.archivedAt !== null });
const toPlan = (r: typeof maintInspectionPlan.$inferSelect): PlanRow => ({ id: r.id, assetId: r.assetId, title: r.title, intervalMonths: r.intervalMonths, firstDueOn: r.firstDueOn, supplierPartyId: r.supplierPartyId, plantId: r.plantId, note: r.note, deadlineId: r.deadlineId, archived: r.archivedAt !== null });
const toPlant = (r: typeof plant.$inferSelect): PlantRow => ({ id: r.id, assetId: r.assetId, kind: r.kind as PlantKind, name: r.name, installedOn: r.installedOn, installerPartyId: r.installerPartyId, maintainerPartyId: r.maintainerPartyId, serialNumber: r.serialNumber, note: r.note, archived: r.archivedAt !== null });

/** `archived` (booleano del dominio) -> `archivedAt` (colonna). */
const archivedPatch = (archived: boolean | undefined) => (archived === undefined ? {} : { archivedAt: archived ? new Date() : null });

export function drizzleMaintenanceRepository(db: Db): MaintenanceRepository {
  return {
    async plants(filter) {
      const conditions: SQL[] = [];
      if (filter.assetId) conditions.push(eq(plant.assetId, filter.assetId));
      if (!filter.includeArchived) conditions.push(isNull(plant.archivedAt));
      return (await db.select().from(plant).where(conditions.length > 0 ? and(...conditions) : undefined).orderBy(asc(plant.name))).map(toPlant);
    },
    async insertPlant(d) {
      const { archived, ...rest } = d;
      const [row] = await db.insert(plant).values({ ...rest, ...archivedPatch(archived) }).returning({ id: plant.id });
      return row!.id;
    },
    async getPlant(id) {
      const [row] = await db.select().from(plant).where(eq(plant.id, id));
      return row ? toPlant(row) : null;
    },
    async updatePlant(id, d) {
      const { archived, ...rest } = d;
      await db.update(plant).set({ ...rest, ...archivedPatch(archived) }).where(eq(plant.id, id));
    },
    async plantDocumentIds(plantId) {
      return (await db.select({ id: plantDocument.documentId }).from(plantDocument).where(eq(plantDocument.plantId, plantId))).map((r) => r.id);
    },
    async plantDocumentLinks(plantIds) {
      if (plantIds.length === 0) return [];
      return db.select({ plantId: plantDocument.plantId, documentId: plantDocument.documentId }).from(plantDocument).where(inArray(plantDocument.plantId, plantIds));
    },
    async linkPlantDocument(plantId, documentId) {
      await db.insert(plantDocument).values({ plantId, documentId }).onConflictDoNothing();
    },
    async unlinkPlantDocument(plantId, documentId) {
      await db.delete(plantDocument).where(and(eq(plantDocument.plantId, plantId), eq(plantDocument.documentId, documentId)));
    },

    async insertWork(d) {
      const [row] = await db.insert(maintWork).values(d).returning({ id: maintWork.id });
      return row!.id;
    },
    async updateWork(id, d) {
      const rows = await db.update(maintWork).set(d).where(eq(maintWork.id, id)).returning({ id: maintWork.id });
      return rows.length > 0;
    },
    async getWork(id) {
      const [row] = await db.select().from(maintWork).where(eq(maintWork.id, id));
      return row ? toWork(row) : null;
    },
    async listWorks(filter) {
      const rows = await db
        .select()
        .from(maintWork)
        .where(filter.assetId ? eq(maintWork.assetId, filter.assetId) : undefined)
        .orderBy(desc(maintWork.createdAt));
      return rows.map(toWork);
    },

    async quotes(workId) {
      return (await db.select().from(maintQuote).where(eq(maintQuote.workId, workId)).orderBy(asc(maintQuote.createdAt))).map(toQuote);
    },
    async quotesOf(workIds) {
      return workIds.length === 0 ? [] : (await db.select().from(maintQuote).where(inArray(maintQuote.workId, workIds))).map(toQuote);
    },
    async insertQuote(d) {
      const [row] = await db.insert(maintQuote).values(d).returning({ id: maintQuote.id });
      return row!.id;
    },
    async getQuote(id) {
      const [row] = await db.select().from(maintQuote).where(eq(maintQuote.id, id));
      return row ? toQuote(row) : null;
    },
    async updateQuote(id, d) {
      await db.update(maintQuote).set(d).where(eq(maintQuote.id, id));
    },
    async deleteQuote(id) {
      await db.delete(maintQuote).where(eq(maintQuote.id, id));
    },

    async invoices(workId) {
      return (await db.select().from(maintInvoice).where(eq(maintInvoice.workId, workId)).orderBy(asc(maintInvoice.issuedOn), asc(maintInvoice.createdAt))).map(toInvoice);
    },
    async invoicesOf(workIds) {
      return workIds.length === 0 ? [] : (await db.select().from(maintInvoice).where(inArray(maintInvoice.workId, workIds))).map(toInvoice);
    },
    async paidInvoicesBetween(from, to) {
      const rows = await db
        .select({ invoiceId: maintInvoice.id, paidOn: maintInvoice.paidOn, amountCents: maintInvoice.amountCents, documentId: maintInvoice.documentId, number: maintInvoice.number, workId: maintWork.id, workTitle: maintWork.title, assetId: maintWork.assetId })
        .from(maintInvoice)
        .innerJoin(maintWork, eq(maintWork.id, maintInvoice.workId))
        .where(and(gte(maintInvoice.paidOn, from), lte(maintInvoice.paidOn, to)))
        .orderBy(asc(maintInvoice.paidOn));
      return rows.map((r) => ({ ...r, paidOn: r.paidOn! }));
    },
    async insertInvoice(d) {
      const [row] = await db.insert(maintInvoice).values(d).returning({ id: maintInvoice.id });
      return row!.id;
    },
    async getInvoice(id) {
      const [row] = await db.select().from(maintInvoice).where(eq(maintInvoice.id, id));
      return row ? toInvoice(row) : null;
    },
    async updateInvoice(id, d) {
      await db.update(maintInvoice).set(d).where(eq(maintInvoice.id, id));
    },
    async deleteInvoice(id) {
      await db.delete(maintInvoice).where(eq(maintInvoice.id, id));
    },

    async progress(workId) {
      return (await db.select().from(maintProgress).where(eq(maintProgress.workId, workId)).orderBy(asc(maintProgress.recordedOn), asc(maintProgress.createdAt))).map(toProgress);
    },
    async insertProgress(d) {
      const [row] = await db.insert(maintProgress).values(d).returning({ id: maintProgress.id });
      return row!.id;
    },
    async getProgress(id) {
      const [row] = await db.select().from(maintProgress).where(eq(maintProgress.id, id));
      return row ? toProgress(row) : null;
    },
    async deleteProgress(id) {
      await db.delete(maintProgress).where(eq(maintProgress.id, id));
    },

    async warranties(filter) {
      const conditions: SQL[] = [];
      if (filter.assetId) conditions.push(eq(maintWarranty.assetId, filter.assetId));
      if (!filter.includeArchived) conditions.push(isNull(maintWarranty.archivedAt));
      return (await db.select().from(maintWarranty).where(conditions.length > 0 ? and(...conditions) : undefined).orderBy(asc(maintWarranty.endsOn))).map(toWarranty);
    },
    async insertWarranty(d) {
      const { archived, ...rest } = d;
      const [row] = await db.insert(maintWarranty).values({ ...rest, ...archivedPatch(archived) }).returning({ id: maintWarranty.id });
      return row!.id;
    },
    async getWarranty(id) {
      const [row] = await db.select().from(maintWarranty).where(eq(maintWarranty.id, id));
      return row ? toWarranty(row) : null;
    },
    async updateWarranty(id, d) {
      const { archived, ...rest } = d;
      await db.update(maintWarranty).set({ ...rest, ...archivedPatch(archived) }).where(eq(maintWarranty.id, id));
    },

    async plans(filter) {
      const conditions: SQL[] = [];
      if (filter.assetId) conditions.push(eq(maintInspectionPlan.assetId, filter.assetId));
      if (!filter.includeArchived) conditions.push(isNull(maintInspectionPlan.archivedAt));
      return (await db.select().from(maintInspectionPlan).where(conditions.length > 0 ? and(...conditions) : undefined).orderBy(asc(maintInspectionPlan.title))).map(toPlan);
    },
    async insertPlan(d) {
      const { archived, ...rest } = d;
      const [row] = await db.insert(maintInspectionPlan).values({ ...rest, ...archivedPatch(archived) }).returning({ id: maintInspectionPlan.id });
      return row!.id;
    },
    async getPlan(id) {
      const [row] = await db.select().from(maintInspectionPlan).where(eq(maintInspectionPlan.id, id));
      return row ? toPlan(row) : null;
    },
    async updatePlan(id, d) {
      const { archived, ...rest } = d;
      await db.update(maintInspectionPlan).set({ ...rest, ...archivedPatch(archived) }).where(eq(maintInspectionPlan.id, id));
    },
  };
}
