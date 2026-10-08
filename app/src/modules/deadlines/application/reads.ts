import { addDays } from "@/shared/dates";
import { isOverdue } from "../domain/deadline";
import type { DeadlineDeps, DeadlineReadDeps, DeadlineRow, OccurrenceFilter, OccurrenceRow, OccurrenceView, ProofRow } from "./ports";

export type OccurrenceListItem = OccurrenceView & { overdue: boolean; daysLeft: number };

export const daysLeft = (dueOn: string, today: string) => Math.round((Date.parse(`${dueOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);

export type DeadlineView = "upcoming" | "overdue" | "open" | "done" | "all";

export async function listOccurrences(deps: DeadlineReadDeps, view: DeadlineView, filter: Omit<OccurrenceFilter, "statuses" | "before">, today: string, options: { windowDays?: number } = {}): Promise<OccurrenceListItem[]> {
  const base: OccurrenceFilter = { ...filter };
  if (view === "overdue") Object.assign(base, { statuses: ["open"], before: today });
  else if (view === "upcoming") Object.assign(base, { statuses: ["open"], from: today, to: addDays(today, options.windowDays ?? 90) });
  else if (view === "open") base.statuses = ["open"];
  else if (view === "done") base.statuses = ["done"];
  const rows = await deps.repo.listOccurrences(base);
  return rows.map((r) => ({ ...r, overdue: isOverdue(r, today), daysLeft: daysLeft(r.dueOn, today) }));
}

export type DeadlineDetail = {
  deadline: DeadlineRow & { assetName: string | null; responsibleName: string | null; professionalName: string | null };
  occurrences: (OccurrenceRow & { overdue: boolean; proofs: (ProofRow & { documentTitle: string | null })[] })[];
};

export async function getDeadlineDetail(deps: DeadlineReadDeps, id: string, today: string): Promise<DeadlineDetail | null> {
  const deadline = await deps.repo.getDeadline(id);
  if (!deadline) return null;
  const [assets, parties, occurrences] = await Promise.all([deps.others.assetNames(), deps.others.partyNames(), deps.repo.occurrencesOf(id)]);
  const proofs = await deps.repo.proofsOf(occurrences.map((o) => o.id));
  const titles = await deps.others.documentTitles(proofs.flatMap((p) => (p.documentId ? [p.documentId] : [])));
  return {
    deadline: {
      ...deadline,
      assetName: deadline.assetId ? (assets.get(deadline.assetId) ?? null) : null,
      responsibleName: deadline.responsiblePartyId ? (parties.get(deadline.responsiblePartyId) ?? null) : null,
      professionalName: deadline.professionalPartyId ? (parties.get(deadline.professionalPartyId) ?? null) : null,
    },
    occurrences: occurrences
      .map((o) => ({ ...o, overdue: isOverdue(o, today), proofs: proofs.filter((p) => p.occurrenceId === o.id).map((p) => ({ ...p, documentTitle: p.documentId ? (titles.get(p.documentId) ?? null) : null })) }))
      .sort((a, b) => b.dueOn.localeCompare(a.dueOn)),
  };
}

export async function listDeadlines(deps: DeadlineReadDeps, args: { assetId?: string; includeArchived?: boolean } = {}): Promise<DeadlineRow[]> {
  return deps.repo.listDeadlines(args);
}

export type Summary = { overdue: number; next7: number; next30: number; unreadNotifications: number };

export async function summary(deps: DeadlineReadDeps, today: string): Promise<Summary> {
  const [overdue, next30, unread] = await Promise.all([
    deps.repo.listOccurrences({ statuses: ["open"], before: today }),
    deps.repo.listOccurrences({ statuses: ["open"], from: today, to: addDays(today, 30) }),
    deps.repo.countUnread(),
  ]);
  return { overdue: overdue.length, next7: next30.filter((o) => o.dueOn <= addDays(today, 7)).length, next30: next30.length, unreadNotifications: unread };
}

export const listNotifications = (deps: DeadlineReadDeps, args: { unreadOnly: boolean; limit?: number }) => deps.repo.listNotifications({ unreadOnly: args.unreadOnly, limit: args.limit ?? 100 });
export const countUnread = (deps: DeadlineReadDeps) => deps.repo.countUnread();

export async function markNotificationRead(deps: DeadlineDeps, id: string | null): Promise<void> {
  await deps.repo.markRead(id);
  await deps.audit.record({ action: id ? "notification.read" : "notification.read_all", entityType: "notification", entityId: id ?? "all", diff: {} });
}
