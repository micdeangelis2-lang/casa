import { fail, failGeneral, ok, zodIssuesToErrors, type FieldErrors, type Result } from "@/shared/result";
import { assignmentSchema, eventSchema, matterInputSchema, opinionSchema, requestSchema, resolveRequestSchema, type MatterStatus } from "../domain/matter";
import type { AssignmentRow, EventRow, MatterDeps, MatterReadDeps, MatterRow, OpinionRow, RequestRow } from "./ports";

async function checkRefs(deps: MatterDeps, refs: { assetId?: string; partyIds?: (string | undefined)[]; documentId?: string }): Promise<FieldErrors> {
  const errors: FieldErrors = {};
  if (refs.assetId && !(await deps.others.assetNames()).has(refs.assetId)) errors.assetId = ["L'immobile non esiste più"];
  const wanted = (refs.partyIds ?? []).filter((x): x is string => Boolean(x));
  if (wanted.length > 0) {
    const parties = await deps.others.parties();
    if (wanted.some((id) => !parties.has(id))) errors.partyId = ["Il contatto non esiste più nella rubrica"];
  }
  if (refs.documentId && !(await deps.others.documentTitles([refs.documentId])).has(refs.documentId)) errors.documentId = ["Il documento non esiste"];
  return errors;
}

export async function createMatter(deps: MatterDeps, raw: unknown, today: string): Promise<Result<{ id: string }>> {
  const parsed = matterInputSchema.safeParse(raw);
  if (!parsed.success) return fail(zodIssuesToErrors(parsed.error));
  const errors = await checkRefs(deps, { assetId: parsed.data.assetId, partyIds: [parsed.data.officePartyId] });
  if (Object.keys(errors).length > 0) return fail(errors);
  const id = await deps.repo.insert({
    officePartyId: parsed.data.officePartyId ?? null,
    protocolNumber: parsed.data.protocolNumber ?? null,
    submittedOn: parsed.data.submittedOn ?? null,
    responseDueOn: parsed.data.responseDueOn ?? null,
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    assetId: parsed.data.assetId ?? null,
    status: parsed.data.status,
    openedOn: parsed.data.openedOn ?? today,
  });
  if (parsed.data.status === "closed") await deps.repo.update(id, { closedOn: today });
  await deps.audit.record({ action: "matter.create", entityType: "matter", entityId: id, diff: { status: parsed.data.status, assetId: parsed.data.assetId ?? null } });
  return ok({ id });
}

export async function updateMatter(deps: MatterDeps, id: string, raw: unknown, today: string): Promise<Result<{ id: string }>> {
  const parsed = matterInputSchema.safeParse(raw);
  if (!parsed.success) return fail(zodIssuesToErrors(parsed.error));
  const current = await deps.repo.get(id);
  if (!current) return failGeneral("Pratica non trovata");
  const errors = await checkRefs(deps, { assetId: parsed.data.assetId, partyIds: [parsed.data.officePartyId] });
  if (Object.keys(errors).length > 0) return fail(errors);

  const status = parsed.data.status;
  const closedOn = status === "closed" ? (current.closedOn ?? today) : null;
  const changed = [
    parsed.data.title !== current.title && "title",
    (parsed.data.description ?? null) !== current.description && "description",
    (parsed.data.assetId ?? null) !== current.assetId && "assetId",
    status !== current.status && "status",
    parsed.data.openedOn && parsed.data.openedOn !== current.openedOn && "openedOn",
    (parsed.data.officePartyId ?? null) !== current.officePartyId && "officePartyId",
    (parsed.data.protocolNumber ?? null) !== current.protocolNumber && "protocolNumber",
    (parsed.data.submittedOn ?? null) !== current.submittedOn && "submittedOn",
    (parsed.data.responseDueOn ?? null) !== current.responseDueOn && "responseDueOn",
  ].filter((f): f is string => typeof f === "string");
  await deps.repo.update(id, { title: parsed.data.title, description: parsed.data.description ?? null, assetId: parsed.data.assetId ?? null, status, openedOn: parsed.data.openedOn ?? current.openedOn,
    closedOn,
    officePartyId: parsed.data.officePartyId ?? null,
    protocolNumber: parsed.data.protocolNumber ?? null,
    submittedOn: parsed.data.submittedOn ?? null,
    responseDueOn: parsed.data.responseDueOn ?? null,
  });
  await deps.audit.record({ action: "matter.update", entityType: "matter", entityId: id, diff: { changed, statusFrom: current.status, statusTo: status } });
  return ok({ id });
}

export async function assignParty(deps: MatterDeps, matterId: string, raw: unknown): Promise<Result<{ id: string }>> {
  const parsed = assignmentSchema.safeParse(raw);
  if (!parsed.success) return fail(zodIssuesToErrors(parsed.error));
  if (!(await deps.repo.get(matterId))) return failGeneral("Pratica non trovata");
  const errors = await checkRefs(deps, { partyIds: [parsed.data.partyId] });
  if (Object.keys(errors).length > 0) return fail(errors);
  await deps.repo.assign(matterId, parsed.data.partyId, parsed.data.role ?? null);
  await deps.audit.record({ action: "matter.assign", entityType: "matter", entityId: matterId, diff: { partyId: parsed.data.partyId } });
  return ok({ id: matterId });
}

export async function unassignParty(deps: MatterDeps, matterId: string, partyId: string): Promise<Result<{ id: string }>> {
  if (!(await deps.repo.get(matterId))) return failGeneral("Pratica non trovata");
  await deps.repo.unassign(matterId, partyId);
  await deps.audit.record({ action: "matter.unassign", entityType: "matter", entityId: matterId, diff: { partyId } });
  return ok({ id: matterId });
}

export async function addRequest(deps: MatterDeps, matterId: string, raw: unknown, today: string): Promise<Result<{ id: string }>> {
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) return fail(zodIssuesToErrors(parsed.error));
  if (!(await deps.repo.get(matterId))) return failGeneral("Pratica non trovata");
  const errors = await checkRefs(deps, { partyIds: [parsed.data.requestedFromPartyId] });
  if (Object.keys(errors).length > 0) return fail(errors);
  const id = await deps.repo.insertRequest(matterId, {
    title: parsed.data.title,
    requestedFromPartyId: parsed.data.requestedFromPartyId ?? null,
    dueOn: parsed.data.dueOn ?? null,
    note: parsed.data.note ?? null,
    requestedOn: today,
  });
  await deps.audit.record({ action: "matter.request.add", entityType: "matter", entityId: matterId, diff: { requestId: id } });
  return ok({ id: matterId });
}

/** Segna una richiesta come ricevuta (con il documento), non disponibile, o la riapre. */
export async function resolveRequest(deps: MatterDeps, requestId: string, raw: unknown): Promise<Result<{ id: string }>> {
  const parsed = resolveRequestSchema.safeParse(raw);
  if (!parsed.success) return fail(zodIssuesToErrors(parsed.error));
  const request = await deps.repo.getRequest(requestId);
  if (!request) return failGeneral("Richiesta non trovata");
  const errors = await checkRefs(deps, { documentId: parsed.data.documentId });
  if (Object.keys(errors).length > 0) return fail(errors);
  const documentId = parsed.data.status === "received" ? (parsed.data.documentId ?? null) : null;
  await deps.repo.updateRequest(requestId, { status: parsed.data.status, documentId });
  if (documentId) await deps.repo.linkDocument(request.matterId, documentId);
  await deps.audit.record({ action: "matter.request.resolve", entityType: "matter", entityId: request.matterId, diff: { requestId, status: parsed.data.status, hasDocument: documentId !== null } });
  return ok({ id: request.matterId });
}

export async function addOpinion(deps: MatterDeps, matterId: string, raw: unknown): Promise<Result<{ id: string }>> {
  const parsed = opinionSchema.safeParse(raw);
  if (!parsed.success) return fail(zodIssuesToErrors(parsed.error));
  if (!(await deps.repo.get(matterId))) return failGeneral("Pratica non trovata");
  const errors = await checkRefs(deps, { partyIds: [parsed.data.partyId], documentId: parsed.data.documentId });
  if (Object.keys(errors).length > 0) return fail(errors);
  const id = await deps.repo.insertOpinion(matterId, {
    partyId: parsed.data.partyId,
    nature: parsed.data.nature,
    summary: parsed.data.summary,
    issuedOn: parsed.data.issuedOn ?? null,
    documentId: parsed.data.documentId ?? null,
  });
  if (parsed.data.documentId) await deps.repo.linkDocument(matterId, parsed.data.documentId);
  await deps.audit.record({ action: "matter.opinion.add", entityType: "matter", entityId: matterId, diff: { opinionId: id, nature: parsed.data.nature } });
  return ok({ id: matterId });
}

export async function addEvent(deps: MatterDeps, matterId: string, raw: unknown): Promise<Result<{ id: string }>> {
  const parsed = eventSchema.safeParse(raw);
  if (!parsed.success) return fail(zodIssuesToErrors(parsed.error));
  if (!(await deps.repo.get(matterId))) return failGeneral("Pratica non trovata");
  const errors = await checkRefs(deps, { partyIds: [parsed.data.partyId], documentId: parsed.data.documentId });
  if (Object.keys(errors).length > 0) return fail(errors);
  const id = await deps.repo.insertEvent(matterId, {
    kind: parsed.data.kind,
    occurredOn: parsed.data.occurredOn,
    title: parsed.data.title,
    note: parsed.data.note ?? null,
    partyId: parsed.data.partyId ?? null,
    documentId: parsed.data.documentId ?? null,
  });
  if (parsed.data.documentId) await deps.repo.linkDocument(matterId, parsed.data.documentId);
  await deps.audit.record({ action: "matter.event.add", entityType: "matter", entityId: matterId, diff: { eventId: id, kind: parsed.data.kind } });
  return ok({ id: matterId });
}

export async function removeEvent(deps: MatterDeps, matterId: string, eventId: string): Promise<Result<{ id: string }>> {
  if (!(await deps.repo.get(matterId))) return failGeneral("Pratica non trovata");
  if (!(await deps.repo.deleteEvent(matterId, eventId))) return failGeneral("Fatto non trovato");
  await deps.audit.record({ action: "matter.event.remove", entityType: "matter", entityId: matterId, diff: { eventId } });
  return ok({ id: matterId });
}

export async function linkMatterDocument(deps: MatterDeps, matterId: string, documentId: string): Promise<Result<{ id: string }>> {
  if (!(await deps.repo.get(matterId))) return failGeneral("Pratica non trovata");
  const errors = await checkRefs(deps, { documentId });
  if (Object.keys(errors).length > 0) return fail(errors);
  await deps.repo.linkDocument(matterId, documentId);
  await deps.audit.record({ action: "matter.document.link", entityType: "matter", entityId: matterId, diff: { documentId } });
  return ok({ id: matterId });
}

export async function unlinkMatterDocument(deps: MatterDeps, matterId: string, documentId: string): Promise<Result<{ id: string }>> {
  if (!(await deps.repo.get(matterId))) return failGeneral("Pratica non trovata");
  await deps.repo.unlinkDocument(matterId, documentId);
  await deps.audit.record({ action: "matter.document.unlink", entityType: "matter", entityId: matterId, diff: { documentId } });
  return ok({ id: matterId });
}

export type MatterListItem = MatterRow & { assetName: string | null; officeName: string | null; assignees: string[] };

export async function listMatters(deps: MatterReadDeps, args: { status?: MatterStatus; assetId?: string; includeClosed?: boolean } = {}): Promise<MatterListItem[]> {
  const [rows, assets, parties] = await Promise.all([deps.repo.list({ ...args, includeClosed: args.includeClosed ?? false }), deps.others.assetNames(), deps.others.parties()]);
  return Promise.all(
    rows.map(async (m) => ({
      ...m,
      assetName: m.assetId ? (assets.get(m.assetId) ?? null) : null,
      officeName: m.officePartyId ? (parties.get(m.officePartyId)?.name ?? null) : null,
      assignees: (await deps.repo.assignments(m.id)).map((a) => parties.get(a.partyId)?.name ?? ""),
    })),
  );
}

export type MatterDetail = MatterRow & {
  assetName: string | null;
  officeName: string | null;
  events: (EventRow & { partyName: string | null; documentTitle: string | null })[];
  assignments: (AssignmentRow & { name: string; roles: string[] })[];
  requests: (RequestRow & { requestedFromName: string | null; documentTitle: string | null })[];
  opinions: (OpinionRow & { partyName: string; documentTitle: string | null })[];
  documents: { id: string; title: string }[];
};

export async function getMatterDetail(deps: MatterReadDeps, id: string): Promise<MatterDetail | null> {
  const matter = await deps.repo.get(id);
  if (!matter) return null;
  const [assets, parties, assignments, requests, opinions, documentIds, events] = await Promise.all([
    deps.others.assetNames(),
    deps.others.parties(),
    deps.repo.assignments(id),
    deps.repo.requests(id),
    deps.repo.opinions(id),
    deps.repo.documentIds(id),
    deps.repo.events(id),
  ]);
  const linked = [...documentIds, ...requests.flatMap((r) => (r.documentId ? [r.documentId] : [])), ...opinions.flatMap((o) => (o.documentId ? [o.documentId] : [])), ...events.flatMap((e) => (e.documentId ? [e.documentId] : []))];
  const titles = await deps.others.documentTitles([...new Set(linked)]);
  return {
    ...matter,
    assetName: matter.assetId ? (assets.get(matter.assetId) ?? null) : null,
    officeName: matter.officePartyId ? (parties.get(matter.officePartyId)?.name ?? null) : null,
    events: events.map((e) => ({ ...e, partyName: e.partyId ? (parties.get(e.partyId)?.name ?? null) : null, documentTitle: e.documentId ? (titles.get(e.documentId) ?? null) : null })),
    assignments: assignments.map((a) => ({ ...a, name: parties.get(a.partyId)?.name ?? "", roles: parties.get(a.partyId)?.roles ?? [] })),
    requests: requests.map((r) => ({ ...r, requestedFromName: r.requestedFromPartyId ? (parties.get(r.requestedFromPartyId)?.name ?? null) : null, documentTitle: r.documentId ? (titles.get(r.documentId) ?? null) : null })),
    opinions: opinions.map((o) => ({ ...o, partyName: parties.get(o.partyId)?.name ?? "", documentTitle: o.documentId ? (titles.get(o.documentId) ?? null) : null })),
    documents: documentIds.flatMap((d) => (titles.has(d) ? [{ id: d, title: titles.get(d)! }] : [])),
  };
}
