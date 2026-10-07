/**
 * Interfaccia pubblica del modulo Scadenze: definizioni con regola di calcolo relativa, date con stato e prove, avvisi
 * (in-app ed email) con preavvisi, rinvio ed escalation, giro giornaliero idempotente. Le scritture ricevono una
 * `UnitOfWork`, le letture un `Db`.
 */
import type { UnitOfWork } from "@/platform/db/unit-of-work";
import type { Db } from "@/platform/db/types";
import { getMailEnv } from "@/platform/config/env";
import { todayInItaly } from "@/platform/clock";
import { matter, user } from "@/platform/db/schema";
import { getAssetDetail, listAssets } from "@/modules/assets";
import { listParties } from "@/modules/directory";
import { documentTitles as readDocumentTitles } from "@/modules/documents";
import { territoryChainIds } from "@/modules/territory";
import { openDeadlinesCalendar, type CalendarLabels } from "./application/calendar";
import type { DeadlineCollaborators, MailPort } from "./application/ports";
import * as useCases from "./application/use-cases";
import { drizzleDeadlineRepository } from "./infrastructure/drizzle-deadline-repository";
import { noMail, resendMail } from "./infrastructure/mail";

export {
  
  DEADLINE_CATEGORIES,
  
  LEVELS,
  PRIORITIES,
  
  type CompletionKind,
  type DeadlineCategory,
  type Priority,
} from "./domain/deadline";
export type { CycleResult, DeadlineDetail, DeadlineView, NotificationSettings, OccurrenceListItem, Summary } from "./application/use-cases";
export type { DeadlineRow, MailPort, NotificationRow, OccurrenceView } from "./application/ports";
export type { CalendarLabels } from "./application/calendar";
export type { Explanation } from "@/modules/rules";
export { noMail, resendMail, todayInItaly };

function collaborators(db: Db): DeadlineCollaborators {
  return {
    async assetInfo(assetId) {
      const detail = await getAssetDetail(db, assetId);
      if (!detail) return null;
      return { name: detail.name, territoryChain: await territoryChainIds(db, detail.territoryId), attributes: detail.attributes };
    },
    assetNames: async () => new Map((await listAssets(db, { includeArchived: true })).map((a) => [a.id, a.name])),
    partyNames: async () => new Map((await listParties(db, { includeArchived: true })).map((p) => [p.id, p.displayName])),
    matterIds: async () => new Set((await db.select({ id: matter.id }).from(matter)).map((m) => m.id)),
    documentTitles: (ids) => readDocumentTitles(db, ids),
    ownerEmail: async () => (await db.select({ email: user.email }).from(user).limit(1))[0]?.email ?? null,
  };
}

/** Servizio email da configurazione (RESEND_API_KEY + MAIL_FROM), altrimenti nessuno. */
export function mailFromEnv(): MailPort {
  const env = getMailEnv();
  return env.RESEND_API_KEY && env.MAIL_FROM ? resendMail(env.RESEND_API_KEY, env.MAIL_FROM) : noMail;
}

const writeDeps = (uow: UnitOfWork) => ({ repo: drizzleDeadlineRepository(uow.tx), others: collaborators(uow.tx), audit: uow.audit });
const readDeps = (db: Db) => ({ repo: drizzleDeadlineRepository(db), others: collaborators(db) });

export const createDeadline = (uow: UnitOfWork, input: unknown, today = todayInItaly()) => useCases.createDeadline(writeDeps(uow), input, today);
export const updateDeadline = (uow: UnitOfWork, id: string, input: unknown, today = todayInItaly()) => useCases.updateDeadline(writeDeps(uow), id, input, today);
export const updateOwnerFields = (uow: UnitOfWork, id: string, input: Parameters<typeof useCases.updateOwnerFields>[2]) => useCases.updateOwnerFields(writeDeps(uow), id, input);
export const setDeadlineArchived = (uow: UnitOfWork, id: string, archived: boolean) => useCases.setDeadlineArchived(writeDeps(uow), id, archived);
export const syncDerivedDeadlines = (uow: UnitOfWork, assetId: string, derived: Parameters<typeof useCases.syncDerivedDeadlines>[2], today = todayInItaly()) =>
  useCases.syncDerivedDeadlines(writeDeps(uow), assetId, derived, today);

export const addOccurrence = (uow: UnitOfWork, deadlineId: string, dueOn: string) => useCases.addOccurrence(writeDeps(uow), deadlineId, dueOn);
export const completeOccurrence = (uow: UnitOfWork, occurrenceId: string, input: unknown, today = todayInItaly()) => useCases.completeOccurrence(writeDeps(uow), occurrenceId, input, today);
export const completeOpenOccurrences = (uow: UnitOfWork, deadlineId: string, input: { completedOn: string; reference: string }, today = todayInItaly()) => useCases.completeOpenOccurrences(writeDeps(uow), deadlineId, input, today);
export const addProof = (uow: UnitOfWork, occurrenceId: string, input: { documentId?: string; reference?: string }) => useCases.addProof(writeDeps(uow), occurrenceId, input);
export const reopenOccurrence = (uow: UnitOfWork, occurrenceId: string) => useCases.reopenOccurrence(writeDeps(uow), occurrenceId);
export const cancelOccurrence = (uow: UnitOfWork, occurrenceId: string) => useCases.cancelOccurrence(writeDeps(uow), occurrenceId);
export const snoozeOccurrence = (uow: UnitOfWork, occurrenceId: string, until: string, today = todayInItaly()) => useCases.snoozeOccurrence(writeDeps(uow), occurrenceId, until, today);
export const markNotificationRead = (uow: UnitOfWork, id: string | null) => useCases.markNotificationRead(writeDeps(uow), id);
export const runDailyCycle = (uow: UnitOfWork, options: { mail?: MailPort; baseUrl?: string; today?: string } = {}) =>
  useCases.runDailyCycle(writeDeps(uow), options.today ?? todayInItaly(), { mail: options.mail, baseUrl: options.baseUrl });
export const saveNotificationSettings = (uow: UnitOfWork, input: { emailEnabled: boolean; emailAddress: string }) => useCases.saveNotificationSettings(writeDeps(uow), input);

export const listOccurrences = (db: Db, view: useCases.DeadlineView, filter: Parameters<typeof useCases.listOccurrences>[2] = {}, today = todayInItaly(), options?: { windowDays?: number }) =>
  useCases.listOccurrences(readDeps(db), view, filter, today, options);
export const getDeadlineDetail = (db: Db, id: string, today = todayInItaly()) => useCases.getDeadlineDetail(readDeps(db), id, today);
export const listDeadlines = (db: Db, args: { assetId?: string; includeArchived?: boolean } = {}) => useCases.listDeadlines(readDeps(db), args);
export const deadlineSummary = (db: Db, today = todayInItaly()) => useCases.summary(readDeps(db), today);
export const listNotifications = (db: Db, args: { unreadOnly: boolean; limit?: number }) => useCases.listNotifications(readDeps(db), args);
export const countUnreadNotifications = (db: Db) => useCases.countUnread(readDeps(db));
export const getNotificationSettings = (db: Db) => useCases.getNotificationSettings(readDeps(db));

/** Il calendario `.ics` di tutte le scadenze aperte (non archiviate), con i preavvisi come promemoria. */
export async function deadlinesCalendar(db: Db, labels: CalendarLabels, options: { baseUrl?: string; now?: Date } = {}): Promise<string> {
  const open = await useCases.listOccurrences(readDeps(db), "open", {}, todayInItaly());
  return openDeadlinesCalendar(open, labels, options.now ?? new Date(), options.baseUrl);
}
