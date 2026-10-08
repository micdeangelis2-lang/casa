import { fail, failGeneral, ok, parseInput, type FieldErrors, type Result } from "@/shared/result";
import { closeSchema, obligationSchema, obligationState, paymentSchema, returnSchema, summarize, taxTypeSchema, type ObligationState } from "../domain/taxes";
import type { ObligationRow, PaymentRow, ReturnRow, TaxDeps, TaxReadDeps, TaxTypeRow } from "./ports";

type Id = Result<{ id: string }>;
const hasErrors = (e: FieldErrors) => Object.keys(e).length > 0;

async function refs(deps: TaxDeps, r: { assetId?: string; taxTypeId?: string; documentId?: string; territoryId?: string }): Promise<FieldErrors> {
  const errors: FieldErrors = {};
  if (r.assetId && !(await deps.others.assets()).some((a) => a.id === r.assetId)) errors.assetId = ["L'immobile non esiste"];
  if (r.taxTypeId) {
    const type = await deps.repo.getType(r.taxTypeId);
    if (!type) errors.taxTypeId = ["Il tipo di tributo non esiste"];
    else if (type.archived) errors.taxTypeId = ["Il tipo di tributo è archiviato: ripristinalo o scegline un altro"];
  }
  if (r.documentId && !(await deps.others.documentTitles()).has(r.documentId)) errors.documentId = ["Il documento non esiste"];
  if (r.territoryId && !(await deps.others.assets()).some((a) => a.territoryId === r.territoryId)) errors.territoryId = ["Scegli un ambito tra quelli dei tuoi immobili"];
  return errors;
}

// -------------------------------------------------------------------------------------------------- tipi di tributo

async function nameTaken(deps: TaxDeps, name: string, exceptId?: string): Promise<boolean> {
  const wanted = name.trim().toLowerCase();
  return (await deps.repo.listTypes(false)).some((t) => t.id !== exceptId && t.name.trim().toLowerCase() === wanted);
}

export async function createTaxType(deps: TaxDeps, raw: unknown): Promise<Id> {
  const p = parseInput(taxTypeSchema, raw);
  if (!p.ok) return p;
  const errors = await refs(deps, { territoryId: p.value.territoryId });
  if (hasErrors(errors)) return fail(errors);
  if (await nameTaken(deps, p.value.name)) return fail({ name: ["Esiste già un tipo con questo nome"] });
  const id = await deps.repo.insertType({ name: p.value.name, kind: p.value.kind, territoryId: p.value.territoryId ?? null, source: p.value.source ?? null, notes: p.value.notes ?? null, archived: false });
  await deps.audit.record({ action: "tax.type.create", entityType: "tax_type", entityId: id, diff: { kind: p.value.kind } });
  return ok({ id });
}

export async function updateTaxType(deps: TaxDeps, id: string, raw: unknown): Promise<Id> {
  const p = parseInput(taxTypeSchema, raw);
  if (!p.ok) return p;
  if (!(await deps.repo.getType(id))) return failGeneral("Tipo di tributo non trovato");
  const errors = await refs(deps, { territoryId: p.value.territoryId });
  if (hasErrors(errors)) return fail(errors);
  if (await nameTaken(deps, p.value.name, id)) return fail({ name: ["Esiste già un tipo con questo nome"] });
  await deps.repo.updateType(id, { name: p.value.name, kind: p.value.kind, territoryId: p.value.territoryId ?? null, source: p.value.source ?? null, notes: p.value.notes ?? null });
  await deps.audit.record({ action: "tax.type.update", entityType: "tax_type", entityId: id, diff: { fields: ["name", "kind", "territoryId", "source", "notes"] } });
  return ok({ id });
}

export async function setTaxTypeArchived(deps: TaxDeps, id: string, archived: boolean): Promise<Id> {
  if (!(await deps.repo.getType(id))) return failGeneral("Tipo di tributo non trovato");
  await deps.repo.updateType(id, { archived });
  await deps.audit.record({ action: archived ? "tax.type.archive" : "tax.type.restore", entityType: "tax_type", entityId: id, diff: {} });
  return ok({ id });
}

// -------------------------------------------------------------------------------------------------- voci (bene, tipo, anno)

async function deadlineTitle(deps: TaxDeps, o: { assetId: string; taxTypeId: string; year: number; label?: string | null }): Promise<string> {
  const [type, assets] = await Promise.all([deps.repo.getType(o.taxTypeId), deps.others.assets()]);
  const asset = assets.find((a) => a.id === o.assetId)?.name;
  return `${type?.name ?? "Tributo"} ${o.year}${o.label ? ` – ${o.label}` : ""}${asset ? ` (${asset})` : ""}`;
}

const DUPLICATE_OBLIGATION = "Esiste già una voce con lo stesso bene, tributo, anno ed etichetta: aggiungi un'etichetta diversa (acconto, saldo, rata...)";
/** Stesso bene, tipo, anno ed etichetta (vuota = vuota): e' la chiave univoca del database, qui con un messaggio leggibile. */
async function duplicateObligation(deps: TaxDeps, v: { assetId: string; taxTypeId: string; year: number; label?: string | null }, exceptId?: string): Promise<boolean> {
  const same = await deps.repo.listObligations({ year: v.year, assetId: v.assetId, taxTypeId: v.taxTypeId });
  return same.some((o) => o.id !== exceptId && (o.label ?? "") === (v.label ?? ""));
}

/** Convalida a secco di una voce e di un pagamento (le stesse regole di `createObligation` e `recordPayment`, senza scrivere). */
export const validateObligation = (input: unknown): Result<unknown> => parseInput(obligationSchema, input);
export const validatePayment = (input: unknown): Result<unknown> => parseInput(paymentSchema, input);

export async function createObligation(deps: TaxDeps, raw: unknown): Promise<Id> {
  const p = parseInput(obligationSchema, raw);
  if (!p.ok) return p;
  const v = p.value;
  const errors = await refs(deps, { assetId: v.assetId, taxTypeId: v.taxTypeId });
  if (hasErrors(errors)) return fail(errors);
  if (v.createDeadline && !v.dueOn) return fail({ dueOn: ["Per creare la scadenza serve la data"] });
  if (await duplicateObligation(deps, v)) return fail({ label: [DUPLICATE_OBLIGATION] });
  const id = await deps.repo.insertObligation({
    assetId: v.assetId,
    taxTypeId: v.taxTypeId,
    year: v.year,
    label: v.label ?? null,
    dueOn: v.dueOn ?? null,
    expectedCents: v.expected ?? null,
    status: "open",
    closedOn: null,
    closedNote: null,
    askAdviser: v.askAdviser,
    note: v.note ?? null,
    deadlineId: null,
  });
  let deadlineCreated = false;
  if (v.createDeadline && v.dueOn) {
    const deadlineId = await deps.others.createDeadline({ title: await deadlineTitle(deps, v), dueOn: v.dueOn, assetId: v.assetId, proofRequired: true });
    if (deadlineId) {
      await deps.repo.updateObligation(id, { deadlineId });
      deadlineCreated = true;
    }
  }
  await deps.audit.record({ action: "tax.obligation.create", entityType: "tax_obligation", entityId: id, diff: { year: v.year, deadlineCreated } });
  return ok({ id });
}

export async function updateObligation(deps: TaxDeps, id: string, raw: unknown): Promise<Id> {
  const p = parseInput(obligationSchema, raw);
  if (!p.ok) return p;
  const current = await deps.repo.getObligation(id);
  if (!current) return failGeneral("Voce non trovata");
  const v = p.value;
  // Un tipo archiviato si puo' tenere se non cambia: la voce esistente non deve diventare non salvabile.
  const errors = await refs(deps, { assetId: v.assetId, taxTypeId: v.taxTypeId === current.taxTypeId ? undefined : v.taxTypeId });
  if (hasErrors(errors)) return fail(errors);
  if (await duplicateObligation(deps, v, id)) return fail({ label: [DUPLICATE_OBLIGATION] });
  await deps.repo.updateObligation(id, { assetId: v.assetId, taxTypeId: v.taxTypeId, year: v.year, label: v.label ?? null, dueOn: v.dueOn ?? null, expectedCents: v.expected ?? null, askAdviser: v.askAdviser, note: v.note ?? null });
  await deps.audit.record({ action: "tax.obligation.update", entityType: "tax_obligation", entityId: id, diff: { fields: ["assetId", "taxTypeId", "year", "label", "dueOn", "expected", "askAdviser", "note"] } });
  return ok({ id });
}

/** Crea la scadenza collegata a una voce che ha una data e non ce l'ha ancora. */
export async function createObligationDeadline(deps: TaxDeps, id: string): Promise<Id> {
  const o = await deps.repo.getObligation(id);
  if (!o) return failGeneral("Voce non trovata");
  if (o.deadlineId) return failGeneral("La voce ha già una scadenza collegata");
  if (!o.dueOn) return fail({ dueOn: ["Per creare la scadenza serve la data: aggiungila dalla modifica della voce"] });
  const deadlineId = await deps.others.createDeadline({ title: await deadlineTitle(deps, o), dueOn: o.dueOn, assetId: o.assetId, proofRequired: true });
  if (!deadlineId) return failGeneral("Non è stato possibile creare la scadenza");
  await deps.repo.updateObligation(id, { deadlineId });
  await deps.audit.record({ action: "tax.obligation.deadline", entityType: "tax_obligation", entityId: id, diff: {} });
  return ok({ id });
}

/** Chiude la voce senza (altri) pagamenti: il motivo e' del proprietario, l'app non lo valuta. */
export async function closeObligation(deps: TaxDeps, id: string, raw: unknown, today: string): Promise<Id> {
  const p = parseInput(closeSchema, raw);
  if (!p.ok) return p;
  const o = await deps.repo.getObligation(id);
  if (!o) return failGeneral("Voce non trovata");
  const closedOn = p.value.closedOn ?? today;
  await deps.repo.updateObligation(id, { status: "closed", closedOn, closedNote: p.value.reason });
  if (o.deadlineId) await deps.others.completeDeadline(o.deadlineId, { completedOn: closedOn, reference: "Voce chiusa dal proprietario" });
  await deps.audit.record({ action: "tax.obligation.close", entityType: "tax_obligation", entityId: id, diff: {} });
  return ok({ id });
}

/** Vero se i pagamenti registrati raggiungono l'importo che il proprietario ha indicato (la scadenza resta chiusa solo allora). */
async function reachesExpected(deps: TaxDeps, o: ObligationRow): Promise<boolean> {
  if (o.expectedCents === null) return false;
  return (await deps.repo.payments(o.id)).reduce((n, x) => n + x.amountCents, 0) >= o.expectedCents;
}

export async function reopenObligation(deps: TaxDeps, id: string): Promise<Id> {
  const o = await deps.repo.getObligation(id);
  if (!o) return failGeneral("Voce non trovata");
  await deps.repo.updateObligation(id, { status: "open", closedOn: null, closedNote: null });
  if (o.deadlineId && !(await reachesExpected(deps, o))) await deps.others.reopenDeadline(o.deadlineId);
  await deps.audit.record({ action: "tax.obligation.reopen", entityType: "tax_obligation", entityId: id, diff: {} });
  return ok({ id });
}

export async function recordPayment(deps: TaxDeps, obligationId: string, raw: unknown): Promise<Id> {
  const p = parseInput(paymentSchema, raw);
  if (!p.ok) return p;
  const o = await deps.repo.getObligation(obligationId);
  if (!o) return failGeneral("Voce non trovata");
  if (o.status === "closed") return failGeneral("La voce è chiusa: riaprila per registrare un pagamento");
  const errors = await refs(deps, { documentId: p.value.documentId });
  if (hasErrors(errors)) return fail(errors);
  const paymentId = await deps.repo.insertPayment({ obligationId, paidOn: p.value.paidOn, amountCents: p.value.amount, method: p.value.method, kind: p.value.kind, penaltyCents: p.value.penalty ?? null, interestCents: p.value.interest ?? null, reference: p.value.reference ?? null, documentId: p.value.documentId ?? null, note: p.value.note ?? null });
  const total = (await deps.repo.payments(obligationId)).reduce((n, x) => n + x.amountCents, 0);
  const reached = o.expectedCents !== null && total >= o.expectedCents;
  if (reached && o.deadlineId) await deps.others.completeDeadline(o.deadlineId, { completedOn: p.value.paidOn, reference: "Pagamenti registrati pari all'importo indicato" });
  await deps.audit.record({ action: "tax.payment.record", entityType: "tax_obligation", entityId: obligationId, diff: { paymentId, kind: p.value.kind, reachedExpected: reached, withProof: Boolean(p.value.documentId) } });
  return ok({ id: obligationId });
}

export async function removePayment(deps: TaxDeps, paymentId: string): Promise<Id> {
  const payment = await deps.repo.getPayment(paymentId);
  if (!payment) return failGeneral("Pagamento non trovato");
  await deps.repo.deletePayment(paymentId);
  const o = await deps.repo.getObligation(payment.obligationId);
  if (o?.deadlineId && o.status === "open" && !(await reachesExpected(deps, o))) await deps.others.reopenDeadline(o.deadlineId);
  await deps.audit.record({ action: "tax.payment.remove", entityType: "tax_obligation", entityId: payment.obligationId, diff: { paymentId } });
  return ok({ id: payment.obligationId });
}

// -------------------------------------------------------------------------------------------------- dichiarazioni

export async function createReturn(deps: TaxDeps, raw: unknown): Promise<Id> {
  const p = parseInput(returnSchema, raw);
  if (!p.ok) return p;
  const v = p.value;
  const errors = await refs(deps, { assetId: v.assetId, taxTypeId: v.taxTypeId, documentId: v.documentId });
  if (hasErrors(errors)) return fail(errors);
  if (v.createDeadline && !v.dueOn) return fail({ dueOn: ["Per creare la scadenza serve la data"] });
  const id = await deps.repo.insertReturn({ title: v.title, taxTypeId: v.taxTypeId ?? null, assetId: v.assetId ?? null, year: v.year, dueOn: v.dueOn ?? null, filedOn: v.filedOn ?? null, protocol: v.protocol ?? null, documentId: v.documentId ?? null, askAdviser: v.askAdviser, note: v.note ?? null, deadlineId: null });
  let deadlineCreated = false;
  if (v.createDeadline && v.dueOn && !v.filedOn) {
    const deadlineId = await deps.others.createDeadline({ title: `${v.title} ${v.year}`, dueOn: v.dueOn, assetId: v.assetId, proofRequired: true });
    if (deadlineId) {
      await deps.repo.updateReturn(id, { deadlineId });
      deadlineCreated = true;
    }
  }
  await deps.audit.record({ action: "tax.return.create", entityType: "tax_return", entityId: id, diff: { year: v.year, filed: Boolean(v.filedOn), deadlineCreated } });
  return ok({ id });
}

export async function updateReturn(deps: TaxDeps, id: string, raw: unknown): Promise<Id> {
  const p = parseInput(returnSchema, raw);
  if (!p.ok) return p;
  const current = await deps.repo.getReturn(id);
  if (!current) return failGeneral("Dichiarazione non trovata");
  const v = p.value;
  const errors = await refs(deps, { assetId: v.assetId, taxTypeId: v.taxTypeId === (current.taxTypeId ?? undefined) ? undefined : v.taxTypeId, documentId: v.documentId });
  if (hasErrors(errors)) return fail(errors);
  await deps.repo.updateReturn(id, { title: v.title, taxTypeId: v.taxTypeId ?? null, assetId: v.assetId ?? null, year: v.year, dueOn: v.dueOn ?? null, filedOn: v.filedOn ?? null, protocol: v.protocol ?? null, documentId: v.documentId ?? null, askAdviser: v.askAdviser, note: v.note ?? null });
  if (v.filedOn && current.deadlineId) await deps.others.completeDeadline(current.deadlineId, { completedOn: v.filedOn, reference: v.protocol ? `Protocollo ${v.protocol}` : "Presentata" });
  await deps.audit.record({ action: "tax.return.update", entityType: "tax_return", entityId: id, diff: { filed: Boolean(v.filedOn) } });
  return ok({ id });
}

// -------------------------------------------------------------------------------------------------- letture

/** I pagamenti registrati in un periodo, uno per riga: servono al quadro economico. */
export async function paymentLedger(deps: TaxReadDeps, from: string, to: string) {
  const [rows, names] = await Promise.all([deps.repo.paymentsBetween(from, to), labels(deps)]);
  return rows.map((r) => ({
    id: r.paymentId,
    refId: r.obligationId,
    date: r.paidOn,
    amountCents: r.amountCents,
    documentId: r.documentId,
    taxDetail: { kind: r.kind, penaltyCents: r.penaltyCents, interestCents: r.interestCents },
    assetId: r.assetId,
    label: `${names.typeName.get(r.taxTypeId) ?? "Tributo"} ${r.year}${r.label ? ` – ${r.label}` : ""}`,
  }));
}

export type ObligationItem = ObligationRow & {
  assetName: string;
  typeName: string;
  paidCents: number;
  payments: number;
  paymentsWithoutProof: number;
  state: ObligationState;
  remainingCents: number | null;
  overdue: boolean;
};

async function labels(deps: TaxReadDeps) {
  const [assets, types] = await Promise.all([deps.others.assets(), deps.repo.listTypes(true)]);
  return { assetName: new Map(assets.map((a) => [a.id, a.name])), typeName: new Map(types.map((t) => [t.id, t.name])) };
}

function toItem(o: ObligationRow, payments: PaymentRow[], names: Awaited<ReturnType<typeof labels>>, today: string): ObligationItem {
  const paidCents = payments.reduce((n, p) => n + p.amountCents, 0);
  return {
    ...o,
    assetName: names.assetName.get(o.assetId) ?? "",
    typeName: names.typeName.get(o.taxTypeId) ?? "",
    paidCents,
    payments: payments.length,
    paymentsWithoutProof: payments.filter((p) => !p.documentId).length,
    ...obligationState(o, paidCents, today),
  };
}

export async function listObligations(deps: TaxReadDeps, filter: { year?: number; assetId?: string; taxTypeId?: string }, today: string): Promise<ObligationItem[]> {
  const [rows, names] = await Promise.all([deps.repo.listObligations(filter), labels(deps)]);
  const payments = await deps.repo.paymentsOf(rows.map((r) => r.id));
  const byObligation = new Map<string, PaymentRow[]>();
  for (const p of payments) byObligation.set(p.obligationId, [...(byObligation.get(p.obligationId) ?? []), p]);
  return rows.map((o) => toItem(o, byObligation.get(o.id) ?? [], names, today));
}

export type ObligationDetail = ObligationItem & { paymentList: (PaymentRow & { documentTitle: string | null })[]; deadlineLinked: boolean };

export async function getObligationDetail(deps: TaxReadDeps, id: string, today: string): Promise<ObligationDetail | null> {
  const o = await deps.repo.getObligation(id);
  if (!o) return null;
  const [payments, names, titles] = await Promise.all([deps.repo.payments(id), labels(deps), deps.others.documentTitles()]);
  return { ...toItem(o, payments, names, today), paymentList: payments.map((p) => ({ ...p, documentTitle: p.documentId ? (titles.get(p.documentId) ?? null) : null })), deadlineLinked: o.deadlineId !== null };
}

export type TaxTypeItem = TaxTypeRow & { territoryLabel: string | null };

export async function listTaxTypes(deps: TaxReadDeps, includeArchived: boolean): Promise<TaxTypeItem[]> {
  const [rows, assets] = await Promise.all([deps.repo.listTypes(includeArchived), deps.others.assets()]);
  const territory = new Map(assets.map((a) => [a.territoryId, a.territoryLabel]));
  return rows.map((t) => ({ ...t, territoryLabel: t.territoryId ? (territory.get(t.territoryId) ?? null) : null }));
}

/** Gli ambiti territoriali tra cui scegliere: quelli dei beni registrati. */
export async function territoryChoices(deps: TaxReadDeps): Promise<{ id: string; label: string }[]> {
  const assets = await deps.others.assets();
  return [...new Map(assets.map((a) => [a.territoryId, a.territoryLabel])).entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label, "it"));
}

export type ReturnItem = ReturnRow & { assetName: string | null; typeName: string | null; documentTitle: string | null; state: "filed" | "overdue" | "to_file" };

export async function listReturns(deps: TaxReadDeps, filter: { year?: number; assetId?: string }, today: string): Promise<ReturnItem[]> {
  const [rows, names, titles] = await Promise.all([deps.repo.listReturns(filter), labels(deps), deps.others.documentTitles()]);
  return rows.map((r) => ({
    ...r,
    assetName: r.assetId ? (names.assetName.get(r.assetId) ?? null) : null,
    typeName: r.taxTypeId ? (names.typeName.get(r.taxTypeId) ?? null) : null,
    documentTitle: r.documentId ? (titles.get(r.documentId) ?? null) : null,
    state: r.filedOn ? "filed" : r.dueOn && r.dueOn < today ? "overdue" : "to_file",
  }));
}

/** Gli anni per cui c'e' qualcosa di registrato (voci o dichiarazioni), dal piu' recente. */
export async function yearsWithData(deps: TaxReadDeps): Promise<number[]> {
  const [obligations, returns] = await Promise.all([deps.repo.listObligations({}), deps.repo.listReturns({})]);
  return [...new Set([...obligations.map((o) => o.year), ...returns.map((r) => r.year)])].sort((a, b) => b - a);
}

/** Riepilogo di un anno da consegnare al consulente: voci, totali, pagamenti senza prova, voci segnate «da chiedere». */
export async function adviserSummary(deps: TaxReadDeps, year: number, today: string) {
  const [items, returns] = await Promise.all([listObligations(deps, { year }, today), listReturns(deps, { year }, today)]);
  const totals = summarize(items);
  return {
    year,
    items,
    returns,
    totals,
    withoutProof: items.reduce((n, i) => n + i.paymentsWithoutProof, 0),
    toAsk: { obligations: items.filter((i) => i.askAdviser), returns: returns.filter((r) => r.askAdviser) },
  };
}
export type AdviserSummary = Awaited<ReturnType<typeof adviserSummary>>;
