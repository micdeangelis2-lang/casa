import { changedKeys } from "@/shared/changed";
import { fail, failGeneral, ok, parseInput, type FieldErrors, type Result } from "@/shared/result";
import { ENGAGEMENT_STATUSES, deliverableSchema, engagementSchema, isEngagementOpen, type EngagementInput, type EngagementStatus } from "../domain/engagement";
import type { DeliverableRow, EngagementDeps, EngagementReadDeps, EngagementRow } from "./ports";

type Id = Result<{ id: string }>;

/** Controlla professionista, bene, pratica e documento: nessun riferimento puo' puntare a qualcosa che non esiste. */
async function refs(deps: EngagementDeps, v: { partyId?: string; assetId?: string; matterId?: string; documentId?: string }): Promise<FieldErrors> {
  const errors: FieldErrors = {};
  if (v.partyId && !(await deps.others.partyNames()).has(v.partyId)) errors.partyId = ["Il contatto non esiste più nella rubrica"];
  if (v.assetId && !(await deps.others.assetNames()).has(v.assetId)) errors.assetId = ["L'immobile non esiste"];
  if (v.matterId && !(await deps.others.matterTitles()).has(v.matterId)) errors.matterId = ["La pratica non esiste"];
  if (v.documentId && !(await deps.others.documentTitles([v.documentId])).has(v.documentId)) errors.documentId = ["Il documento non esiste"];
  return errors;
}

const data = (v: EngagementInput): Omit<EngagementRow, "id"> => ({
  partyId: v.partyId,
  assetId: v.assetId ?? null,
  matterId: v.matterId ?? null,
  subject: v.subject,
  engagedOn: v.engagedOn,
  declaredFeeCents: v.declaredFee ?? null,
  status: v.status,
  documentId: v.documentId ?? null,
  note: v.note ?? null,
});

export async function createEngagement(deps: EngagementDeps, raw: unknown): Promise<Id> {
  const p = parseInput(engagementSchema, raw);
  if (!p.ok) return p;
  const errors = await refs(deps, p.value);
  if (Object.keys(errors).length > 0) return fail(errors);
  const id = await deps.repo.insert(data(p.value));
  await deps.audit.record({ action: "engagement.create", entityType: "engagement", entityId: id, diff: { status: p.value.status, hasFee: p.value.declaredFee !== undefined, hasAsset: Boolean(p.value.assetId), hasMatter: Boolean(p.value.matterId) } });
  return ok({ id });
}

export async function updateEngagement(deps: EngagementDeps, id: string, raw: unknown): Promise<Id> {
  const current = await deps.repo.get(id);
  if (!current) return failGeneral("Incarico non trovato");
  const p = parseInput(engagementSchema, raw);
  if (!p.ok) return p;
  // Un riferimento che non cambia non si ricontrolla: un documento o un contatto archiviati restano validi.
  const errors = await refs(deps, {
    partyId: p.value.partyId === current.partyId ? undefined : p.value.partyId,
    assetId: p.value.assetId === (current.assetId ?? undefined) ? undefined : p.value.assetId,
    matterId: p.value.matterId === (current.matterId ?? undefined) ? undefined : p.value.matterId,
    documentId: p.value.documentId === (current.documentId ?? undefined) ? undefined : p.value.documentId,
  });
  if (Object.keys(errors).length > 0) return fail(errors);
  const next = data(p.value);
  await deps.repo.update(id, next);
  await deps.audit.record({ action: "engagement.update", entityType: "engagement", entityId: id, diff: { changed: changedKeys(current, { id, ...next }) } });
  return ok({ id });
}

export async function setEngagementStatus(deps: EngagementDeps, id: string, status: string): Promise<Id> {
  if (!(ENGAGEMENT_STATUSES as readonly string[]).includes(status)) return fail({ status: ["Stato non valido"] });
  const current = await deps.repo.get(id);
  if (!current) return failGeneral("Incarico non trovato");
  await deps.repo.update(id, { status: status as EngagementStatus });
  await deps.audit.record({ action: "engagement.status", entityType: "engagement", entityId: id, diff: { statusFrom: current.status, statusTo: status } });
  return ok({ id });
}

export async function addDeliverable(deps: EngagementDeps, engagementId: string, raw: unknown): Promise<Id> {
  const p = parseInput(deliverableSchema, raw);
  if (!p.ok) return p;
  if (!(await deps.repo.get(engagementId))) return failGeneral("Incarico non trovato");
  const errors = await refs(deps, { documentId: p.value.documentId });
  if (Object.keys(errors).length > 0) return fail(errors);
  const id = await deps.repo.insertDeliverable({ engagementId, direction: p.value.direction, kindLabel: p.value.kindLabel, occurredOn: p.value.occurredOn, documentId: p.value.documentId ?? null, note: p.value.note ?? null });
  await deps.audit.record({ action: "engagement.deliverable.add", entityType: "engagement", entityId: engagementId, diff: { deliverableId: id, direction: p.value.direction, hasDocument: Boolean(p.value.documentId) } });
  return ok({ id: engagementId });
}

export async function removeDeliverable(deps: EngagementDeps, deliverableId: string): Promise<Id> {
  const row = await deps.repo.getDeliverable(deliverableId);
  if (!row) return failGeneral("Elaborato non trovato");
  await deps.repo.deleteDeliverable(deliverableId);
  await deps.audit.record({ action: "engagement.deliverable.remove", entityType: "engagement", entityId: row.engagementId, diff: { deliverableId } });
  return ok({ id: row.engagementId });
}

// -------------------------------------------------------------------------------------------------- letture

export type EngagementItem = EngagementRow & {
  partyName: string;
  assetName: string | null;
  matterTitle: string | null;
  documentTitle: string | null;
  open: boolean;
  deliverables: (DeliverableRow & { documentTitle: string | null })[];
};

/** Gli incarichi (per professionista, bene o pratica) con i loro elaborati, dal piu' recente. I nomi vengono dagli altri moduli. */
export async function listEngagements(deps: EngagementReadDeps, filter: { partyId?: string; assetId?: string; matterId?: string } = {}): Promise<EngagementItem[]> {
  const rows = await deps.repo.list(filter);
  if (rows.length === 0) return [];
  const [deliverables, parties, assets, matters, titles] = await Promise.all([deps.repo.deliverables(rows.map((r) => r.id)), deps.others.partyNames(), deps.others.assetNames(), deps.others.matterTitles(), deps.others.documentTitles()]);
  return rows.map((r) => ({
    ...r,
    partyName: parties.get(r.partyId) ?? "—",
    assetName: r.assetId ? (assets.get(r.assetId) ?? null) : null,
    matterTitle: r.matterId ? (matters.get(r.matterId) ?? null) : null,
    documentTitle: r.documentId ? (titles.get(r.documentId) ?? null) : null,
    open: isEngagementOpen(r.status),
    deliverables: deliverables.filter((d) => d.engagementId === r.id).map((d) => ({ ...d, documentTitle: d.documentId ? (titles.get(d.documentId) ?? null) : null })),
  }));
}

/** Raggruppa per professionista (ordine alfabetico), mantenendo l'ordine degli incarichi. */
export function groupByProfessional(items: EngagementItem[]): { partyId: string; partyName: string; items: EngagementItem[] }[] {
  const groups = new Map<string, { partyId: string; partyName: string; items: EngagementItem[] }>();
  for (const item of items) {
    const group = groups.get(item.partyId) ?? { partyId: item.partyId, partyName: item.partyName, items: [] };
    group.items.push(item);
    groups.set(item.partyId, group);
  }
  return [...groups.values()].sort((a, b) => a.partyName.localeCompare(b.partyName, "it"));
}
