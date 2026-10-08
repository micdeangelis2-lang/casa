import { periodState, type PeriodState } from "@/shared/dates";
import { quoteExpired, workFinancials, type WorkStatus } from "../domain/maintenance";
import type { InvoiceRow, MaintenanceReadDeps, PlanRow, PlantRow, ProgressRow, QuoteRow, WarrantyRow, WorkRow } from "./ports";

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
