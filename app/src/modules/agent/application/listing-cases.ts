import { changedKeys } from "@/shared/changed";
import { fail, failGeneral, ok, parseInput, type FieldErrors, type Result } from "@/shared/result";
import { engagementSchema, listingEventSchema, LISTING_STATUSES, type EngagementInput, type ListingEventInput, type ListingStatus } from "../domain/listing";
import type { EngagementRow, ListingDeps, ListingEventRow, ListingReadDeps } from "./ports";

type Id = Result<{ id: string }>;
const hasErrors = (e: FieldErrors) => Object.keys(e).length > 0;

async function refs(deps: ListingDeps, r: { assetId?: string; parties: (string | undefined)[]; documentId?: string }): Promise<FieldErrors> {
  const errors: FieldErrors = {};
  if (r.assetId && !(await deps.others.assetExists(r.assetId))) errors.assetId = ["L'immobile non esiste"];
  const wanted = r.parties.filter((x): x is string => Boolean(x));
  if (wanted.length > 0) {
    const known = await deps.others.partyNames();
    if (wanted.some((p) => !known.has(p))) errors.partyId = ["Il contatto non esiste più nella rubrica"];
  }
  if (r.documentId && !(await deps.others.documentTitles([r.documentId])).has(r.documentId)) errors.documentId = ["Il documento non esiste"];
  return errors;
}

const engagementData = (v: EngagementInput): Omit<EngagementRow, "id" | "assetId" | "status"> => ({
  kind: v.kind,
  agentPartyId: v.agentPartyId ?? null,
  startsOn: v.startsOn ?? null,
  endsOn: v.endsOn ?? null,
  exclusive: v.exclusive,
  askingCents: v.asking ?? null,
  commission: v.commission ?? null,
  documentId: v.documentId ?? null,
  note: v.note ?? null,
});

const eventData = (v: ListingEventInput): Omit<ListingEventRow, "id" | "engagementId"> => ({
  kind: v.kind,
  occurredOn: v.occurredOn,
  amountCents: v.amount ?? null,
  outcome: v.outcome ?? null,
  contactPartyId: v.contactPartyId ?? null,
  note: v.note ?? null,
});

/** L'importo e l'esito si indicano solo per una proposta o una controproposta. */
function eventRuleErrors(v: ListingEventInput): FieldErrors {
  const plain = v.kind === "visit" || v.kind === "note";
  const errors: FieldErrors = {};
  if (plain && v.amount !== undefined) errors.amount = ["L'importo si indica solo per una proposta o una controproposta"];
  if (plain && v.outcome !== undefined) errors.outcome = ["L'esito si indica solo per una proposta o una controproposta"];
  return errors;
}

/** Registra un mandato di vendita o affitto (agente dalla rubrica, durata, prezzo richiesto e provvigione scritti dal proprietario). */
export async function addEngagement(deps: ListingDeps, raw: unknown): Promise<Id> {
  const p = parseInput(engagementSchema, raw);
  if (!p.ok) return p;
  const v = p.value;
  const errors = await refs(deps, { assetId: v.assetId, parties: [v.agentPartyId], documentId: v.documentId });
  if (hasErrors(errors)) return fail(errors);
  const id = await deps.repo.insertEngagement({ assetId: v.assetId, ...engagementData(v), status: "active" });
  await deps.audit.record({ action: "agent.engagement.add", entityType: "listing_engagement", entityId: id, diff: { kind: v.kind, assetId: v.assetId, exclusive: v.exclusive } });
  return ok({ id: v.assetId });
}

/** Modifica un mandato (tipo, agente, durata, prezzo, provvigione, documento, note): stesse regole della registrazione; lo stato resta com'e'. */
export async function updateEngagement(deps: ListingDeps, id: string, raw: unknown): Promise<Id> {
  const row = await deps.repo.getEngagement(id);
  if (!row) return failGeneral("Mandato non trovato");
  const p = parseInput(engagementSchema, raw);
  if (!p.ok) return p;
  const v = p.value;
  if (v.assetId !== row.assetId) return failGeneral("Mandato non trovato");
  const errors = await refs(deps, { assetId: v.assetId, parties: [v.agentPartyId], documentId: v.documentId });
  if (hasErrors(errors)) return fail(errors);
  const data = engagementData(v);
  await deps.repo.updateEngagement(id, data);
  await deps.audit.record({ action: "agent.engagement.update", entityType: "listing_engagement", entityId: id, diff: { assetId: row.assetId, changed: changedKeys(row, { ...row, ...data }) } });
  return ok({ id: row.assetId });
}

export async function setEngagementStatus(deps: ListingDeps, id: string, status: string): Promise<Id> {
  if (!(LISTING_STATUSES as readonly string[]).includes(status)) return failGeneral("Stato non valido");
  const row = await deps.repo.getEngagement(id);
  if (!row) return failGeneral("Mandato non trovato");
  await deps.repo.updateEngagement(id, { status: status as ListingStatus });
  await deps.audit.record({ action: "agent.engagement.status", entityType: "listing_engagement", entityId: id, diff: { statusFrom: row.status, statusTo: status } });
  return ok({ id: row.assetId });
}

export async function removeEngagement(deps: ListingDeps, id: string): Promise<Id> {
  const row = await deps.repo.getEngagement(id);
  if (!row) return failGeneral("Mandato non trovato");
  await deps.repo.deleteEngagement(id);
  await deps.audit.record({ action: "agent.engagement.remove", entityType: "listing_engagement", entityId: id, diff: { assetId: row.assetId } });
  return ok({ id: row.assetId });
}

/** Aggiunge una visita, una proposta, una controproposta o una nota a un mandato. */
export async function addListingEvent(deps: ListingDeps, engagementId: string, raw: unknown): Promise<Id> {
  const p = parseInput(listingEventSchema, raw);
  if (!p.ok) return p;
  const engagement = await deps.repo.getEngagement(engagementId);
  if (!engagement) return failGeneral("Mandato non trovato");
  const v = p.value;
  const errors = await refs(deps, { parties: [v.contactPartyId] });
  if (hasErrors(errors)) return fail(errors);
  const rules = eventRuleErrors(v);
  if (hasErrors(rules)) return fail(rules);
  const id = await deps.repo.insertEvent({ engagementId, ...eventData(v) });
  await deps.audit.record({ action: "agent.engagement.event.add", entityType: "listing_engagement", entityId: engagementId, diff: { eventId: id, kind: v.kind } });
  return ok({ id: engagement.assetId });
}

/** Modifica una visita, una proposta, una controproposta o una nota: stesse regole dell'aggiunta; il mandato non cambia. */
export async function updateListingEvent(deps: ListingDeps, eventId: string, raw: unknown): Promise<Id> {
  const event = await deps.repo.getEvent(eventId);
  if (!event) return failGeneral("Voce non trovata");
  const engagement = await deps.repo.getEngagement(event.engagementId);
  if (!engagement) return failGeneral("Mandato non trovato");
  const p = parseInput(listingEventSchema, raw);
  if (!p.ok) return p;
  const v = p.value;
  const errors = await refs(deps, { parties: [v.contactPartyId] });
  if (hasErrors(errors)) return fail(errors);
  const rules = eventRuleErrors(v);
  if (hasErrors(rules)) return fail(rules);
  const data = eventData(v);
  await deps.repo.updateEvent(eventId, data);
  await deps.audit.record({ action: "agent.engagement.event.update", entityType: "listing_engagement", entityId: event.engagementId, diff: { eventId, changed: changedKeys(event, { ...event, ...data }) } });
  return ok({ id: engagement.assetId });
}

export async function removeListingEvent(deps: ListingDeps, eventId: string): Promise<Id> {
  const event = await deps.repo.getEvent(eventId);
  if (!event) return failGeneral("Voce non trovata");
  const engagement = await deps.repo.getEngagement(event.engagementId);
  await deps.repo.deleteEvent(eventId);
  await deps.audit.record({ action: "agent.engagement.event.remove", entityType: "listing_engagement", entityId: event.engagementId, diff: { eventId } });
  return ok({ id: engagement?.assetId ?? event.engagementId });
}

export type ListingEventItem = ListingEventRow & { contactName: string | null };
export type EngagementItem = EngagementRow & {
  agentName: string | null;
  documentTitle: string | null;
  events: ListingEventItem[];
  /** Conteggi dai dati registrati (nessuna valutazione). */
  counts: { visits: number; proposals: number };
};

/** I mandati di un immobile con visite e proposte, dal piu' recente. */
export async function listEngagements(deps: ListingReadDeps, assetId: string): Promise<EngagementItem[]> {
  const [rows, parties, titles] = await Promise.all([deps.repo.engagements(assetId), deps.others.partyNames(), deps.others.documentTitles()]);
  const events = await deps.repo.events(rows.map((r) => r.id));
  return rows.map((r) => {
    const own = events.filter((e) => e.engagementId === r.id).map((e) => ({ ...e, contactName: e.contactPartyId ? (parties.get(e.contactPartyId) ?? null) : null }));
    return {
      ...r,
      agentName: r.agentPartyId ? (parties.get(r.agentPartyId) ?? null) : null,
      documentTitle: r.documentId ? (titles.get(r.documentId) ?? null) : null,
      events: own,
      counts: { visits: own.filter((e) => e.kind === "visit").length, proposals: own.filter((e) => e.kind === "proposal" || e.kind === "counterproposal").length },
    };
  });
}
