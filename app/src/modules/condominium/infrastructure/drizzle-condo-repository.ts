import { and, asc, desc, eq, gt, gte, lte, max } from "drizzle-orm";
import {
  condoAgendaDocument,
  condoAgendaItem,
  condoBudget,
  condoClaim,
  condoContract,
  condoDocument,
  condoFiscalYear,
  condoInstallment,
  condoMeeting,
  condoMembership,
  condoProxy,
  condoResolution,
  condoUnitOther,
  condoWork,
  condoWorkEntry,
  condominium,
  millesimalShare,
  millesimalTable,
} from "@/platform/db/schema";
import type { Db } from "@/platform/db/types";
import { milliFromDb, milliToDb } from "../domain/millesimi";
import type { BudgetKind, BudgetScope, ResolutionOutcome } from "../domain/condominium";
import type { AgendaRow, BudgetRow, ClaimRow, CondoRepository, CondominiumRow, ContractRow, InstallmentRow, MeetingRow, ResolutionRow, WorkEntryRow, WorkRow } from "../application/ports";

const toCondo = (r: typeof condominium.$inferSelect): CondominiumRow => ({ id: r.id, name: r.name, address: r.address, taxCode: r.taxCode, administratorPartyId: r.administratorPartyId, notes: r.notes, archived: r.archivedAt !== null });
const toBudget = (r: typeof condoBudget.$inferSelect): BudgetRow => ({ id: r.id, fiscalYearId: r.fiscalYearId, kind: r.kind as BudgetKind, title: r.title, totalCents: r.totalCents, millesimalTableId: r.millesimalTableId, scope: r.scope as BudgetScope, note: r.note, documentId: r.documentId });
const toInstallment = (r: typeof condoInstallment.$inferSelect): InstallmentRow => ({ id: r.id, budgetId: r.budgetId, assetId: r.assetId, number: r.number, dueOn: r.dueOn, amountCents: r.amountCents, paidCents: r.paidCents, paidOn: r.paidOn, documentId: r.documentId, deadlineId: r.deadlineId });
const toMeeting = (r: typeof condoMeeting.$inferSelect): MeetingRow => ({ id: r.id, condominiumId: r.condominiumId, kind: r.kind as MeetingRow["kind"], status: r.status as MeetingRow["status"], convenedOn: r.convenedOn, meetingOn: r.meetingOn, location: r.location, convocationDocumentId: r.convocationDocumentId, minutesDocumentId: r.minutesDocumentId, notes: r.notes });
const toResolution = (r: typeof condoResolution.$inferSelect): ResolutionRow => ({
  id: r.id,
  meetingId: r.meetingId,
  agendaItemId: r.agendaItemId,
  title: r.title,
  text: r.text,
  outcome: r.outcome as ResolutionOutcome,
  votesFor: milliFromDb(r.votesForMilli),
  votesAgainst: milliFromDb(r.votesAgainstMilli),
  votesAbstain: milliFromDb(r.votesAbstainMilli),
  threshold: milliFromDb(r.thresholdMilli),
  thresholdNote: r.thresholdNote,
  deadlineId: r.deadlineId,
  budgetId: r.budgetId,
});
const toWork = (r: typeof condoWork.$inferSelect): WorkRow => ({ id: r.id, condominiumId: r.condominiumId, title: r.title, status: r.status, budgetCents: r.budgetCents, resolutionId: r.resolutionId, note: r.note });
const toEntry = (r: typeof condoWorkEntry.$inferSelect): WorkEntryRow => ({ id: r.id, workId: r.workId, kind: r.kind as WorkEntryRow["kind"], title: r.title, amountCents: r.amountCents, entryOn: r.entryOn, documentId: r.documentId });
const toClaim = (r: typeof condoClaim.$inferSelect): ClaimRow => ({ id: r.id, condominiumId: r.condominiumId, kind: r.kind, title: r.title, description: r.description, status: r.status as ClaimRow["status"], openedOn: r.openedOn, closedOn: r.closedOn, matterId: r.matterId });
const toContract = (r: typeof condoContract.$inferSelect): ContractRow => ({ id: r.id, condominiumId: r.condominiumId, kind: r.kind as ContractRow["kind"], title: r.title, counterpartyPartyId: r.counterpartyPartyId, validFrom: r.validFrom, validTo: r.validTo, documentId: r.documentId, note: r.note });

const resolutionSet = (d: Partial<Omit<ResolutionRow, "id" | "meetingId">>) => ({
  ...(d.agendaItemId !== undefined && { agendaItemId: d.agendaItemId }),
  ...(d.title !== undefined && { title: d.title }),
  ...(d.text !== undefined && { text: d.text }),
  ...(d.outcome !== undefined && { outcome: d.outcome }),
  ...(d.votesFor !== undefined && { votesForMilli: milliToDb(d.votesFor) }),
  ...(d.votesAgainst !== undefined && { votesAgainstMilli: milliToDb(d.votesAgainst) }),
  ...(d.votesAbstain !== undefined && { votesAbstainMilli: milliToDb(d.votesAbstain) }),
  ...(d.threshold !== undefined && { thresholdMilli: milliToDb(d.threshold) }),
  ...(d.thresholdNote !== undefined && { thresholdNote: d.thresholdNote }),
  ...(d.deadlineId !== undefined && { deadlineId: d.deadlineId }),
  ...(d.budgetId !== undefined && { budgetId: d.budgetId }),
});

export function drizzleCondoRepository(db: Db): CondoRepository {
  return {
    async insertCondominium(d) {
      const [row] = await db
        .insert(condominium)
        .values({ name: d.name, address: d.address, taxCode: d.taxCode, administratorPartyId: d.administratorPartyId, notes: d.notes })
        .returning({ id: condominium.id });
      return row!.id;
    },
    async updateCondominium(id, d) {
      const { archived, ...rest } = d;
      const rows = await db.update(condominium).set({ ...rest, ...(archived !== undefined && { archivedAt: archived ? new Date() : null }) }).where(eq(condominium.id, id)).returning({ id: condominium.id });
      return rows.length > 0;
    },
    async getCondominium(id) {
      const [row] = await db.select().from(condominium).where(eq(condominium.id, id));
      return row ? toCondo(row) : null;
    },
    async listCondominiums(includeArchived) {
      const rows = await db.select().from(condominium).orderBy(asc(condominium.name));
      return rows.map(toCondo).filter((c) => includeArchived || !c.archived);
    },

    async members(condoId) {
      return db.select({ id: condoMembership.id, condominiumId: condoMembership.condominiumId, assetId: condoMembership.assetId, unitLabel: condoMembership.unitLabel }).from(condoMembership).where(eq(condoMembership.condominiumId, condoId)).orderBy(asc(condoMembership.createdAt));
    },
    async addMember(condoId, assetId, unitLabel) {
      await db.insert(condoMembership).values({ condominiumId: condoId, assetId, unitLabel });
    },
    async removeMember(condoId, assetId) {
      await db.delete(condoMembership).where(and(eq(condoMembership.condominiumId, condoId), eq(condoMembership.assetId, assetId)));
    },
    async condominiumOfAsset(assetId) {
      const [row] = await db.select({ id: condoMembership.condominiumId }).from(condoMembership).where(eq(condoMembership.assetId, assetId));
      return row?.id ?? null;
    },

    async tables(condoId) {
      return db.select({ id: millesimalTable.id, condominiumId: millesimalTable.condominiumId, name: millesimalTable.name, note: millesimalTable.note }).from(millesimalTable).where(eq(millesimalTable.condominiumId, condoId)).orderBy(asc(millesimalTable.createdAt));
    },
    async insertTable(condoId, d) {
      const [row] = await db.insert(millesimalTable).values({ condominiumId: condoId, ...d }).returning({ id: millesimalTable.id });
      return row!.id;
    },
    async getTable(id) {
      const [row] = await db.select({ id: millesimalTable.id, condominiumId: millesimalTable.condominiumId, name: millesimalTable.name, note: millesimalTable.note }).from(millesimalTable).where(eq(millesimalTable.id, id));
      return row ?? null;
    },
    async shares(tableId) {
      return (await db.select().from(millesimalShare).where(eq(millesimalShare.tableId, tableId))).map((r) => ({ tableId: r.tableId, assetId: r.assetId, milli: milliFromDb(r.value)! }));
    },
    async others(tableId) {
      return (await db.select().from(condoUnitOther).where(eq(condoUnitOther.tableId, tableId)).orderBy(asc(condoUnitOther.createdAt), asc(condoUnitOther.label))).map((r) => ({ id: r.id, tableId: r.tableId, label: r.label, milli: milliFromDb(r.value)! }));
    },
    async replaceOthers(tableId, rows) {
      await db.delete(condoUnitOther).where(eq(condoUnitOther.tableId, tableId));
      if (rows.length > 0) await db.insert(condoUnitOther).values(rows.map((r) => ({ tableId, label: r.label, value: milliToDb(r.milli)! })));
    },
    async replaceShares(tableId, rows) {
      await db.delete(millesimalShare).where(eq(millesimalShare.tableId, tableId));
      if (rows.length > 0) await db.insert(millesimalShare).values(rows.map((r) => ({ tableId, assetId: r.assetId, value: milliToDb(r.milli)! })));
    },

    async years(condoId) {
      return db.select({ id: condoFiscalYear.id, condominiumId: condoFiscalYear.condominiumId, label: condoFiscalYear.label, startsOn: condoFiscalYear.startsOn, endsOn: condoFiscalYear.endsOn }).from(condoFiscalYear).where(eq(condoFiscalYear.condominiumId, condoId)).orderBy(desc(condoFiscalYear.startsOn));
    },
    async insertYear(condoId, d) {
      const [row] = await db.insert(condoFiscalYear).values({ condominiumId: condoId, ...d }).returning({ id: condoFiscalYear.id });
      return row!.id;
    },
    async getYear(id) {
      const [row] = await db.select({ id: condoFiscalYear.id, condominiumId: condoFiscalYear.condominiumId, label: condoFiscalYear.label, startsOn: condoFiscalYear.startsOn, endsOn: condoFiscalYear.endsOn }).from(condoFiscalYear).where(eq(condoFiscalYear.id, id));
      return row ?? null;
    },
    async budgets(yearId) {
      return (await db.select().from(condoBudget).where(eq(condoBudget.fiscalYearId, yearId)).orderBy(asc(condoBudget.createdAt))).map(toBudget);
    },
    async insertBudget(yearId, d) {
      const [row] = await db.insert(condoBudget).values({ fiscalYearId: yearId, ...d }).returning({ id: condoBudget.id });
      return row!.id;
    },
    async getBudget(id) {
      const [row] = await db.select().from(condoBudget).where(eq(condoBudget.id, id));
      return row ? toBudget(row) : null;
    },
    async installments(budgetId) {
      return (await db.select().from(condoInstallment).where(eq(condoInstallment.budgetId, budgetId)).orderBy(asc(condoInstallment.dueOn), asc(condoInstallment.number))).map(toInstallment);
    },
    async insertInstallments(rows) {
      if (rows.length === 0) return [];
      return (await db.insert(condoInstallment).values(rows).returning({ id: condoInstallment.id })).map((r) => r.id);
    },
    async deleteInstallments(budgetId) {
      await db.delete(condoInstallment).where(eq(condoInstallment.budgetId, budgetId));
    },
    async paidInstallmentsBetween(from, to) {
      const rows = await db
        .select({ installmentId: condoInstallment.id, paidOn: condoInstallment.paidOn, paidCents: condoInstallment.paidCents, documentId: condoInstallment.documentId, number: condoInstallment.number, assetId: condoInstallment.assetId, budgetTitle: condoBudget.title, condominiumId: condoFiscalYear.condominiumId })
        .from(condoInstallment)
        .innerJoin(condoBudget, eq(condoBudget.id, condoInstallment.budgetId))
        .innerJoin(condoFiscalYear, eq(condoFiscalYear.id, condoBudget.fiscalYearId))
        .where(and(gte(condoInstallment.paidOn, from), lte(condoInstallment.paidOn, to), gt(condoInstallment.paidCents, 0)))
        .orderBy(asc(condoInstallment.paidOn));
      return rows.map((r) => ({ ...r, paidOn: r.paidOn! }));
    },
    async getInstallment(id) {
      const [row] = await db.select().from(condoInstallment).where(eq(condoInstallment.id, id));
      return row ? toInstallment(row) : null;
    },
    async updateInstallment(id, d) {
      await db.update(condoInstallment).set(d).where(eq(condoInstallment.id, id));
    },

    async meetings(condoId) {
      return (await db.select().from(condoMeeting).where(eq(condoMeeting.condominiumId, condoId)).orderBy(desc(condoMeeting.meetingOn))).map(toMeeting);
    },
    async insertMeeting(condoId, d) {
      const [row] = await db.insert(condoMeeting).values({ condominiumId: condoId, ...d }).returning({ id: condoMeeting.id });
      return row!.id;
    },
    async updateMeeting(id, d) {
      const rows = await db.update(condoMeeting).set(d).where(eq(condoMeeting.id, id)).returning({ id: condoMeeting.id });
      return rows.length > 0;
    },
    async getMeeting(id) {
      const [row] = await db.select().from(condoMeeting).where(eq(condoMeeting.id, id));
      return row ? toMeeting(row) : null;
    },
    async agenda(meetingId) {
      const rows = await db.select().from(condoAgendaItem).where(eq(condoAgendaItem.meetingId, meetingId)).orderBy(asc(condoAgendaItem.position));
      const docs = await db.select().from(condoAgendaDocument);
      return rows.map((r): AgendaRow => ({ id: r.id, meetingId: r.meetingId, position: r.position, title: r.title, description: r.description, questions: r.questions, documentIds: docs.filter((d) => d.agendaItemId === r.id).map((d) => d.documentId) }));
    },
    async insertAgendaItem(meetingId, d) {
      const [current] = await db.select({ n: max(condoAgendaItem.position) }).from(condoAgendaItem).where(eq(condoAgendaItem.meetingId, meetingId));
      const [row] = await db.insert(condoAgendaItem).values({ meetingId, position: (current?.n ?? 0) + 1, ...d }).returning({ id: condoAgendaItem.id });
      return row!.id;
    },
    async updateAgendaItem(id, d) {
      const rows = await db.update(condoAgendaItem).set(d).where(eq(condoAgendaItem.id, id)).returning({ id: condoAgendaItem.id });
      return rows.length > 0;
    },
    async getAgendaItem(id) {
      const [row] = await db.select().from(condoAgendaItem).where(eq(condoAgendaItem.id, id));
      if (!row) return null;
      const docs = await db.select().from(condoAgendaDocument).where(eq(condoAgendaDocument.agendaItemId, id));
      return { id: row.id, meetingId: row.meetingId, position: row.position, title: row.title, description: row.description, questions: row.questions, documentIds: docs.map((d) => d.documentId) };
    },
    async deleteAgendaItem(id) {
      await db.delete(condoAgendaItem).where(eq(condoAgendaItem.id, id));
    },
    async setAgendaDocument(agendaItemId, documentId, linked) {
      if (linked) await db.insert(condoAgendaDocument).values({ agendaItemId, documentId }).onConflictDoNothing();
      else await db.delete(condoAgendaDocument).where(and(eq(condoAgendaDocument.agendaItemId, agendaItemId), eq(condoAgendaDocument.documentId, documentId)));
    },
    async proxies(meetingId) {
      return db.select({ id: condoProxy.id, meetingId: condoProxy.meetingId, delegatePartyId: condoProxy.delegatePartyId, note: condoProxy.note, documentId: condoProxy.documentId }).from(condoProxy).where(eq(condoProxy.meetingId, meetingId)).orderBy(asc(condoProxy.createdAt));
    },
    async insertProxy(meetingId, d) {
      const [row] = await db.insert(condoProxy).values({ meetingId, ...d }).returning({ id: condoProxy.id });
      return row!.id;
    },
    async deleteProxy(id) {
      await db.delete(condoProxy).where(eq(condoProxy.id, id));
    },
    async resolutions(meetingId) {
      return (await db.select().from(condoResolution).where(eq(condoResolution.meetingId, meetingId)).orderBy(asc(condoResolution.createdAt))).map(toResolution);
    },
    async insertResolution(meetingId, d) {
      const [row] = await db.insert(condoResolution).values({ meetingId, ...resolutionSet(d) } as typeof condoResolution.$inferInsert).returning({ id: condoResolution.id });
      return row!.id;
    },
    async updateResolution(id, d) {
      const rows = await db.update(condoResolution).set(resolutionSet(d)).where(eq(condoResolution.id, id)).returning({ id: condoResolution.id });
      return rows.length > 0;
    },
    async getResolution(id) {
      const [row] = await db.select().from(condoResolution).where(eq(condoResolution.id, id));
      return row ? toResolution(row) : null;
    },

    async works(condoId) {
      return (await db.select().from(condoWork).where(eq(condoWork.condominiumId, condoId)).orderBy(desc(condoWork.createdAt))).map(toWork);
    },
    async insertWork(condoId, d) {
      const [row] = await db.insert(condoWork).values({ condominiumId: condoId, ...d }).returning({ id: condoWork.id });
      return row!.id;
    },
    async updateWork(id, d) {
      const rows = await db.update(condoWork).set(d).where(eq(condoWork.id, id)).returning({ id: condoWork.id });
      return rows.length > 0;
    },
    async getWork(id) {
      const [row] = await db.select().from(condoWork).where(eq(condoWork.id, id));
      return row ? toWork(row) : null;
    },
    async entries(workId) {
      return (await db.select().from(condoWorkEntry).where(eq(condoWorkEntry.workId, workId)).orderBy(asc(condoWorkEntry.createdAt))).map(toEntry);
    },
    async insertEntry(workId, d) {
      const [row] = await db.insert(condoWorkEntry).values({ workId, ...d }).returning({ id: condoWorkEntry.id });
      return row!.id;
    },

    async claims(condoId) {
      return (await db.select().from(condoClaim).where(eq(condoClaim.condominiumId, condoId)).orderBy(desc(condoClaim.openedOn))).map(toClaim);
    },
    async insertClaim(condoId, d) {
      const [row] = await db.insert(condoClaim).values({ condominiumId: condoId, ...d }).returning({ id: condoClaim.id });
      return row!.id;
    },
    async updateClaim(id, d) {
      const rows = await db.update(condoClaim).set(d).where(eq(condoClaim.id, id)).returning({ id: condoClaim.id });
      return rows.length > 0;
    },
    async getClaim(id) {
      const [row] = await db.select().from(condoClaim).where(eq(condoClaim.id, id));
      return row ? toClaim(row) : null;
    },

    async contracts(condoId) {
      return (await db.select().from(condoContract).where(eq(condoContract.condominiumId, condoId)).orderBy(asc(condoContract.title))).map(toContract);
    },
    async insertContract(condoId, d) {
      const [row] = await db.insert(condoContract).values({ condominiumId: condoId, ...d }).returning({ id: condoContract.id });
      return row!.id;
    },

    async documents(condoId) {
      return db.select({ documentId: condoDocument.documentId, kind: condoDocument.kind }).from(condoDocument).where(eq(condoDocument.condominiumId, condoId));
    },
    async linkDocument(condoId, documentId, kind) {
      await db.insert(condoDocument).values({ condominiumId: condoId, documentId, kind }).onConflictDoUpdate({ target: [condoDocument.condominiumId, condoDocument.documentId], set: { kind } });
    },
    async unlinkDocument(condoId, documentId) {
      await db.delete(condoDocument).where(and(eq(condoDocument.condominiumId, condoId), eq(condoDocument.documentId, documentId)));
    },
  };
}
