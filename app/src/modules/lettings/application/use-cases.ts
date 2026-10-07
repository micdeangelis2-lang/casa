import type { PeriodState } from "@/shared/dates";
import { fail, failGeneral, ok, parseInput, type FieldErrors, type Result } from "@/shared/result";
import {
  LETTING_STATUSES,
  codeSchema,
  codeState,
  isContractType,
  lettingSchema,
  partySchema,
  rentDates,
  rentPaymentSchema,
  rentReceiptSchema,
  rentRowSchema,
  rentScheduleSchema,
  rentState,
  rentTotals,
  reportDoneSchema,
  reportSchema,
  reportState,
  type LettingStatus,
  type RentState,
  type ReportState,
} from "../domain/lettings";
import type { CodeRow, LettingDeps, LettingPartyRow, LettingReadDeps, LettingRow, ReceiptRow, RentRow, ReportRow } from "./ports";

type Id = Result<{ id: string }>;
const hasErrors = (e: FieldErrors) => Object.keys(e).length > 0;
/** Oltre questo numero di canoni non si creano le scadenze una per una: sarebbero un elenco ingestibile. */
const MAX_RENT_DEADLINES = 24;

async function refs(deps: LettingDeps, r: { assetId?: string; parties?: (string | undefined)[]; documents?: (string | undefined)[] }): Promise<FieldErrors> {
  const errors: FieldErrors = {};
  if (r.assetId && !(await deps.others.assets()).some((a) => a.id === r.assetId)) errors.assetId = ["L'immobile non esiste"];
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
  return errors;
}
const renamePartyError = (errors: FieldErrors, to: string): FieldErrors => Object.fromEntries(Object.entries(errors).map(([k, v]) => [k === "partyId" ? to : k, v]));

const categoryOf = (l: Pick<LettingRow, "type">) => (isContractType(l.type) ? "letting" : "hospitality") as "letting" | "hospitality";

// -------------------------------------------------------------------------------------------------- locazione o attivita'

function lettingData(v: ReturnType<typeof lettingSchema.parse>): Omit<LettingRow, "id" | "deadlineId"> {
  return {
    assetId: v.assetId,
    type: v.type,
    title: v.title,
    status: v.status,
    startsOn: v.startsOn ?? null,
    endsOn: v.endsOn ?? null,
    managerPartyId: v.managerPartyId ?? null,
    monthlyRentCents: v.monthlyRent ?? null,
    depositCents: v.deposit ?? null,
    depositReceivedOn: v.depositReceivedOn ?? null,
    depositReturnedOn: v.depositReturnedOn ?? null,
    depositReturnedCents: v.depositReturned ?? null,
    registeredOn: v.registeredOn ?? null,
    registrationNumber: v.registrationNumber ?? null,
    registrationOffice: v.registrationOffice ?? null,
    contractDocumentId: v.contractDocumentId ?? null,
    note: v.note ?? null,
  };
}

export async function createLetting(deps: LettingDeps, raw: unknown): Promise<Id> {
  const p = parseInput(lettingSchema, raw);
  if (!p.ok) return p;
  const v = p.value;
  const errors = await refs(deps, { assetId: v.assetId, parties: [v.managerPartyId], documents: [v.contractDocumentId] });
  if (hasErrors(errors)) return fail(renamePartyError(errors, "managerPartyId"));
  if (v.createDeadline && !v.endsOn) return fail({ endsOn: ["Per creare il promemoria serve la data di fine"] });
  const id = await deps.repo.insertLetting({ ...lettingData(v), deadlineId: null });
  let deadlineCreated = false;
  if (v.createDeadline && v.endsOn) {
    const asset = (await deps.others.assets()).find((a) => a.id === v.assetId)?.name;
    const deadlineId = await deps.others.createDeadline({ title: `Fine di «${v.title}»${asset ? ` (${asset})` : ""}`, dueOn: v.endsOn, assetId: v.assetId, category: categoryOf(v), proofRequired: false });
    if (deadlineId) {
      await deps.repo.updateLetting(id, { deadlineId });
      deadlineCreated = true;
    }
  }
  await deps.audit.record({ action: "letting.create", entityType: "letting", entityId: id, diff: { type: v.type, status: v.status, deadlineCreated } });
  return ok({ id });
}

export async function updateLetting(deps: LettingDeps, id: string, raw: unknown): Promise<Id> {
  const p = parseInput(lettingSchema, raw);
  if (!p.ok) return p;
  const current = await deps.repo.getLetting(id);
  if (!current) return failGeneral("Locazione non trovata");
  const v = p.value;
  const errors = await refs(deps, { assetId: v.assetId, parties: [v.managerPartyId], documents: [v.contractDocumentId] });
  if (hasErrors(errors)) return fail(renamePartyError(errors, "managerPartyId"));
  await deps.repo.updateLetting(id, lettingData(v));
  await deps.audit.record({ action: "letting.update", entityType: "letting", entityId: id, diff: { typeFrom: current.type, typeTo: v.type, statusFrom: current.status, statusTo: v.status } });
  return ok({ id });
}

/** Cambia lo stato (preparazione, in corso, conclusa); passando a «conclusa» la data di fine si compila con oggi se manca. */
export async function setLettingStatus(deps: LettingDeps, id: string, status: string, today: string): Promise<Id> {
  if (!(LETTING_STATUSES as readonly string[]).includes(status)) return fail({ status: ["Stato non valido"] });
  const letting = await deps.repo.getLetting(id);
  if (!letting) return failGeneral("Locazione non trovata");
  const next = status as LettingStatus;
  await deps.repo.updateLetting(id, { status: next, ...(next === "ended" && !letting.endsOn && { endsOn: today }) });
  await deps.audit.record({ action: "letting.status", entityType: "letting", entityId: id, diff: { statusFrom: letting.status, statusTo: next } });
  return ok({ id });
}

// -------------------------------------------------------------------------------------------------- persone

export async function addLettingParty(deps: LettingDeps, lettingId: string, raw: unknown): Promise<Id> {
  const p = parseInput(partySchema, raw);
  if (!p.ok) return p;
  if (!(await deps.repo.getLetting(lettingId))) return failGeneral("Locazione non trovata");
  const errors = await refs(deps, { parties: [p.value.partyId] });
  if (hasErrors(errors)) return fail(errors);
  await deps.repo.addParty({ lettingId, partyId: p.value.partyId, role: p.value.role });
  await deps.audit.record({ action: "letting.party.add", entityType: "letting", entityId: lettingId, diff: { partyId: p.value.partyId, role: p.value.role } });
  return ok({ id: lettingId });
}

export async function removeLettingParty(deps: LettingDeps, lettingId: string, partyId: string): Promise<Id> {
  if (!(await deps.repo.getLetting(lettingId))) return failGeneral("Locazione non trovata");
  await deps.repo.removeParty(lettingId, partyId);
  await deps.audit.record({ action: "letting.party.remove", entityType: "letting", entityId: lettingId, diff: { partyId } });
  return ok({ id: lettingId });
}

// -------------------------------------------------------------------------------------------------- canoni

/**
 * Crea il calendario dei canoni (una scadenza al mese, stesso importo). Si puo' rigenerare finche' nessun canone e' stato
 * pagato; le scadenze dei canoni sostituiti vengono archiviate. Gli importi sono quelli scritti dal proprietario.
 */
export async function generateRentSchedule(deps: LettingDeps, lettingId: string, raw: unknown): Promise<Result<{ id: string; created: number }>> {
  const p = parseInput(rentScheduleSchema, raw);
  if (!p.ok) return p;
  const letting = await deps.repo.getLetting(lettingId);
  if (!letting) return failGeneral("Locazione non trovata");
  if (!isContractType(letting.type)) return failGeneral("Il calendario dei canoni vale per le locazioni di durata, non per i soggiorni brevi");
  if (p.value.amount <= 0) return fail({ amount: ["Il canone deve essere maggiore di zero"] });
  if (p.value.createDeadlines && p.value.months > MAX_RENT_DEADLINES) return fail({ createDeadlines: [`Le scadenze si creano per al massimo ${MAX_RENT_DEADLINES} canoni`] });
  const existing = await deps.repo.rents(lettingId);
  if (existing.some((r) => r.paidCents > 0)) return fail({ _: ["Ci sono canoni già pagati: non si può rigenerare il calendario"] });
  for (const r of existing) if (r.deadlineId) await deps.others.archiveDeadline(r.deadlineId);
  await deps.repo.deleteRents(lettingId);

  const dates = rentDates(p.value.firstDueOn, p.value.months);
  const ids = await deps.repo.insertRents(dates.map((dueOn) => ({ lettingId, dueOn, amountCents: p.value.amount, paidOn: null, paidCents: 0, documentId: null, deadlineId: null })));
  if (p.value.createDeadlines) {
    for (const [index, dueOn] of dates.entries()) {
      const deadlineId = await deps.others.createDeadline({ title: `Canone ${index + 1}/${dates.length}: ${letting.title}`, dueOn, assetId: letting.assetId, category: categoryOf(letting), proofRequired: false });
      if (deadlineId) await deps.repo.updateRent(ids[index]!, { deadlineId });
    }
  }
  await deps.audit.record({ action: "letting.rent.generate", entityType: "letting", entityId: lettingId, diff: { rows: dates.length, deadlines: p.value.createDeadlines } });
  return ok({ id: lettingId, created: dates.length });
}

export async function addRent(deps: LettingDeps, lettingId: string, raw: unknown): Promise<Id> {
  const p = parseInput(rentRowSchema, raw);
  if (!p.ok) return p;
  if (!(await deps.repo.getLetting(lettingId))) return failGeneral("Locazione non trovata");
  if ((await deps.repo.rents(lettingId)).some((r) => r.dueOn === p.value.dueOn)) return fail({ dueOn: ["Esiste già un canone con questa scadenza"] });
  const [id] = await deps.repo.insertRents([{ lettingId, dueOn: p.value.dueOn, amountCents: p.value.amount, paidOn: null, paidCents: 0, documentId: null, deadlineId: null }]);
  await deps.audit.record({ action: "letting.rent.add", entityType: "letting", entityId: lettingId, diff: { rentId: id } });
  return ok({ id: lettingId });
}

/**
 * Ricalcola il canone dai suoi incassi: totale pagato, data dell'ultimo incasso e documento dell'ultimo incasso che ne ha uno.
 * A canone coperto la scadenza collegata si chiude; se un incasso tolto o corretto lo scopre, torna aperta.
 */
async function syncRent(deps: LettingDeps, rent: RentRow, today: string): Promise<{ covered: boolean; paidCents: number }> {
  const receipts = await deps.repo.receipts(rent.id);
  const paidCents = receipts.reduce((n, r) => n + r.amountCents, 0);
  const lastOn = receipts.reduce<string | null>((latest, r) => (latest === null || r.paidOn > latest ? r.paidOn : latest), null);
  const lastProof = [...receipts].reverse().find((r) => r.documentId !== null)?.documentId ?? null;
  await deps.repo.updateRent(rent.id, { paidCents, paidOn: lastOn, documentId: lastProof });
  const covered = paidCents >= rent.amountCents;
  if (covered && rent.deadlineId) await deps.others.completeDeadline(rent.deadlineId, { completedOn: lastOn ?? today, reference: "Canone registrato come pagato" });
  if (!covered && rent.deadlineId && rent.paidCents >= rent.amountCents) await deps.others.reopenDeadline(rent.deadlineId);
  return { covered, paidCents };
}

/**
 * Imposta il totale pagato di un canone con un unico incasso (sostituisce quelli registrati, non ne aggiunge). Per piu' incassi
 * con data, modalita' e prova si usa `addRentReceipt`.
 */
export async function recordRentPayment(deps: LettingDeps, rentId: string, raw: unknown, today: string): Promise<Id> {
  const p = parseInput(rentPaymentSchema, raw);
  if (!p.ok) return p;
  const rent = await deps.repo.getRent(rentId);
  if (!rent) return failGeneral("Canone non trovato");
  const errors = await refs(deps, { documents: [p.value.documentId] });
  if (hasErrors(errors)) return fail(errors);
  await deps.repo.deleteReceiptsOf(rentId);
  if (p.value.paid > 0) await deps.repo.insertReceipt({ rentId, paidOn: p.value.paidOn ?? today, amountCents: p.value.paid, method: null, documentId: p.value.documentId ?? rent.documentId });
  const { covered } = await syncRent(deps, rent, today);
  await deps.audit.record({ action: "letting.rent.pay", entityType: "letting", entityId: rent.lettingId, diff: { rentId, covered } });
  return ok({ id: rent.lettingId });
}

/** Un canone con un importo pagato ma senza incassi (dati di un archivio precedente agli incassi) diventa un incasso unico, prima di aggiungerne altri. */
async function materializeLegacyReceipt(deps: LettingDeps, rent: RentRow): Promise<void> {
  if (rent.paidCents <= 0 || (await deps.repo.receipts(rent.id)).length > 0) return;
  await deps.repo.insertReceipt({ rentId: rent.id, paidOn: rent.paidOn ?? rent.dueOn, amountCents: rent.paidCents, method: null, documentId: rent.documentId });
}

/** Aggiunge un incasso a un canone (data, importo, modalita' libera, documento di prova). */
export async function addRentReceipt(deps: LettingDeps, rentId: string, raw: unknown, today: string): Promise<Id> {
  const p = parseInput(rentReceiptSchema, raw);
  if (!p.ok) return p;
  const rent = await deps.repo.getRent(rentId);
  if (!rent) return failGeneral("Canone non trovato");
  const errors = await refs(deps, { documents: [p.value.documentId] });
  if (hasErrors(errors)) return fail(errors);
  await materializeLegacyReceipt(deps, rent);
  const receiptId = await deps.repo.insertReceipt({ rentId, paidOn: p.value.paidOn ?? today, amountCents: p.value.amount, method: p.value.method ?? null, documentId: p.value.documentId ?? null });
  const { covered } = await syncRent(deps, rent, today);
  await deps.audit.record({ action: "letting.rent.receipt.add", entityType: "letting", entityId: rent.lettingId, diff: { rentId, receiptId, covered, withProof: Boolean(p.value.documentId) } });
  return ok({ id: rent.lettingId });
}

export async function removeRentReceipt(deps: LettingDeps, receiptId: string, today: string): Promise<Id> {
  const receipt = await deps.repo.getReceipt(receiptId);
  if (!receipt) return failGeneral("Incasso non trovato");
  const rent = await deps.repo.getRent(receipt.rentId);
  if (!rent) return failGeneral("Canone non trovato");
  await deps.repo.deleteReceipt(receiptId);
  const { covered } = await syncRent(deps, rent, today);
  await deps.audit.record({ action: "letting.rent.receipt.remove", entityType: "letting", entityId: rent.lettingId, diff: { rentId: rent.id, receiptId, covered } });
  return ok({ id: rent.lettingId });
}

export async function removeRent(deps: LettingDeps, rentId: string): Promise<Id> {
  const rent = await deps.repo.getRent(rentId);
  if (!rent) return failGeneral("Canone non trovato");
  await deps.repo.deleteRent(rentId);
  if (rent.deadlineId) await deps.others.archiveDeadline(rent.deadlineId);
  await deps.audit.record({ action: "letting.rent.remove", entityType: "letting", entityId: rent.lettingId, diff: { rentId } });
  return ok({ id: rent.lettingId });
}

// -------------------------------------------------------------------------------------------------- codici

export async function addCode(deps: LettingDeps, lettingId: string, raw: unknown): Promise<Id> {
  const p = parseInput(codeSchema, raw);
  if (!p.ok) return p;
  if (!(await deps.repo.getLetting(lettingId))) return failGeneral("Locazione non trovata");
  const v = p.value;
  if ((await deps.repo.codes(lettingId)).some((c) => c.label === v.label && c.value === v.value)) return fail({ value: ["Questo codice è già registrato per la locazione"] });
  const id = await deps.repo.insertCode({ lettingId, label: v.label, value: v.value, issuer: v.issuer ?? null, issuedOn: v.issuedOn ?? null, validUntil: v.validUntil ?? null, note: v.note ?? null });
  await deps.audit.record({ action: "letting.code.add", entityType: "letting", entityId: lettingId, diff: { codeId: id } });
  return ok({ id: lettingId });
}

export async function removeCode(deps: LettingDeps, codeId: string): Promise<Id> {
  const code = await deps.repo.getCode(codeId);
  if (!code) return failGeneral("Codice non trovato");
  await deps.repo.deleteCode(codeId);
  await deps.audit.record({ action: "letting.code.remove", entityType: "letting", entityId: code.lettingId, diff: { codeId } });
  return ok({ id: code.lettingId });
}

// -------------------------------------------------------------------------------------------------- adempimenti

export async function addReport(deps: LettingDeps, lettingId: string, raw: unknown): Promise<Id> {
  const p = parseInput(reportSchema, raw);
  if (!p.ok) return p;
  const letting = await deps.repo.getLetting(lettingId);
  if (!letting) return failGeneral("Locazione non trovata");
  const v = p.value;
  const errors = await refs(deps, { documents: [v.documentId] });
  if (hasErrors(errors)) return fail(errors);
  if (v.createDeadline && !v.dueOn) return fail({ dueOn: ["Per creare la scadenza serve la data"] });
  const id = await deps.repo.insertReport({ lettingId, kind: v.kind, title: v.title, period: v.period ?? null, dueOn: v.dueOn ?? null, amountCents: v.amount ?? null, doneOn: v.doneOn ?? null, documentId: v.documentId ?? null, note: v.note ?? null, deadlineId: null });
  let deadlineCreated = false;
  if (v.createDeadline && v.dueOn && !v.doneOn) {
    const deadlineId = await deps.others.createDeadline({ title: `${v.title}${v.period ? ` (${v.period})` : ""}: ${letting.title}`, dueOn: v.dueOn, assetId: letting.assetId, category: categoryOf(letting), proofRequired: true });
    if (deadlineId) {
      await deps.repo.updateReport(id, { deadlineId });
      deadlineCreated = true;
    }
  }
  await deps.audit.record({ action: "letting.report.add", entityType: "letting", entityId: lettingId, diff: { reportId: id, kind: v.kind, deadlineCreated } });
  return ok({ id: lettingId });
}

/** Segna un adempimento come eseguito (data, ricevuta, importo se c'e'); la scadenza collegata si chiude. */
export async function markReportDone(deps: LettingDeps, reportId: string, raw: unknown): Promise<Id> {
  const p = parseInput(reportDoneSchema, raw);
  if (!p.ok) return p;
  const report = await deps.repo.getReport(reportId);
  if (!report) return failGeneral("Adempimento non trovato");
  const errors = await refs(deps, { documents: [p.value.documentId] });
  if (hasErrors(errors)) return fail(errors);
  await deps.repo.updateReport(reportId, { doneOn: p.value.doneOn, documentId: p.value.documentId ?? report.documentId, amountCents: p.value.amount ?? report.amountCents });
  if (report.deadlineId) await deps.others.completeDeadline(report.deadlineId, { completedOn: p.value.doneOn, reference: "Adempimento segnato come eseguito" });
  await deps.audit.record({ action: "letting.report.done", entityType: "letting", entityId: report.lettingId, diff: { reportId, withProof: Boolean(p.value.documentId ?? report.documentId) } });
  return ok({ id: report.lettingId });
}

export async function reopenReport(deps: LettingDeps, reportId: string): Promise<Id> {
  const report = await deps.repo.getReport(reportId);
  if (!report) return failGeneral("Adempimento non trovato");
  await deps.repo.updateReport(reportId, { doneOn: null });
  if (report.deadlineId) await deps.others.reopenDeadline(report.deadlineId);
  await deps.audit.record({ action: "letting.report.reopen", entityType: "letting", entityId: report.lettingId, diff: { reportId } });
  return ok({ id: report.lettingId });
}

export async function removeReport(deps: LettingDeps, reportId: string): Promise<Id> {
  const report = await deps.repo.getReport(reportId);
  if (!report) return failGeneral("Adempimento non trovato");
  await deps.repo.deleteReport(reportId);
  if (report.deadlineId) await deps.others.archiveDeadline(report.deadlineId);
  await deps.audit.record({ action: "letting.report.remove", entityType: "letting", entityId: report.lettingId, diff: { reportId } });
  return ok({ id: report.lettingId });
}

// -------------------------------------------------------------------------------------------------- letture

/** Gli incassi registrati in un periodo, uno per riga (con il documento di prova): servono al quadro economico. */
export async function rentLedger(deps: LettingReadDeps, from: string, to: string) {
  return (await deps.repo.receiptsBetween(from, to)).map((r) => ({ id: r.receiptId, refId: r.lettingId, date: r.paidOn, amountCents: r.amountCents, documentId: r.documentId, assetId: r.assetId, label: r.lettingTitle }));
}

export type LettingItem = LettingRow & { assetName: string; managerName: string | null; people: string[]; overdueRents: number };

export async function listLettings(deps: LettingReadDeps, filter: { assetId?: string; status?: string; includeEnded?: boolean }, today: string): Promise<LettingItem[]> {
  const [rows, assets, parties] = await Promise.all([deps.repo.listLettings({ assetId: filter.assetId }), deps.others.assets(), deps.others.parties()]);
  const visible = rows.filter((l) => (filter.status ? l.status === filter.status : filter.includeEnded || l.status !== "ended"));
  return Promise.all(
    visible.map(async (l) => {
      const [people, rents] = await Promise.all([deps.repo.parties(l.id), deps.repo.rents(l.id)]);
      return {
        ...l,
        assetName: assets.find((a) => a.id === l.assetId)?.name ?? "",
        managerName: l.managerPartyId ? (parties.get(l.managerPartyId) ?? null) : null,
        people: people.map((x) => parties.get(x.partyId) ?? "").filter(Boolean),
        overdueRents: rents.filter((r) => rentState(r, today) === "overdue").length,
      };
    }),
  );
}

export type LettingDetail = LettingRow & {
  assetName: string;
  managerName: string | null;
  contractDocumentTitle: string | null;
  people: (LettingPartyRow & { name: string })[];
  rents: (RentRow & { state: RentState; documentTitle: string | null; receipts: (ReceiptRow & { documentTitle: string | null })[] })[];
  rentTotals: ReturnType<typeof rentTotals>;
  codes: (CodeRow & { state: PeriodState })[];
  reports: (ReportRow & { state: ReportState; documentTitle: string | null })[];
};

export async function getLettingDetail(deps: LettingReadDeps, id: string, today: string): Promise<LettingDetail | null> {
  const letting = await deps.repo.getLetting(id);
  if (!letting) return null;
  const [assets, parties, titles, people, rents, codes, reports] = await Promise.all([deps.others.assets(), deps.others.parties(), deps.others.documentTitles(), deps.repo.parties(id), deps.repo.rents(id), deps.repo.codes(id), deps.repo.reports(id)]);
  const receipts = await deps.repo.receiptsOfRents(rents.map((r) => r.id));
  return {
    ...letting,
    assetName: assets.find((a) => a.id === letting.assetId)?.name ?? "",
    managerName: letting.managerPartyId ? (parties.get(letting.managerPartyId) ?? null) : null,
    contractDocumentTitle: letting.contractDocumentId ? (titles.get(letting.contractDocumentId) ?? null) : null,
    people: people.map((x) => ({ ...x, name: parties.get(x.partyId) ?? "" })),
    rents: rents.map((r) => ({
      ...r,
      state: rentState(r, today),
      documentTitle: r.documentId ? (titles.get(r.documentId) ?? null) : null,
      receipts: receipts.filter((x) => x.rentId === r.id).map((x) => ({ ...x, documentTitle: x.documentId ? (titles.get(x.documentId) ?? null) : null })),
    })),
    rentTotals: rentTotals(rents, today),
    codes: codes.map((c) => ({ ...c, state: codeState(c, today) })),
    reports: reports.map((r) => ({ ...r, state: reportState(r, today), documentTitle: r.documentId ? (titles.get(r.documentId) ?? null) : null })),
  };
}

/** I tipi di locazione o attivita' attualmente in corso su un bene: serve alle regole come «fatto» del bene. */
export async function activeLettingTypes(deps: Pick<LettingReadDeps, "repo">, assetId: string): Promise<string[]> {
  return [...new Set(await deps.repo.activeTypesOfAsset(assetId))];
}
