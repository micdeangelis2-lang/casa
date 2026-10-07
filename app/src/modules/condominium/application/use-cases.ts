import { fail, failGeneral, ok, parseInput, type FieldErrors, type Result } from "@/shared/result";
import {
  agendaItemSchema,
  budgetSchema,
  claimSchema,
  condominiumInputSchema,
  contractSchema,
  fiscalYearSchema,
  followUpDeadlineSchema,
  installmentPlanSchema,
  isPaid,
  meetingSchema,
  membershipSchema,
  millesimalTableSchema,
  otherSharesSchema,
  paymentSchema,
  proxySchema,
  resolutionSchema,
  sharesSchema,
  workEntrySchema,
  workSchema,
  DOCUMENT_KINDS,
} from "../domain/condominium";
import { allocateOwnerParts, checkVotes, installmentDates, parseMilli, splitEvenly, tableTotals, type VoteCheck } from "../domain/millesimi";
import type {
  AgendaRow,
  BudgetRow,
  ClaimRow,
  CondoDeps,
  CondoReadDeps,
  CondominiumRow,
  ContractRow,
  InstallmentRow,
  MeetingRow,
  OtherShareRow,
  MemberRow,
  ProxyRow,
  ResolutionRow,
  ShareRow,
  TableRow,
  WorkEntryRow,
  WorkRow,
  YearRow,
} from "./ports";

type Id = Result<{ id: string }>;

async function refs(deps: CondoDeps, r: { parties?: (string | undefined)[]; documents?: (string | undefined)[]; matter?: string }): Promise<FieldErrors> {
  const errors: FieldErrors = {};
  const wantedParties = (r.parties ?? []).filter((x): x is string => Boolean(x));
  if (wantedParties.length > 0) {
    const known = await deps.others.parties();
    if (wantedParties.some((p) => !known.has(p))) errors.partyId = ["Il contatto non esiste più nella rubrica"];
  }
  const wantedDocuments = (r.documents ?? []).filter((x): x is string => Boolean(x));
  if (wantedDocuments.length > 0) {
    const known = await deps.others.documentTitles();
    if (wantedDocuments.some((d) => !known.has(d))) errors.documentId = ["Il documento non esiste"];
  }
  if (r.matter && !(await deps.others.matterTitles()).has(r.matter)) errors.matterId = ["La pratica non esiste"];
  return errors;
}
const hasErrors = (e: FieldErrors) => Object.keys(e).length > 0;

// -------------------------------------------------------------------------------------------------- condominio e membri

export async function createCondominium(deps: CondoDeps, raw: unknown): Promise<Id> {
  const p = parseInput(condominiumInputSchema, raw);
  if (!p.ok) return p;
  const errors = await refs(deps, { parties: [p.value.administratorPartyId] });
  if (hasErrors(errors)) return fail({ administratorPartyId: errors.partyId! });
  const id = await deps.repo.insertCondominium({ name: p.value.name, address: p.value.address ?? null, taxCode: p.value.taxCode ?? null, administratorPartyId: p.value.administratorPartyId ?? null, notes: p.value.notes ?? null, archived: false });
  await deps.audit.record({ action: "condominium.create", entityType: "condominium", entityId: id, diff: {} });
  return ok({ id });
}

export async function updateCondominium(deps: CondoDeps, id: string, raw: unknown): Promise<Id> {
  const p = parseInput(condominiumInputSchema, raw);
  if (!p.ok) return p;
  if (!(await deps.repo.getCondominium(id))) return failGeneral("Condominio non trovato");
  const errors = await refs(deps, { parties: [p.value.administratorPartyId] });
  if (hasErrors(errors)) return fail({ administratorPartyId: errors.partyId! });
  await deps.repo.updateCondominium(id, { name: p.value.name, address: p.value.address ?? null, taxCode: p.value.taxCode ?? null, administratorPartyId: p.value.administratorPartyId ?? null, notes: p.value.notes ?? null });
  await deps.audit.record({ action: "condominium.update", entityType: "condominium", entityId: id, diff: {} });
  return ok({ id });
}

export async function setCondominiumArchived(deps: CondoDeps, id: string, archived: boolean): Promise<Id> {
  if (!(await deps.repo.updateCondominium(id, { archived }))) return failGeneral("Condominio non trovato");
  await deps.audit.record({ action: archived ? "condominium.archive" : "condominium.restore", entityType: "condominium", entityId: id, diff: {} });
  return ok({ id });
}

export async function addMember(deps: CondoDeps, condoId: string, raw: unknown): Promise<Id> {
  const p = parseInput(membershipSchema, raw);
  if (!p.ok) return p;
  if (!(await deps.repo.getCondominium(condoId))) return failGeneral("Condominio non trovato");
  if (!(await deps.others.assets()).some((a) => a.id === p.value.assetId)) return fail({ assetId: ["L'immobile non esiste"] });
  const other = await deps.repo.condominiumOfAsset(p.value.assetId);
  if (other) return fail({ assetId: [other === condoId ? "Questo immobile fa già parte del condominio" : "Questo immobile fa già parte di un altro condominio"] });
  await deps.repo.addMember(condoId, p.value.assetId, p.value.unitLabel ?? null);
  await deps.audit.record({ action: "condominium.member.add", entityType: "condominium", entityId: condoId, diff: { assetId: p.value.assetId } });
  return ok({ id: condoId });
}

export async function removeMember(deps: CondoDeps, condoId: string, assetId: string): Promise<Id> {
  if (!(await deps.repo.getCondominium(condoId))) return failGeneral("Condominio non trovato");
  await deps.repo.removeMember(condoId, assetId);
  await deps.audit.record({ action: "condominium.member.remove", entityType: "condominium", entityId: condoId, diff: { assetId } });
  return ok({ id: condoId });
}

// -------------------------------------------------------------------------------------------------- millesimi

export async function createTable(deps: CondoDeps, condoId: string, raw: unknown): Promise<Id> {
  const p = parseInput(millesimalTableSchema, raw);
  if (!p.ok) return p;
  if (!(await deps.repo.getCondominium(condoId))) return failGeneral("Condominio non trovato");
  const id = await deps.repo.insertTable(condoId, { name: p.value.name, note: p.value.note ?? null });
  await deps.audit.record({ action: "condominium.table.create", entityType: "condominium", entityId: condoId, diff: { tableId: id } });
  return ok({ id: condoId });
}

/** Sostituisce i valori di una tabella. Gli immobili devono far parte del condominio. La somma non e' imposta: si mostra. */
export async function saveShares(deps: CondoDeps, tableId: string, raw: unknown): Promise<Result<{ id: string; total: number; differsFromThousand: boolean }>> {
  const p = parseInput(sharesSchema, raw);
  if (!p.ok) return p;
  const table = await deps.repo.getTable(tableId);
  if (!table) return failGeneral("Tabella non trovata");
  const members = new Set((await deps.repo.members(table.condominiumId)).map((m) => m.assetId));
  const errors: FieldErrors = {};
  const rows: { assetId: string; milli: number }[] = [];
  p.value.forEach((s, i) => {
    if (s.value === "") return;
    const milli = parseMilli(s.value);
    if (milli === null) (errors[`shares.${i}`] ??= []).push("Millesimi non validi (es. 48,25)");
    else if (!members.has(s.assetId)) (errors[`shares.${i}`] ??= []).push("L'immobile non fa parte del condominio");
    else rows.push({ assetId: s.assetId, milli });
  });
  if (hasErrors(errors)) return fail(errors);
  await deps.repo.replaceShares(tableId, rows);
  const totals = tableTotals(rows.map((r) => r.milli));
  await deps.audit.record({ action: "condominium.shares.save", entityType: "condominium", entityId: table.condominiumId, diff: { tableId, rows: rows.length, differsFromThousand: totals.differsFromThousand } });
  return ok({ id: table.condominiumId, ...totals });
}

/**
 * Sostituisce i millesimi delle unita' degli ALTRI condomini di una tabella (una riga per voce). Servono al totale del palazzo
 * dei preventivi «del palazzo». Righe senza nome e senza valore si ignorano; la somma con quella del proprietario non e' imposta.
 */
export async function saveOtherShares(deps: CondoDeps, tableId: string, raw: unknown): Promise<Result<{ id: string; total: number }>> {
  const p = parseInput(otherSharesSchema, raw);
  if (!p.ok) return p;
  const table = await deps.repo.getTable(tableId);
  if (!table) return failGeneral("Tabella non trovata");
  const errors: FieldErrors = {};
  const rows: { label: string; milli: number }[] = [];
  p.value.forEach((s, i) => {
    if (s.value === "" && s.label === "") return;
    const milli = s.value === "" ? null : parseMilli(s.value);
    if (milli === null) (errors[`others.${i}`] ??= []).push("Millesimi non validi (es. 48,25)");
    else if (s.label === "") (errors[`others.${i}`] ??= []).push("Scrivi il nome della voce (per esempio «Altri condomini»)");
    else rows.push({ label: s.label, milli });
  });
  if (hasErrors(errors)) return fail(errors);
  await deps.repo.replaceOthers(tableId, rows);
  await deps.audit.record({ action: "condominium.others.save", entityType: "condominium", entityId: table.condominiumId, diff: { tableId, rows: rows.length } });
  return ok({ id: table.condominiumId, total: rows.reduce((n, r) => n + r.milli, 0) });
}

// -------------------------------------------------------------------------------------------------- esercizi, preventivi, rate

export async function createFiscalYear(deps: CondoDeps, condoId: string, raw: unknown): Promise<Id> {
  const p = parseInput(fiscalYearSchema, raw);
  if (!p.ok) return p;
  if (!(await deps.repo.getCondominium(condoId))) return failGeneral("Condominio non trovato");
  const id = await deps.repo.insertYear(condoId, p.value);
  await deps.audit.record({ action: "condominium.year.create", entityType: "condominium", entityId: condoId, diff: { yearId: id } });
  return ok({ id: condoId });
}

export async function createBudget(deps: CondoDeps, yearId: string, raw: unknown): Promise<Id> {
  const p = parseInput(budgetSchema, raw);
  if (!p.ok) return p;
  const year = await deps.repo.getYear(yearId);
  if (!year) return failGeneral("Esercizio non trovato");
  if (p.value.millesimalTableId) {
    const table = await deps.repo.getTable(p.value.millesimalTableId);
    if (!table || table.condominiumId !== year.condominiumId) return fail({ millesimalTableId: ["La tabella non è di questo condominio"] });
  }
  const errors = await refs(deps, { documents: [p.value.documentId] });
  if (hasErrors(errors)) return fail(errors);
  const id = await deps.repo.insertBudget(yearId, { kind: p.value.kind, title: p.value.title, totalCents: p.value.total, millesimalTableId: p.value.millesimalTableId ?? null, scope: p.value.scope, note: p.value.note ?? null, documentId: p.value.documentId ?? null });
  await deps.audit.record({ action: "condominium.budget.create", entityType: "condominium", entityId: year.condominiumId, diff: { budgetId: id, kind: p.value.kind, scope: p.value.scope } });
  return ok({ id: year.condominiumId });
}

/**
 * Ripartisce un preventivo tra gli immobili del condominio in proporzione ai millesimi della tabella scelta (resto maggiore) e
 * divide ogni quota in rate. Se il totale e' del solo proprietario (`owner_only`, predefinito) la somma delle quote e' esattamente
 * il totale; se e' del palazzo (`building`) il totale si divide per il totale del palazzo (millesimi del proprietario piu' quelli
 * degli altri registrati, almeno 1000) e il proprietario riceve solo la sua parte. Le cifre sono un'ipotesi di ripartizione
 * calcolata sui dati inseriti: non sostituiscono quelle dell'amministratore.
 */
export async function generateInstallments(deps: CondoDeps, budgetId: string, raw: unknown): Promise<Result<{ id: string; created: number; shareTotalCents: number }>> {
  const p = parseInput(installmentPlanSchema, raw);
  if (!p.ok) return p;
  const budget = await deps.repo.getBudget(budgetId);
  if (!budget) return failGeneral("Preventivo non trovato");
  if (!budget.millesimalTableId) return fail({ _: ["Scegli prima la tabella millesimale del preventivo"] });
  const year = await deps.repo.getYear(budget.fiscalYearId);
  const shares = await deps.repo.shares(budget.millesimalTableId);
  if (shares.length === 0) return fail({ _: ["La tabella millesimale non ha ancora valori"] });
  const existing = await deps.repo.installments(budgetId);
  if (existing.some((i) => i.paidCents > 0)) return fail({ _: ["Ci sono rate già pagate: non si può rigenerare il piano"] });

  // Quota di ogni immobile (su TUTTI i millesimi della tabella), poi in rate. Il totale ripartito e' quello del preventivo.
  const othersMilli = budget.scope === "building" ? (await deps.repo.others(budget.millesimalTableId)).reduce((n, o) => n + o.milli, 0) : 0;
  const parts = allocateOwnerParts(budget.totalCents, shares.map((s) => s.milli), budget.scope, othersMilli);
  const dates = installmentDates(p.value.firstDueOn, p.value.count, p.value.everyMonths);
  const names = new Map((await deps.others.assets()).map((a) => [a.id, a.name]));
  for (const row of existing) if (row.deadlineId) await deps.others.archiveDeadline(row.deadlineId);
  await deps.repo.deleteInstallments(budgetId);

  const rows: Omit<InstallmentRow, "id">[] = [];
  shares.forEach((share, i) => {
    splitEvenly(parts[i]!, p.value.count).forEach((amount, n) => rows.push({ budgetId, assetId: share.assetId, number: n + 1, dueOn: dates[n]!, amountCents: amount, paidCents: 0, paidOn: null, documentId: null, deadlineId: null }));
  });
  const ids = await deps.repo.insertInstallments(rows);

  if (p.value.createDeadlines) {
    for (const [index, row] of rows.entries()) {
      if (row.amountCents === 0) continue;
      const deadlineId = await deps.others.createDeadline({ title: `Rata ${row.number}/${p.value.count} – ${budget.title}${names.get(row.assetId) ? ` (${names.get(row.assetId)})` : ""}`, dueOn: row.dueOn, assetId: row.assetId, level: "condominium", category: "condominium" });
      if (deadlineId) await deps.repo.updateInstallment(ids[index]!, { deadlineId });
    }
  }
  await deps.audit.record({ action: "condominium.installments.generate", entityType: "condominium", entityId: year?.condominiumId ?? budgetId, diff: { budgetId, rows: rows.length, deadlines: p.value.createDeadlines } });
  return ok({ id: year?.condominiumId ?? budgetId, created: rows.length, shareTotalCents: parts.reduce((a, b) => a + b, 0) });
}

export async function recordPayment(deps: CondoDeps, installmentId: string, raw: unknown, today: string): Promise<Id> {
  const p = parseInput(paymentSchema, raw);
  if (!p.ok) return p;
  const installment = await deps.repo.getInstallment(installmentId);
  if (!installment) return failGeneral("Rata non trovata");
  const errors = await refs(deps, { documents: [p.value.documentId] });
  if (hasErrors(errors)) return fail(errors);
  const paidOn = p.value.paidOn ?? today;
  // La prova resta quella gia' collegata se non ne indichi una nuova; senza importo pagato non c'e' prova da tenere.
  const documentId = p.value.paid > 0 ? (p.value.documentId ?? installment.documentId) : null;
  await deps.repo.updateInstallment(installmentId, { paidCents: p.value.paid, paidOn: p.value.paid > 0 ? paidOn : null, documentId });
  if (installment.deadlineId && isPaid({ amountCents: installment.amountCents, paidCents: p.value.paid })) {
    await deps.others.completeDeadline(installment.deadlineId, { completedOn: paidOn, reference: "Rata registrata come pagata" });
  }
  await deps.audit.record({ action: "condominium.installment.pay", entityType: "condominium", entityId: installmentId, diff: { fullyPaid: isPaid({ amountCents: installment.amountCents, paidCents: p.value.paid }), withProof: documentId !== null } });
  return ok({ id: installmentId });
}

// -------------------------------------------------------------------------------------------------- assemblee

async function meetingCondo(deps: CondoDeps, meetingId: string) {
  const meeting = await deps.repo.getMeeting(meetingId);
  return meeting ? { meeting, condoId: meeting.condominiumId } : null;
}

export async function createMeeting(deps: CondoDeps, condoId: string, raw: unknown): Promise<Id> {
  const p = parseInput(meetingSchema, raw);
  if (!p.ok) return p;
  if (!(await deps.repo.getCondominium(condoId))) return failGeneral("Condominio non trovato");
  const errors = await refs(deps, { documents: [p.value.convocationDocumentId, p.value.minutesDocumentId] });
  if (hasErrors(errors)) return fail(errors);
  const id = await deps.repo.insertMeeting(condoId, {
    kind: p.value.kind,
    status: p.value.status,
    convenedOn: p.value.convenedOn ?? null,
    meetingOn: p.value.meetingOn,
    location: p.value.location ?? null,
    convocationDocumentId: p.value.convocationDocumentId ?? null,
    minutesDocumentId: p.value.minutesDocumentId ?? null,
    notes: p.value.notes ?? null,
  });
  await deps.audit.record({ action: "condominium.meeting.create", entityType: "condominium", entityId: condoId, diff: { meetingId: id, kind: p.value.kind } });
  return ok({ id });
}

export async function updateMeeting(deps: CondoDeps, meetingId: string, raw: unknown): Promise<Id> {
  const p = parseInput(meetingSchema, raw);
  if (!p.ok) return p;
  const found = await meetingCondo(deps, meetingId);
  if (!found) return failGeneral("Assemblea non trovata");
  const errors = await refs(deps, { documents: [p.value.convocationDocumentId, p.value.minutesDocumentId] });
  if (hasErrors(errors)) return fail(errors);
  await deps.repo.updateMeeting(meetingId, {
    kind: p.value.kind,
    status: p.value.status,
    convenedOn: p.value.convenedOn ?? null,
    meetingOn: p.value.meetingOn,
    location: p.value.location ?? null,
    convocationDocumentId: p.value.convocationDocumentId ?? null,
    minutesDocumentId: p.value.minutesDocumentId ?? null,
    notes: p.value.notes ?? null,
  });
  await deps.audit.record({ action: "condominium.meeting.update", entityType: "condominium", entityId: found.condoId, diff: { meetingId, statusFrom: found.meeting.status, statusTo: p.value.status } });
  return ok({ id: meetingId });
}

export async function addAgendaItem(deps: CondoDeps, meetingId: string, raw: unknown): Promise<Id> {
  const p = parseInput(agendaItemSchema, raw);
  if (!p.ok) return p;
  const found = await meetingCondo(deps, meetingId);
  if (!found) return failGeneral("Assemblea non trovata");
  const id = await deps.repo.insertAgendaItem(meetingId, { title: p.value.title, description: p.value.description ?? null, questions: p.value.questions ?? null });
  await deps.audit.record({ action: "condominium.agenda.add", entityType: "condominium", entityId: found.condoId, diff: { meetingId, itemId: id } });
  return ok({ id: meetingId });
}

export async function updateAgendaItem(deps: CondoDeps, itemId: string, raw: unknown): Promise<Id> {
  const p = parseInput(agendaItemSchema, raw);
  if (!p.ok) return p;
  const item = await deps.repo.getAgendaItem(itemId);
  if (!item) return failGeneral("Punto non trovato");
  await deps.repo.updateAgendaItem(itemId, { title: p.value.title, description: p.value.description ?? null, questions: p.value.questions ?? null });
  await deps.audit.record({ action: "condominium.agenda.update", entityType: "condominium", entityId: item.meetingId, diff: { itemId } });
  return ok({ id: item.meetingId });
}

export async function removeAgendaItem(deps: CondoDeps, itemId: string): Promise<Id> {
  const item = await deps.repo.getAgendaItem(itemId);
  if (!item) return failGeneral("Punto non trovato");
  await deps.repo.deleteAgendaItem(itemId);
  await deps.audit.record({ action: "condominium.agenda.remove", entityType: "condominium", entityId: item.meetingId, diff: { itemId } });
  return ok({ id: item.meetingId });
}

export async function setAgendaDocument(deps: CondoDeps, itemId: string, documentId: string, linked: boolean): Promise<Id> {
  const item = await deps.repo.getAgendaItem(itemId);
  if (!item) return failGeneral("Punto non trovato");
  const errors = await refs(deps, { documents: [documentId] });
  if (hasErrors(errors)) return fail(errors);
  await deps.repo.setAgendaDocument(itemId, documentId, linked);
  await deps.audit.record({ action: linked ? "condominium.agenda.document.link" : "condominium.agenda.document.unlink", entityType: "condominium", entityId: item.meetingId, diff: { itemId, documentId } });
  return ok({ id: item.meetingId });
}

export async function addProxy(deps: CondoDeps, meetingId: string, raw: unknown): Promise<Id> {
  const p = parseInput(proxySchema, raw);
  if (!p.ok) return p;
  const found = await meetingCondo(deps, meetingId);
  if (!found) return failGeneral("Assemblea non trovata");
  const errors = await refs(deps, { parties: [p.value.delegatePartyId], documents: [p.value.documentId] });
  if (hasErrors(errors)) return fail(errors);
  const id = await deps.repo.insertProxy(meetingId, { delegatePartyId: p.value.delegatePartyId, note: p.value.note ?? null, documentId: p.value.documentId ?? null });
  await deps.audit.record({ action: "condominium.proxy.add", entityType: "condominium", entityId: found.condoId, diff: { meetingId, proxyId: id } });
  return ok({ id: meetingId });
}

export async function removeProxy(deps: CondoDeps, meetingId: string, proxyId: string): Promise<Id> {
  const found = await meetingCondo(deps, meetingId);
  if (!found) return failGeneral("Assemblea non trovata");
  await deps.repo.deleteProxy(proxyId);
  await deps.audit.record({ action: "condominium.proxy.remove", entityType: "condominium", entityId: found.condoId, diff: { meetingId, proxyId } });
  return ok({ id: meetingId });
}

const resolutionValues = (p: ReturnType<typeof resolutionSchema.parse>) => ({
  title: p.title,
  text: p.text ?? null,
  agendaItemId: p.agendaItemId ?? null,
  outcome: p.outcome,
  votesFor: p.votesFor ?? null,
  votesAgainst: p.votesAgainst ?? null,
  votesAbstain: p.votesAbstain ?? null,
  threshold: p.threshold ?? null,
  thresholdNote: p.thresholdNote ?? null,
});

export async function addResolution(deps: CondoDeps, meetingId: string, raw: unknown): Promise<Id> {
  const p = parseInput(resolutionSchema, raw);
  if (!p.ok) return p;
  const found = await meetingCondo(deps, meetingId);
  if (!found) return failGeneral("Assemblea non trovata");
  if (p.value.agendaItemId && !(await deps.repo.agenda(meetingId)).some((a) => a.id === p.value.agendaItemId)) return fail({ agendaItemId: ["Il punto non è di questa assemblea"] });
  const id = await deps.repo.insertResolution(meetingId, resolutionValues(p.value));
  await deps.audit.record({ action: "condominium.resolution.add", entityType: "condominium", entityId: found.condoId, diff: { meetingId, resolutionId: id, outcome: p.value.outcome } });
  return ok({ id: meetingId });
}

export async function updateResolution(deps: CondoDeps, resolutionId: string, raw: unknown): Promise<Id> {
  const p = parseInput(resolutionSchema, raw);
  if (!p.ok) return p;
  const resolution = await deps.repo.getResolution(resolutionId);
  if (!resolution) return failGeneral("Delibera non trovata");
  const found = await meetingCondo(deps, resolution.meetingId);
  await deps.repo.updateResolution(resolutionId, resolutionValues(p.value));
  await deps.audit.record({ action: "condominium.resolution.update", entityType: "condominium", entityId: found!.condoId, diff: { resolutionId, outcomeFrom: resolution.outcome, outcomeTo: p.value.outcome } });
  return ok({ id: resolution.meetingId });
}

/** Seguito di una delibera: crea una scadenza collegata (modulo Scadenze). */
export async function createResolutionDeadline(deps: CondoDeps, resolutionId: string, raw: unknown): Promise<Id> {
  const p = parseInput(followUpDeadlineSchema, raw);
  if (!p.ok) return p;
  const resolution = await deps.repo.getResolution(resolutionId);
  if (!resolution) return failGeneral("Delibera non trovata");
  const found = await meetingCondo(deps, resolution.meetingId);
  const deadlineId = await deps.others.createDeadline({ title: p.value.title, dueOn: p.value.dueOn, level: "condominium", category: "condominium" });
  if (!deadlineId) return fail({ _: ["Non è stato possibile creare la scadenza"] });
  await deps.repo.updateResolution(resolutionId, { deadlineId });
  await deps.audit.record({ action: "condominium.resolution.deadline", entityType: "condominium", entityId: found!.condoId, diff: { resolutionId, deadlineId } });
  return ok({ id: resolution.meetingId });
}

/** Seguito di una delibera: collega la spesa (un preventivo del condominio). */
export async function linkResolutionBudget(deps: CondoDeps, resolutionId: string, budgetId: string | null): Promise<Id> {
  const resolution = await deps.repo.getResolution(resolutionId);
  if (!resolution) return failGeneral("Delibera non trovata");
  const found = await meetingCondo(deps, resolution.meetingId);
  if (budgetId) {
    const budget = await deps.repo.getBudget(budgetId);
    const year = budget ? await deps.repo.getYear(budget.fiscalYearId) : null;
    if (!budget || year?.condominiumId !== found!.condoId) return fail({ budgetId: ["Il preventivo non è di questo condominio"] });
  }
  await deps.repo.updateResolution(resolutionId, { budgetId });
  await deps.audit.record({ action: "condominium.resolution.budget", entityType: "condominium", entityId: found!.condoId, diff: { resolutionId, budgetId } });
  return ok({ id: resolution.meetingId });
}

// -------------------------------------------------------------------------------------------------- lavori, segnalazioni, contratti, documenti

export async function createWork(deps: CondoDeps, condoId: string, raw: unknown): Promise<Id> {
  const p = parseInput(workSchema, raw);
  if (!p.ok) return p;
  if (!(await deps.repo.getCondominium(condoId))) return failGeneral("Condominio non trovato");
  const id = await deps.repo.insertWork(condoId, { title: p.value.title, status: p.value.status, budgetCents: p.value.budget ?? null, resolutionId: p.value.resolutionId ?? null, note: p.value.note ?? null });
  await deps.audit.record({ action: "condominium.work.create", entityType: "condominium", entityId: condoId, diff: { workId: id } });
  return ok({ id: condoId });
}

export async function updateWork(deps: CondoDeps, workId: string, raw: unknown): Promise<Id> {
  const p = parseInput(workSchema, raw);
  if (!p.ok) return p;
  const work = await deps.repo.getWork(workId);
  if (!work) return failGeneral("Lavoro non trovato");
  await deps.repo.updateWork(workId, { title: p.value.title, status: p.value.status, budgetCents: p.value.budget ?? null, resolutionId: p.value.resolutionId ?? null, note: p.value.note ?? null });
  await deps.audit.record({ action: "condominium.work.update", entityType: "condominium", entityId: work.condominiumId, diff: { workId, statusFrom: work.status, statusTo: p.value.status } });
  return ok({ id: work.condominiumId });
}

export async function addWorkEntry(deps: CondoDeps, workId: string, raw: unknown): Promise<Id> {
  const p = parseInput(workEntrySchema, raw);
  if (!p.ok) return p;
  const work = await deps.repo.getWork(workId);
  if (!work) return failGeneral("Lavoro non trovato");
  const errors = await refs(deps, { documents: [p.value.documentId] });
  if (hasErrors(errors)) return fail(errors);
  const id = await deps.repo.insertEntry(workId, { kind: p.value.kind, title: p.value.title, amountCents: p.value.amount ?? null, entryOn: p.value.entryOn ?? null, documentId: p.value.documentId ?? null });
  await deps.audit.record({ action: "condominium.work.entry", entityType: "condominium", entityId: work.condominiumId, diff: { workId, entryId: id, kind: p.value.kind } });
  return ok({ id: work.condominiumId });
}

export async function createClaim(deps: CondoDeps, condoId: string, raw: unknown, today: string): Promise<Id> {
  const p = parseInput(claimSchema, raw);
  if (!p.ok) return p;
  if (!(await deps.repo.getCondominium(condoId))) return failGeneral("Condominio non trovato");
  const errors = await refs(deps, { matter: p.value.matterId });
  if (hasErrors(errors)) return fail(errors);
  const id = await deps.repo.insertClaim(condoId, { kind: p.value.kind, title: p.value.title, description: p.value.description ?? null, status: p.value.status, openedOn: p.value.openedOn ?? today, matterId: p.value.matterId ?? null });
  await deps.audit.record({ action: "condominium.claim.create", entityType: "condominium", entityId: condoId, diff: { claimId: id, kind: p.value.kind } });
  return ok({ id: condoId });
}

export async function updateClaim(deps: CondoDeps, claimId: string, raw: unknown, today: string): Promise<Id> {
  const p = parseInput(claimSchema, raw);
  if (!p.ok) return p;
  const claim = await deps.repo.getClaim(claimId);
  if (!claim) return failGeneral("Voce non trovata");
  const errors = await refs(deps, { matter: p.value.matterId });
  if (hasErrors(errors)) return fail(errors);
  await deps.repo.updateClaim(claimId, {
    kind: p.value.kind,
    title: p.value.title,
    description: p.value.description ?? null,
    status: p.value.status,
    openedOn: p.value.openedOn ?? claim.openedOn,
    closedOn: p.value.status === "closed" ? (claim.closedOn ?? today) : null,
    matterId: p.value.matterId ?? null,
  });
  await deps.audit.record({ action: "condominium.claim.update", entityType: "condominium", entityId: claim.condominiumId, diff: { claimId, statusFrom: claim.status, statusTo: p.value.status } });
  return ok({ id: claim.condominiumId });
}

export async function createContract(deps: CondoDeps, condoId: string, raw: unknown): Promise<Id> {
  const p = parseInput(contractSchema, raw);
  if (!p.ok) return p;
  if (!(await deps.repo.getCondominium(condoId))) return failGeneral("Condominio non trovato");
  const errors = await refs(deps, { parties: [p.value.counterpartyPartyId], documents: [p.value.documentId] });
  if (hasErrors(errors)) return fail(errors);
  const id = await deps.repo.insertContract(condoId, { kind: p.value.kind, title: p.value.title, counterpartyPartyId: p.value.counterpartyPartyId ?? null, validFrom: p.value.validFrom ?? null, validTo: p.value.validTo ?? null, documentId: p.value.documentId ?? null, note: p.value.note ?? null });
  await deps.audit.record({ action: "condominium.contract.create", entityType: "condominium", entityId: condoId, diff: { contractId: id, kind: p.value.kind } });
  return ok({ id: condoId });
}

export async function linkCondoDocument(deps: CondoDeps, condoId: string, documentId: string, kind: string): Promise<Id> {
  if (!(await deps.repo.getCondominium(condoId))) return failGeneral("Condominio non trovato");
  if (!(DOCUMENT_KINDS as readonly string[]).includes(kind)) return fail({ kind: ["Tipo non valido"] });
  const errors = await refs(deps, { documents: [documentId] });
  if (hasErrors(errors)) return fail(errors);
  await deps.repo.linkDocument(condoId, documentId, kind);
  await deps.audit.record({ action: "condominium.document.link", entityType: "condominium", entityId: condoId, diff: { documentId, kind } });
  return ok({ id: condoId });
}

export async function unlinkCondoDocument(deps: CondoDeps, condoId: string, documentId: string): Promise<Id> {
  if (!(await deps.repo.getCondominium(condoId))) return failGeneral("Condominio non trovato");
  await deps.repo.unlinkDocument(condoId, documentId);
  await deps.audit.record({ action: "condominium.document.unlink", entityType: "condominium", entityId: condoId, diff: { documentId } });
  return ok({ id: condoId });
}

// -------------------------------------------------------------------------------------------------- letture

/** Le rate con un pagamento registrato in un periodo (data dell'ultimo pagamento), una per riga: servono al quadro economico. */
export async function installmentLedger(deps: CondoReadDeps, from: string, to: string) {
  const rows = await deps.repo.paidInstallmentsBetween(from, to);
  return rows.map((r) => ({ id: r.installmentId, refId: r.condominiumId, date: r.paidOn, amountCents: r.paidCents, documentId: r.documentId, assetId: r.assetId, label: `Rata ${r.number}: ${r.budgetTitle}` }));
}

export type CondominiumListItem = CondominiumRow & { memberCount: number; administratorName: string | null };

export async function listCondominiums(deps: CondoReadDeps, includeArchived = false): Promise<CondominiumListItem[]> {
  const [rows, parties] = await Promise.all([deps.repo.listCondominiums(includeArchived), deps.others.parties()]);
  return Promise.all(rows.map(async (c) => ({ ...c, memberCount: (await deps.repo.members(c.id)).length, administratorName: c.administratorPartyId ? (parties.get(c.administratorPartyId) ?? null) : null })));
}

export type TableView = TableRow & { shares: (ShareRow & { assetName: string })[]; others: OtherShareRow[]; othersTotal: number; total: number; differsFromThousand: boolean };
export type BudgetView = BudgetRow & { tableName: string | null; installments: (InstallmentRow & { assetName: string; paid: boolean; documentTitle: string | null })[]; paidCents: number; dueCents: number };
export type YearView = YearRow & { budgets: BudgetView[] };
export type CondominiumDetail = CondominiumRow & {
  administratorName: string | null;
  members: (MemberRow & { assetName: string })[];
  tables: TableView[];
  years: YearView[];
  meetings: MeetingRow[];
  works: (WorkRow & { invoicedCents: number; entries: (WorkEntryRow & { documentTitle: string | null })[] })[];
  claims: (ClaimRow & { matterTitle: string | null })[];
  contracts: (ContractRow & { counterpartyName: string | null; documentTitle: string | null })[];
  documents: { documentId: string; kind: string; title: string }[];
};

export async function getCondominiumDetail(deps: CondoReadDeps, id: string): Promise<CondominiumDetail | null> {
  const condo = await deps.repo.getCondominium(id);
  if (!condo) return null;
  const [assets, parties, titles, matters, members, tables, years, meetings, works, claims, contracts, docs] = await Promise.all([
    deps.others.assets(),
    deps.others.parties(),
    deps.others.documentTitles(),
    deps.others.matterTitles(),
    deps.repo.members(id),
    deps.repo.tables(id),
    deps.repo.years(id),
    deps.repo.meetings(id),
    deps.repo.works(id),
    deps.repo.claims(id),
    deps.repo.contracts(id),
    deps.repo.documents(id),
  ]);
  const assetName = new Map(assets.map((a) => [a.id, a.name]));
  const tableViews: TableView[] = await Promise.all(
    tables.map(async (t) => {
      const shares = (await deps.repo.shares(t.id)).map((s) => ({ ...s, assetName: assetName.get(s.assetId) ?? "" }));
      const others = await deps.repo.others(t.id);
      return { ...t, shares, others, othersTotal: others.reduce((n, o) => n + o.milli, 0), ...tableTotals(shares.map((s) => s.milli)) };
    }),
  );
  const tableName = new Map(tables.map((t) => [t.id, t.name]));
  const yearViews: YearView[] = await Promise.all(
    years.map(async (y) => ({
      ...y,
      budgets: await Promise.all(
        (await deps.repo.budgets(y.id)).map(async (b) => {
          const installments = (await deps.repo.installments(b.id)).map((i) => ({ ...i, assetName: assetName.get(i.assetId) ?? "", paid: isPaid(i), documentTitle: i.documentId ? (titles.get(i.documentId) ?? null) : null }));
          return { ...b, tableName: b.millesimalTableId ? (tableName.get(b.millesimalTableId) ?? null) : null, installments, paidCents: installments.reduce((n, i) => n + i.paidCents, 0), dueCents: installments.reduce((n, i) => n + i.amountCents, 0) };
        }),
      ),
    })),
  );
  return {
    ...condo,
    administratorName: condo.administratorPartyId ? (parties.get(condo.administratorPartyId) ?? null) : null,
    members: members.map((m) => ({ ...m, assetName: assetName.get(m.assetId) ?? "" })),
    tables: tableViews,
    years: yearViews,
    meetings,
    works: await Promise.all(
      works.map(async (w) => {
        const entries = (await deps.repo.entries(w.id)).map((e) => ({ ...e, documentTitle: e.documentId ? (titles.get(e.documentId) ?? null) : null }));
        return { ...w, entries, invoicedCents: entries.filter((e) => e.kind === "invoice").reduce((n, e) => n + (e.amountCents ?? 0), 0) };
      }),
    ),
    claims: claims.map((c) => ({ ...c, matterTitle: c.matterId ? (matters.get(c.matterId) ?? null) : null })),
    contracts: contracts.map((c) => ({ ...c, counterpartyName: c.counterpartyPartyId ? (parties.get(c.counterpartyPartyId) ?? null) : null, documentTitle: c.documentId ? (titles.get(c.documentId) ?? null) : null })),
    documents: docs.flatMap((d) => (titles.has(d.documentId) ? [{ ...d, title: titles.get(d.documentId)! }] : [])),
  };
}

export type ResolutionView = ResolutionRow & { check: VoteCheck; agendaTitle: string | null; deadlineLinked: boolean; budgetTitle: string | null };
export type MeetingDetail = MeetingRow & {
  condominiumName: string;
  agenda: (AgendaRow & { documents: { id: string; title: string }[] })[];
  proxies: (ProxyRow & { delegateName: string; documentTitle: string | null })[];
  resolutions: ResolutionView[];
  convocationTitle: string | null;
  minutesTitle: string | null;
  /** Elenco di preparazione: cosa leggere e cosa chiedere. */
  preparation: { documentsToRead: { id: string; title: string; agendaTitle: string }[]; questions: { agendaTitle: string; text: string }[]; itemsWithoutDocuments: string[] };
};

export async function getMeetingDetail(deps: CondoReadDeps, meetingId: string): Promise<MeetingDetail | null> {
  const meeting = await deps.repo.getMeeting(meetingId);
  if (!meeting) return null;
  const [condo, titles, parties, agenda, proxies, resolutions, budgetsByYear] = await Promise.all([
    deps.repo.getCondominium(meeting.condominiumId),
    deps.others.documentTitles(),
    deps.others.parties(),
    deps.repo.agenda(meetingId),
    deps.repo.proxies(meetingId),
    deps.repo.resolutions(meetingId),
    deps.repo.years(meeting.condominiumId).then((ys) => Promise.all(ys.map((y) => deps.repo.budgets(y.id)))),
  ]);
  const budgetTitles = new Map(budgetsByYear.flat().map((b) => [b.id, b.title]));
  const agendaTitles = new Map(agenda.map((a) => [a.id, a.title]));
  const agendaView = agenda.map((a) => ({ ...a, documents: a.documentIds.flatMap((d) => (titles.has(d) ? [{ id: d, title: titles.get(d)! }] : [])) }));
  return {
    ...meeting,
    condominiumName: condo?.name ?? "",
    agenda: agendaView,
    proxies: proxies.map((p) => ({ ...p, delegateName: parties.get(p.delegatePartyId) ?? "", documentTitle: p.documentId ? (titles.get(p.documentId) ?? null) : null })),
    resolutions: resolutions.map((r) => ({
      ...r,
      check: checkVotes({ outcome: r.outcome, votesFor: r.votesFor, votesAgainst: r.votesAgainst, votesAbstain: r.votesAbstain, threshold: r.threshold }),
      agendaTitle: r.agendaItemId ? (agendaTitles.get(r.agendaItemId) ?? null) : null,
      deadlineLinked: r.deadlineId !== null,
      budgetTitle: r.budgetId ? (budgetTitles.get(r.budgetId) ?? null) : null,
    })),
    convocationTitle: meeting.convocationDocumentId ? (titles.get(meeting.convocationDocumentId) ?? null) : null,
    minutesTitle: meeting.minutesDocumentId ? (titles.get(meeting.minutesDocumentId) ?? null) : null,
    preparation: {
      documentsToRead: agendaView.flatMap((a) => a.documents.map((d) => ({ ...d, agendaTitle: a.title }))),
      questions: agendaView.filter((a) => a.questions).map((a) => ({ agendaTitle: a.title, text: a.questions! })),
      itemsWithoutDocuments: agendaView.filter((a) => a.documents.length === 0).map((a) => a.title),
    },
  };
}

export async function listAssetsWithoutCondominium(deps: CondoReadDeps): Promise<{ id: string; name: string }[]> {
  const assets = await deps.others.assets();
  const taken = await Promise.all(assets.map(async (a) => ((await deps.repo.condominiumOfAsset(a.id)) ? a.id : null)));
  const set = new Set(taken.filter(Boolean));
  return assets.filter((a) => !set.has(a.id));
}
