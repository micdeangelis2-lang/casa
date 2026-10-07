import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, notInArray, or, sql, type SQL } from "drizzle-orm";
import { appSetting, asset, deadline, deadlineOccurrence, deadlineProof, holidayRule, notification } from "@/platform/db/schema";
import type { Db } from "@/platform/db/types";
import type { Calc } from "@/shared/calc";
import type { HolidayRule } from "../domain/holidays";
import type { CompletionKind, DeadlineCategory, OccurrenceStatus, Priority } from "../domain/deadline";
import type { DeadlineRepository, DeadlineRow, Level, NewDeadline, NotificationRow, OccurrenceRow, OccurrenceView } from "../application/ports";

const toDeadline = (r: typeof deadline.$inferSelect): DeadlineRow => ({
  id: r.id,
  title: r.title,
  description: r.description,
  category: r.category as DeadlineCategory,
  level: r.level as Level,
  legalBasis: r.legalBasis,
  assetId: r.assetId,
  responsiblePartyId: r.responsiblePartyId,
  professionalPartyId: r.professionalPartyId,
  matterId: r.matterId,
  calc: r.calc as Calc,
  shiftToBusinessDay: r.shiftToBusinessDay,
  priority: r.priority as Priority,
  consequences: r.consequences,
  requiredDocuments: r.requiredDocuments,
  leadDays: r.leadDays,
  proofRequired: r.proofRequired,
  origin: r.origin as "manual" | "rule",
  ruleKey: r.ruleKey,
  outcomeKey: r.outcomeKey,
  ruleVersionId: r.ruleVersionId,
  explanation: r.explanation,
  stale: r.stale,
  archived: r.archivedAt !== null,
});

const toOccurrence = (r: typeof deadlineOccurrence.$inferSelect): OccurrenceRow => ({
  id: r.id,
  deadlineId: r.deadlineId,
  dueOn: r.dueOn,
  status: r.status as OccurrenceStatus,
  completedOn: r.completedOn,
  completionKind: r.completionKind as CompletionKind | null,
  snoozedUntil: r.snoozedUntil,
  note: r.note,
});

const values = (d: Partial<NewDeadline>) => {
  const { description, legalBasis, assetId, responsiblePartyId, professionalPartyId, matterId, consequences, requiredDocuments, ruleKey, outcomeKey, ruleVersionId, explanation, ...rest } = d;
  return {
    ...rest,
    ...(description !== undefined && { description }),
    ...(legalBasis !== undefined && { legalBasis }),
    ...(assetId !== undefined && { assetId }),
    ...(responsiblePartyId !== undefined && { responsiblePartyId }),
    ...(professionalPartyId !== undefined && { professionalPartyId }),
    ...(matterId !== undefined && { matterId }),
    ...(consequences !== undefined && { consequences }),
    ...(requiredDocuments !== undefined && { requiredDocuments }),
    ...(ruleKey !== undefined && { ruleKey }),
    ...(outcomeKey !== undefined && { outcomeKey }),
    ...(ruleVersionId !== undefined && { ruleVersionId }),
    ...(explanation !== undefined && { explanation }),
  };
};

export function drizzleDeadlineRepository(db: Db): DeadlineRepository {
  const notificationRow = (n: typeof notification.$inferSelect, deadlineId: string): NotificationRow => ({
    id: n.id,
    occurrenceId: n.occurrenceId,
    deadlineId,
    leadDays: n.leadDays,
    dueOn: n.dueOn,
    title: n.title,
    body: n.body,
    readAt: n.readAt,
    emailSentAt: n.emailSentAt,
    emailError: n.emailError,
    createdAt: n.createdAt,
  });

  return {
    async insertDeadline(data) {
      const [row] = await db.insert(deadline).values(values(data) as typeof deadline.$inferInsert).returning({ id: deadline.id });
      return row!.id;
    },

    async updateDeadline(id, patch) {
      const { stale, ...rest } = patch;
      await db
        .update(deadline)
        .set({ ...values(rest), ...(stale !== undefined && { stale }) })
        .where(eq(deadline.id, id));
    },

    async getDeadline(id) {
      const [row] = await db.select().from(deadline).where(eq(deadline.id, id));
      return row ? toDeadline(row) : null;
    },

    async listDeadlines({ assetId, includeArchived }) {
      const conditions: (SQL | undefined)[] = [];
      if (!includeArchived) conditions.push(isNull(deadline.archivedAt));
      if (assetId) conditions.push(eq(deadline.assetId, assetId));
      return (await db.select().from(deadline).where(and(...conditions)).orderBy(asc(deadline.title))).map(toDeadline);
    },

    async derivedFor(assetId) {
      return (await db.select().from(deadline).where(and(eq(deadline.assetId, assetId), eq(deadline.origin, "rule")))).map(toDeadline);
    },

    async setArchived(id, archived) {
      const rows = await db.update(deadline).set({ archivedAt: archived ? new Date() : null }).where(eq(deadline.id, id)).returning({ id: deadline.id });
      return rows.length > 0;
    },

    async insertOccurrence(deadlineId, dueOn) {
      const rows = await db.insert(deadlineOccurrence).values({ deadlineId, dueOn }).onConflictDoNothing().returning({ id: deadlineOccurrence.id });
      return rows[0]?.id ?? null;
    },

    async occurrencesOf(deadlineId) {
      return (await db.select().from(deadlineOccurrence).where(eq(deadlineOccurrence.deadlineId, deadlineId)).orderBy(asc(deadlineOccurrence.dueOn))).map(toOccurrence);
    },

    async getOccurrence(id) {
      const [row] = await db.select().from(deadlineOccurrence).where(eq(deadlineOccurrence.id, id));
      return row ? toOccurrence(row) : null;
    },

    async updateOccurrence(id, patch) {
      await db.update(deadlineOccurrence).set(patch).where(eq(deadlineOccurrence.id, id));
    },

    async cancelOpenAfter(deadlineId, after, keep) {
      const conditions = [eq(deadlineOccurrence.deadlineId, deadlineId), eq(deadlineOccurrence.status, "open"), gt(deadlineOccurrence.dueOn, after)];
      if (keep.length > 0) conditions.push(notInArray(deadlineOccurrence.dueOn, keep));
      const rows = await db.update(deadlineOccurrence).set({ status: "cancelled", note: "Annullata: la regola di calcolo è cambiata" }).where(and(...conditions)).returning({ id: deadlineOccurrence.id });
      return rows.length;
    },

    async listOccurrences(filter) {
      const conditions: (SQL | undefined)[] = [];
      if (filter.statuses) conditions.push(inArray(deadlineOccurrence.status, filter.statuses));
      if (filter.from) conditions.push(gte(deadlineOccurrence.dueOn, filter.from));
      if (filter.to) conditions.push(lte(deadlineOccurrence.dueOn, filter.to));
      if (filter.before) conditions.push(lt(deadlineOccurrence.dueOn, filter.before));
      if (filter.assetId) conditions.push(eq(deadline.assetId, filter.assetId));
      if (filter.category) conditions.push(eq(deadline.category, filter.category));
      if (filter.deadlineId) conditions.push(eq(deadline.id, filter.deadlineId));
      if (!filter.includeArchived) conditions.push(isNull(deadline.archivedAt));
      const rows = await db
        .select({ o: deadlineOccurrence, d: deadline, assetName: asset.name })
        .from(deadlineOccurrence)
        .innerJoin(deadline, eq(deadline.id, deadlineOccurrence.deadlineId))
        .leftJoin(asset, eq(asset.id, deadline.assetId))
        .where(and(...conditions))
        .orderBy(asc(deadlineOccurrence.dueOn), asc(deadline.title));
      return rows.map(
        ({ o, d, assetName }): OccurrenceView => ({
          ...toOccurrence(o),
          title: d.title,
          category: d.category as DeadlineCategory,
          level: d.level as Level,
          priority: d.priority as Priority,
          assetId: d.assetId,
          assetName,
          proofRequired: d.proofRequired,
          stale: d.stale,
          origin: d.origin as "manual" | "rule",
          archived: d.archivedAt !== null,
          leadDays: d.leadDays,
        }),
      );
    },

    async addProof(occurrenceId, proof) {
      const [row] = await db.insert(deadlineProof).values({ occurrenceId, documentId: proof.documentId ?? null, reference: proof.reference ?? null }).returning({ id: deadlineProof.id });
      return row!.id;
    },

    async proofsOf(occurrenceIds) {
      if (occurrenceIds.length === 0) return [];
      return db.select({ id: deadlineProof.id, occurrenceId: deadlineProof.occurrenceId, documentId: deadlineProof.documentId, reference: deadlineProof.reference }).from(deadlineProof).where(inArray(deadlineProof.occurrenceId, occurrenceIds)).orderBy(asc(deadlineProof.createdAt));
    },

    async insertNotification(n) {
      const rows = await db.insert(notification).values(n).onConflictDoNothing().returning({ id: notification.id });
      return rows.length > 0;
    },

    async listNotifications({ unreadOnly, limit }) {
      const rows = await db
        .select({ n: notification, deadlineId: deadlineOccurrence.deadlineId })
        .from(notification)
        .innerJoin(deadlineOccurrence, eq(deadlineOccurrence.id, notification.occurrenceId))
        .where(and(isNull(notification.dismissedAt), unreadOnly ? isNull(notification.readAt) : undefined))
        .orderBy(desc(notification.createdAt), desc(notification.leadDays))
        .limit(limit);
      return rows.map(({ n, deadlineId }) => notificationRow(n, deadlineId));
    },

    async countUnread() {
      const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(notification).where(and(isNull(notification.readAt), isNull(notification.dismissedAt)));
      return row?.n ?? 0;
    },

    async markRead(id) {
      await db.update(notification).set({ readAt: new Date() }).where(and(isNull(notification.readAt), id ? eq(notification.id, id) : undefined));
    },

    async pendingEmails(limit, enabledSince) {
      const weekAgo = new Date(Date.now() - 7 * 86_400_000);
      const since = enabledSince > weekAgo ? enabledSince : weekAgo;
      const rows = await db
        .select({ n: notification, deadlineId: deadlineOccurrence.deadlineId })
        .from(notification)
        .innerJoin(deadlineOccurrence, eq(deadlineOccurrence.id, notification.occurrenceId))
        .where(and(isNull(notification.emailSentAt), gt(notification.createdAt, since)))
        .orderBy(asc(notification.createdAt))
        .limit(limit);
      return rows.map(({ n, deadlineId }) => notificationRow(n, deadlineId));
    },

    async setEmailResult(id, result) {
      await db
        .update(notification)
        .set("sentAt" in result ? { emailSentAt: result.sentAt, emailError: null } : { emailError: result.error })
        .where(eq(notification.id, id));
    },

    async holidayRulesFor(territoryChain) {
      const rows = await db
        .select()
        .from(holidayRule)
        .where(and(eq(holidayRule.active, true), territoryChain.length > 0 ? or(isNull(holidayRule.territoryId), inArray(holidayRule.territoryId, territoryChain)) : isNull(holidayRule.territoryId)));
      return rows.map((r): HolidayRule => (r.kind === "fixed" ? { kind: "fixed", month: r.month!, day: r.day! } : { kind: "easter_offset", offsetDays: r.offsetDays! }));
    },

    async getSetting(key) {
      const [row] = await db.select().from(appSetting).where(eq(appSetting.key, key));
      return row?.value;
    },

    async setSetting(key, value) {
      await db.insert(appSetting).values({ key, value }).onConflictDoUpdate({ target: appSetting.key, set: { value, updatedAt: new Date() } });
    },
  };
}
