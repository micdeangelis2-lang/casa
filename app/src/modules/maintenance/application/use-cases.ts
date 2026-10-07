import { periodState, type PeriodState } from "@/shared/dates";
import { fail, failGeneral, ok, parseInput, type FieldErrors, type Result } from "@/shared/result";
import {
  ENTRY_KINDS,
  QUOTE_STATUSES,
  WORK_STATUSES,
  inspectionPlanSchema,
  invoiceSchema,
  plantSchema,
  plantUpdateSchema,
  progressSchema,
  quoteExpired,
  quoteSchema,
  warrantySchema,
  workFinancials,
  workSchema,
  type EntryKind,
  type QuoteStatus,
  type WorkStatus,
} from "../domain/maintenance";
import type { InvoiceRow, MaintenanceDeps, MaintenanceReadDeps, PlanRow, PlantRow, ProgressRow, QuoteRow, WarrantyRow, WorkRow } from "./ports";

type Id = Result<{ id: string }>;
const hasErrors = (e: FieldErrors) => Object.keys(e).length > 0;

async function refs(deps: MaintenanceDeps, r: { assetId?: string; parties?: (string | undefined)[]; documents?: (string | undefined)[]; workId?: string; plantId?: string }): Promise<FieldErrors> {
  const errors: FieldErrors = {};
  if (r.assetId && !(await deps.others.assets()).some((a) => a.id === r.assetId)) errors.assetId = ["L'immobile non esiste"];
  const wantedParties = (r.parties ?? []).filter((x): x is string => Boolean(x));
  if (wantedParties.length > 0) {
    const known = await deps.others.parties();
    if (wantedParties.some((p) => !known.has(p))) errors.supplierPartyId = ["Il contatto non esiste più nella rubrica"];
  }
  const wantedDocuments = (r.documents ?? []).filter((x): x is string => Boolean(x));
  if (wantedDocuments.length > 0) {
    const known = await deps.others.documentTitles();
    if (wantedDocuments.some((d) => !known.has(d))) errors.documentId = ["Il documento non esiste"];
  }
  if (r.workId && !(await deps.repo.getWork(r.workId))) errors.workId = ["L'intervento non esiste"];
  if (r.plantId) {
    const plant = await deps.repo.getPlant(r.plantId);
    if (!plant) errors.plantId = ["L'impianto non esiste"];
    else if (r.assetId && plant.assetId !== r.assetId) errors.plantId = ["L'impianto appartiene a un altro immobile"];
  }
  return errors;
}

async function assetName(deps: MaintenanceDeps, assetId: string): Promise<string> {
  return (await deps.others.assets()).find((a) => a.id === assetId)?.name ?? "";
}

// -------------------------------------------------------------------------------------------------- interventi

export async function createWork(deps: MaintenanceDeps, raw: unknown): Promise<Id> {
  const p = parseInput(workSchema, raw);
  if (!p.ok) return p;
  const v = p.value;
  const errors = await refs(deps, { assetId: v.assetId, parties: [v.supplierPartyId], plantId: v.plantId });
  if (hasErrors(errors)) return fail(errors);
  if (v.createDeadline && !v.scheduledOn) return fail({ scheduledOn: ["Per creare la scadenza serve la data prevista"] });
  const id = await deps.repo.insertWork({
    assetId: v.assetId,
    title: v.title,
    description: v.description ?? null,
    status: v.status,
    supplierPartyId: v.supplierPartyId ?? null,
    plantId: v.plantId ?? null,
    scheduledOn: v.scheduledOn ?? null,
    startedOn: v.startedOn ?? null,
    completedOn: v.completedOn ?? null,
    budgetCents: v.budget ?? null,
    note: v.note ?? null,
    deadlineId: null,
  });
  let deadlineCreated = false;
  if (v.createDeadline && v.scheduledOn) {
    const deadlineId = await deps.others.createDeadline({ title: `${v.title} (${await assetName(deps, v.assetId)})`, assetId: v.assetId, category: "technical", level: "national", calc: { type: "manual", dueOn: v.scheduledOn }, proofRequired: false });
    if (deadlineId) {
      await deps.repo.updateWork(id, { deadlineId });
      deadlineCreated = true;
    }
  }
  await deps.audit.record({ action: "maintenance.work.create", entityType: "maint_work", entityId: id, diff: { status: v.status, deadlineCreated } });
  return ok({ id });
}

export async function updateWork(deps: MaintenanceDeps, id: string, raw: unknown, today: string): Promise<Id> {
  const p = parseInput(workSchema, raw);
  if (!p.ok) return p;
  const current = await deps.repo.getWork(id);
  if (!current) return failGeneral("Intervento non trovato");
  const v = p.value;
  const errors = await refs(deps, { assetId: v.assetId, parties: [v.supplierPartyId] });
  if (hasErrors(errors)) return fail(errors);
  await deps.repo.updateWork(id, {
    assetId: v.assetId,
    title: v.title,
    description: v.description ?? null,
    status: v.status,
    supplierPartyId: v.supplierPartyId ?? null,
    // Cambiando immobile l'impianto collegato (di un altro immobile) si scollega.
    ...(v.assetId !== current.assetId && { plantId: null }),
    scheduledOn: v.scheduledOn ?? null,
    startedOn: v.startedOn ?? null,
    completedOn: v.completedOn ?? (v.status === "completed" ? today : null),
    budgetCents: v.budget ?? null,
    note: v.note ?? null,
  });
  await deps.audit.record({ action: "maintenance.work.update", entityType: "maint_work", entityId: id, diff: { statusFrom: current.status, statusTo: v.status } });
  return ok({ id });
}

/** Cambia solo lo stato: inizio e fine si compilano con la data di oggi se mancano. */
export async function setWorkStatus(deps: MaintenanceDeps, id: string, status: string, today: string): Promise<Id> {
  if (!(WORK_STATUSES as readonly string[]).includes(status)) return fail({ status: ["Stato non valido"] });
  const work = await deps.repo.getWork(id);
  if (!work) return failGeneral("Intervento non trovato");
  const next = status as WorkStatus;
  await deps.repo.updateWork(id, { status: next, ...(next === "in_progress" && !work.startedOn && { startedOn: today }), ...(next === "completed" && !work.completedOn && { completedOn: today }) });
  await deps.audit.record({ action: "maintenance.work.status", entityType: "maint_work", entityId: id, diff: { statusFrom: work.status, statusTo: next } });
  return ok({ id });
}

// -------------------------------------------------------------------------------------------------- preventivi, fatture, avanzamenti

export async function addQuote(deps: MaintenanceDeps, workId: string, raw: unknown): Promise<Id> {
  const p = parseInput(quoteSchema, raw);
  if (!p.ok) return p;
  const work = await deps.repo.getWork(workId);
  if (!work) return failGeneral("Intervento non trovato");
  const v = p.value;
  const errors = await refs(deps, { parties: [v.supplierPartyId], documents: [v.documentId] });
  if (hasErrors(errors)) return fail(errors);
  const id = await deps.repo.insertQuote({ workId, supplierPartyId: v.supplierPartyId ?? null, amountCents: v.amount, quotedOn: v.quotedOn ?? null, validUntil: v.validUntil ?? null, status: v.status, documentId: v.documentId ?? null, note: v.note ?? null });
  // Con un preventivo l'intervento passa da «previsto» a «con preventivo»; con uno accettato, ad «approvato».
  if (v.status === "accepted") await advanceOnAccept(deps, work, v.supplierPartyId);
  else if (work.status === "planned") await deps.repo.updateWork(workId, { status: "quoted" });
  await deps.audit.record({ action: "maintenance.quote.add", entityType: "maint_work", entityId: workId, diff: { quoteId: id, status: v.status } });
  return ok({ id: workId });
}

async function advanceOnAccept(deps: MaintenanceDeps, work: WorkRow, supplierPartyId: string | undefined | null) {
  const patch: Partial<WorkRow> = {};
  if (work.status === "planned" || work.status === "quoted") patch.status = "approved";
  if (!work.supplierPartyId && supplierPartyId) patch.supplierPartyId = supplierPartyId;
  if (Object.keys(patch).length > 0) await deps.repo.updateWork(work.id, patch);
}

export async function setQuoteStatus(deps: MaintenanceDeps, quoteId: string, status: string): Promise<Id> {
  if (!(QUOTE_STATUSES as readonly string[]).includes(status)) return fail({ status: ["Stato non valido"] });
  const quote = await deps.repo.getQuote(quoteId);
  if (!quote) return failGeneral("Preventivo non trovato");
  await deps.repo.updateQuote(quoteId, { status: status as QuoteStatus });
  if (status === "accepted") {
    const work = await deps.repo.getWork(quote.workId);
    if (work) await advanceOnAccept(deps, work, quote.supplierPartyId);
  }
  await deps.audit.record({ action: "maintenance.quote.status", entityType: "maint_work", entityId: quote.workId, diff: { quoteId, statusFrom: quote.status, statusTo: status } });
  return ok({ id: quote.workId });
}

export async function addInvoice(deps: MaintenanceDeps, workId: string, raw: unknown): Promise<Id> {
  const p = parseInput(invoiceSchema, raw);
  if (!p.ok) return p;
  if (!(await deps.repo.getWork(workId))) return failGeneral("Intervento non trovato");
  const errors = await refs(deps, { documents: [p.value.documentId] });
  if (hasErrors(errors)) return fail(errors);
  const v = p.value;
  const id = await deps.repo.insertInvoice({ workId, number: v.number ?? null, issuedOn: v.issuedOn, amountCents: v.amount, paidOn: v.paidOn ?? null, documentId: v.documentId ?? null, note: v.note ?? null });
  await deps.audit.record({ action: "maintenance.invoice.add", entityType: "maint_work", entityId: workId, diff: { invoiceId: id, paid: Boolean(v.paidOn) } });
  return ok({ id: workId });
}

/** Segna una fattura come pagata (con la data) o di nuovo da pagare (data nulla). */
export async function setInvoicePaid(deps: MaintenanceDeps, invoiceId: string, paidOn: string | null): Promise<Id> {
  if (paidOn !== null && !/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) return fail({ paidOn: ["Data non valida"] });
  const invoice = await deps.repo.getInvoice(invoiceId);
  if (!invoice) return failGeneral("Fattura non trovata");
  await deps.repo.updateInvoice(invoiceId, { paidOn });
  await deps.audit.record({ action: "maintenance.invoice.paid", entityType: "maint_work", entityId: invoice.workId, diff: { invoiceId, paid: paidOn !== null } });
  return ok({ id: invoice.workId });
}

export async function addProgress(deps: MaintenanceDeps, workId: string, raw: unknown, today: string): Promise<Id> {
  const p = parseInput(progressSchema, raw);
  if (!p.ok) return p;
  if (!(await deps.repo.getWork(workId))) return failGeneral("Intervento non trovato");
  const id = await deps.repo.insertProgress({ workId, recordedOn: p.value.recordedOn ?? today, percent: p.value.percent ?? null, note: p.value.note });
  await deps.audit.record({ action: "maintenance.progress.add", entityType: "maint_work", entityId: workId, diff: { progressId: id, withPercent: p.value.percent !== undefined } });
  return ok({ id: workId });
}

/** Toglie una voce registrata per errore (preventivo, fattura o avanzamento). */
export async function removeEntry(deps: MaintenanceDeps, kind: string, entryId: string): Promise<Id> {
  if (!(ENTRY_KINDS as readonly string[]).includes(kind)) return failGeneral("Tipo di voce non valido");
  const entryKind = kind as EntryKind;
  const row: QuoteRow | InvoiceRow | ProgressRow | null = entryKind === "quote" ? await deps.repo.getQuote(entryId) : entryKind === "invoice" ? await deps.repo.getInvoice(entryId) : await deps.repo.getProgress(entryId);
  if (!row) return failGeneral("Voce non trovata");
  if (entryKind === "quote") await deps.repo.deleteQuote(entryId);
  else if (entryKind === "invoice") await deps.repo.deleteInvoice(entryId);
  else await deps.repo.deleteProgress(entryId);
  await deps.audit.record({ action: "maintenance.entry.remove", entityType: "maint_work", entityId: row.workId, diff: { kind: entryKind, entryId } });
  return ok({ id: row.workId });
}

// -------------------------------------------------------------------------------------------------- garanzie e ispezioni

export async function createWarranty(deps: MaintenanceDeps, raw: unknown): Promise<Id> {
  const p = parseInput(warrantySchema, raw);
  if (!p.ok) return p;
  const v = p.value;
  const errors = await refs(deps, { assetId: v.assetId, parties: [v.supplierPartyId], documents: [v.documentId], workId: v.workId, plantId: v.plantId });
  if (hasErrors(errors)) return fail(errors);
  const id = await deps.repo.insertWarranty({ assetId: v.assetId, workId: v.workId ?? null, plantId: v.plantId ?? null, title: v.title, startsOn: v.startsOn ?? null, endsOn: v.endsOn, supplierPartyId: v.supplierPartyId ?? null, documentId: v.documentId ?? null, note: v.note ?? null, deadlineId: null, archived: false });
  let deadlineCreated = false;
  if (v.createDeadline) {
    const deadlineId = await deps.others.createDeadline({ title: `Scadenza garanzia: ${v.title} (${await assetName(deps, v.assetId)})`, assetId: v.assetId, category: "contractual", level: "contract", calc: { type: "manual", dueOn: v.endsOn }, proofRequired: false });
    if (deadlineId) {
      await deps.repo.updateWarranty(id, { deadlineId });
      deadlineCreated = true;
    }
  }
  await deps.audit.record({ action: "maintenance.warranty.create", entityType: "maint_warranty", entityId: id, diff: { deadlineCreated } });
  return ok({ id });
}

/** Archivia una garanzia (o la ripristina); la scadenza collegata segue. */
export async function setWarrantyArchived(deps: MaintenanceDeps, id: string, archived: boolean): Promise<Id> {
  const w = await deps.repo.getWarranty(id);
  if (!w) return failGeneral("Garanzia non trovata");
  await deps.repo.updateWarranty(id, { archived });
  if (w.deadlineId) await deps.others.archiveDeadline(w.deadlineId, archived);
  await deps.audit.record({ action: archived ? "maintenance.warranty.archive" : "maintenance.warranty.restore", entityType: "maint_warranty", entityId: id, diff: {} });
  return ok({ id });
}

export async function createInspectionPlan(deps: MaintenanceDeps, raw: unknown): Promise<Id> {
  const p = parseInput(inspectionPlanSchema, raw);
  if (!p.ok) return p;
  const v = p.value;
  const errors = await refs(deps, { assetId: v.assetId, parties: [v.supplierPartyId], plantId: v.plantId });
  if (hasErrors(errors)) return fail(errors);
  const deadlineId = await deps.others.createDeadline({ title: `${v.title} (${await assetName(deps, v.assetId)})`, assetId: v.assetId, category: "technical", level: "national", calc: { type: "recurring", anchorOn: v.firstDueOn, everyMonths: v.intervalMonths }, proofRequired: true });
  if (!deadlineId) return failGeneral("Non è stato possibile creare la scadenza ricorrente");
  const id = await deps.repo.insertPlan({ assetId: v.assetId, title: v.title, intervalMonths: v.intervalMonths, firstDueOn: v.firstDueOn, supplierPartyId: v.supplierPartyId ?? null, plantId: v.plantId ?? null, note: v.note ?? null, deadlineId, archived: false });
  await deps.audit.record({ action: "maintenance.plan.create", entityType: "maint_inspection_plan", entityId: id, diff: { intervalMonths: v.intervalMonths } });
  return ok({ id });
}

export async function setPlanArchived(deps: MaintenanceDeps, id: string, archived: boolean): Promise<Id> {
  const plan = await deps.repo.getPlan(id);
  if (!plan) return failGeneral("Piano non trovato");
  await deps.repo.updatePlan(id, { archived });
  if (plan.deadlineId) await deps.others.archiveDeadline(plan.deadlineId, archived);
  await deps.audit.record({ action: archived ? "maintenance.plan.archive" : "maintenance.plan.restore", entityType: "maint_inspection_plan", entityId: id, diff: {} });
  return ok({ id });
}

// -------------------------------------------------------------------------------------------------- impianti

function plantData(v: { kind: PlantRow["kind"]; name: string; installedOn?: string; installerPartyId?: string; maintainerPartyId?: string; serialNumber?: string; note?: string }) {
  return {
    kind: v.kind,
    name: v.name,
    installedOn: v.installedOn ?? null,
    installerPartyId: v.installerPartyId ?? null,
    maintainerPartyId: v.maintainerPartyId ?? null,
    serialNumber: v.serialNumber ?? null,
    note: v.note ?? null,
  };
}

export async function createPlant(deps: MaintenanceDeps, raw: unknown): Promise<Id> {
  const p = parseInput(plantSchema, raw);
  if (!p.ok) return p;
  const v = p.value;
  const errors = await refs(deps, { assetId: v.assetId, parties: [v.installerPartyId, v.maintainerPartyId] });
  if (hasErrors(errors)) return fail(errors);
  const id = await deps.repo.insertPlant({ assetId: v.assetId, ...plantData(v), archived: false });
  await deps.audit.record({ action: "maintenance.plant.create", entityType: "plant", entityId: id, diff: { kind: v.kind, assetId: v.assetId } });
  return ok({ id });
}

export async function updatePlant(deps: MaintenanceDeps, id: string, raw: unknown): Promise<Id> {
  const p = parseInput(plantUpdateSchema, raw);
  if (!p.ok) return p;
  const current = await deps.repo.getPlant(id);
  if (!current) return failGeneral("Impianto non trovato");
  const v = p.value;
  const errors = await refs(deps, { parties: [v.installerPartyId, v.maintainerPartyId] });
  if (hasErrors(errors)) return fail(errors);
  const next = plantData(v);
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== current[k]);
  await deps.repo.updatePlant(id, next);
  await deps.audit.record({ action: "maintenance.plant.update", entityType: "plant", entityId: id, diff: { changed } });
  return ok({ id });
}

export async function setPlantArchived(deps: MaintenanceDeps, id: string, archived: boolean): Promise<Id> {
  if (!(await deps.repo.getPlant(id))) return failGeneral("Impianto non trovato");
  await deps.repo.updatePlant(id, { archived });
  await deps.audit.record({ action: archived ? "maintenance.plant.archive" : "maintenance.plant.restore", entityType: "plant", entityId: id, diff: {} });
  return ok({ id });
}

export async function linkPlantDocument(deps: MaintenanceDeps, plantId: string, documentId: string): Promise<Id> {
  if (!(await deps.repo.getPlant(plantId))) return failGeneral("Impianto non trovato");
  const errors = await refs(deps, { documents: [documentId] });
  if (hasErrors(errors)) return fail(errors);
  await deps.repo.linkPlantDocument(plantId, documentId);
  await deps.audit.record({ action: "maintenance.plant.document.link", entityType: "plant", entityId: plantId, diff: { documentId } });
  return ok({ id: plantId });
}

export async function unlinkPlantDocument(deps: MaintenanceDeps, plantId: string, documentId: string): Promise<Id> {
  if (!(await deps.repo.getPlant(plantId))) return failGeneral("Impianto non trovato");
  await deps.repo.unlinkPlantDocument(plantId, documentId);
  await deps.audit.record({ action: "maintenance.plant.document.unlink", entityType: "plant", entityId: plantId, diff: { documentId } });
  return ok({ id: plantId });
}

export const PLANT_LINK_KINDS = ["plan", "warranty", "work"] as const;

/** Collega a un impianto (o scollega, con `plantId` nullo) un piano di ispezione, una garanzia o un intervento esistente dello stesso immobile. */
export async function assignPlant(deps: MaintenanceDeps, kind: string, id: string, plantId: string | null): Promise<Id> {
  if (!(PLANT_LINK_KINDS as readonly string[]).includes(kind)) return failGeneral("Elemento non trovato");
  const record = kind === "plan" ? await deps.repo.getPlan(id) : kind === "warranty" ? await deps.repo.getWarranty(id) : await deps.repo.getWork(id);
  if (!record) return failGeneral("Elemento non trovato");
  if (plantId) {
    const errors = await refs(deps, { assetId: record.assetId, plantId });
    if (hasErrors(errors)) return fail(errors);
  }
  if (kind === "plan") await deps.repo.updatePlan(id, { plantId });
  else if (kind === "warranty") await deps.repo.updateWarranty(id, { plantId });
  else await deps.repo.updateWork(id, { plantId });
  await deps.audit.record({ action: plantId ? "maintenance.plant.assign" : "maintenance.plant.unassign", entityType: "plant", entityId: plantId ?? record.plantId ?? id, diff: { kind, itemId: id } });
  return ok({ id });
}

// -------------------------------------------------------------------------------------------------- letture

export type PlantItem = PlantRow & { assetName: string; installerName: string | null; maintainerName: string | null };

export async function listPlants(deps: MaintenanceReadDeps, filter: { assetId?: string; includeArchived?: boolean } = {}): Promise<PlantItem[]> {
  const [rows, assets, parties] = await Promise.all([deps.repo.plants({ assetId: filter.assetId, includeArchived: filter.includeArchived ?? false }), deps.others.assets(), deps.others.parties()]);
  const assetNames = new Map(assets.map((a) => [a.id, a.name]));
  return rows.map((p) => ({ ...p, assetName: assetNames.get(p.assetId) ?? "", installerName: p.installerPartyId ? (parties.get(p.installerPartyId) ?? null) : null, maintainerName: p.maintainerPartyId ? (parties.get(p.maintainerPartyId) ?? null) : null }));
}

export type PlantDetail = PlantItem & { documents: { id: string; title: string }[] };

export async function getPlantDetail(deps: MaintenanceReadDeps, id: string): Promise<PlantDetail | null> {
  const row = await deps.repo.getPlant(id);
  if (!row) return null;
  const [assets, parties, documentIds] = await Promise.all([deps.others.assets(), deps.others.parties(), deps.repo.plantDocumentIds(id)]);
  const titles = await deps.others.documentTitles();
  return {
    ...row,
    assetName: assets.find((a) => a.id === row.assetId)?.name ?? "",
    installerName: row.installerPartyId ? (parties.get(row.installerPartyId) ?? null) : null,
    maintainerName: row.maintainerPartyId ? (parties.get(row.maintainerPartyId) ?? null) : null,
    documents: documentIds.flatMap((d) => (titles.has(d) ? [{ id: d, title: titles.get(d)! }] : [])),
  };
}

/** Le fatture pagate in un periodo, una per riga: servono al quadro economico. */
export async function invoiceLedger(deps: MaintenanceReadDeps, from: string, to: string) {
  return (await deps.repo.paidInvoicesBetween(from, to)).map((r) => ({ id: r.invoiceId, refId: r.workId, date: r.paidOn, amountCents: r.amountCents, documentId: r.documentId, assetId: r.assetId, label: `${r.workTitle}${r.number ? ` (fattura ${r.number})` : ""}` }));
}

const CLOSED: readonly WorkStatus[] = ["completed", "cancelled"];

export type WorkItem = WorkRow & { assetName: string; supplierName: string | null; acceptedQuotesCents: number; invoicedCents: number; paidCents: number; lastPercent: number | null };

export async function listWorks(deps: MaintenanceReadDeps, filter: { assetId?: string; status?: string; includeClosed?: boolean }): Promise<WorkItem[]> {
  const [rows, assets, parties] = await Promise.all([deps.repo.listWorks({ assetId: filter.assetId }), deps.others.assets(), deps.others.parties()]);
  const visible = rows.filter((w) => (filter.status ? w.status === filter.status : filter.includeClosed || !CLOSED.includes(w.status)));
  const ids = visible.map((w) => w.id);
  const [quotes, invoices] = await Promise.all([deps.repo.quotesOf(ids), deps.repo.invoicesOf(ids)]);
  const assetNames = new Map(assets.map((a) => [a.id, a.name]));
  return Promise.all(
    visible.map(async (w) => {
      const fin = workFinancials({ quotes: quotes.filter((q) => q.workId === w.id), invoices: invoices.filter((i) => i.workId === w.id), budgetCents: w.budgetCents });
      const last = (await deps.repo.progress(w.id)).filter((p) => p.percent !== null).at(-1);
      return { ...w, assetName: assetNames.get(w.assetId) ?? "", supplierName: w.supplierPartyId ? (parties.get(w.supplierPartyId) ?? null) : null, acceptedQuotesCents: fin.acceptedQuotesCents, invoicedCents: fin.invoicedCents, paidCents: fin.paidCents, lastPercent: last?.percent ?? null };
    }),
  );
}

export type WorkDetail = WorkRow & {
  assetName: string;
  supplierName: string | null;
  quotes: (QuoteRow & { supplierName: string | null; documentTitle: string | null; expired: boolean })[];
  invoices: (InvoiceRow & { documentTitle: string | null })[];
  progress: ProgressRow[];
  financials: ReturnType<typeof workFinancials>;
  warranties: (WarrantyRow & { state: PeriodState })[];
};

export async function getWorkDetail(deps: MaintenanceReadDeps, id: string, today: string): Promise<WorkDetail | null> {
  const work = await deps.repo.getWork(id);
  if (!work) return null;
  const [assets, parties, titles, quotes, invoices, progress, warranties] = await Promise.all([
    deps.others.assets(),
    deps.others.parties(),
    deps.others.documentTitles(),
    deps.repo.quotes(id),
    deps.repo.invoices(id),
    deps.repo.progress(id),
    deps.repo.warranties({ assetId: work.assetId, includeArchived: false }),
  ]);
  return {
    ...work,
    assetName: assets.find((a) => a.id === work.assetId)?.name ?? "",
    supplierName: work.supplierPartyId ? (parties.get(work.supplierPartyId) ?? null) : null,
    quotes: quotes.map((q) => ({ ...q, supplierName: q.supplierPartyId ? (parties.get(q.supplierPartyId) ?? null) : null, documentTitle: q.documentId ? (titles.get(q.documentId) ?? null) : null, expired: quoteExpired(q, today) })),
    invoices: invoices.map((i) => ({ ...i, documentTitle: i.documentId ? (titles.get(i.documentId) ?? null) : null })),
    progress,
    financials: workFinancials({ quotes, invoices, budgetCents: work.budgetCents }),
    warranties: warranties.filter((w) => w.workId === id).map((w) => ({ ...w, state: periodState(w, today) })),
  };
}

export type WarrantyItem = WarrantyRow & { assetName: string; supplierName: string | null; documentTitle: string | null; workTitle: string | null; state: PeriodState };

export async function listWarranties(deps: MaintenanceReadDeps, filter: { assetId?: string; includeArchived?: boolean }, today: string): Promise<WarrantyItem[]> {
  const [rows, assets, parties, titles, works] = await Promise.all([deps.repo.warranties({ assetId: filter.assetId, includeArchived: filter.includeArchived ?? false }), deps.others.assets(), deps.others.parties(), deps.others.documentTitles(), deps.repo.listWorks({})]);
  return rows.map((w) => ({
    ...w,
    assetName: assets.find((a) => a.id === w.assetId)?.name ?? "",
    supplierName: w.supplierPartyId ? (parties.get(w.supplierPartyId) ?? null) : null,
    documentTitle: w.documentId ? (titles.get(w.documentId) ?? null) : null,
    workTitle: works.find((x) => x.id === w.workId)?.title ?? null,
    state: periodState(w, today),
  }));
}

export type PlanItem = PlanRow & { assetName: string; supplierName: string | null; nextDueOn: string | null; lastDoneOn: string | null };

export async function listInspectionPlans(deps: MaintenanceReadDeps, filter: { assetId?: string; includeArchived?: boolean }): Promise<PlanItem[]> {
  const [rows, assets, parties] = await Promise.all([deps.repo.plans({ assetId: filter.assetId, includeArchived: filter.includeArchived ?? false }), deps.others.assets(), deps.others.parties()]);
  return Promise.all(
    rows.map(async (p) => ({
      ...p,
      assetName: assets.find((a) => a.id === p.assetId)?.name ?? "",
      supplierName: p.supplierPartyId ? (parties.get(p.supplierPartyId) ?? null) : null,
      ...(p.deadlineId ? await deps.others.deadlineDates(p.deadlineId) : { nextDueOn: null, lastDoneOn: null }),
    })),
  );
}
