/**
 * Interfaccia pubblica del modulo «Gestione affidata»: legge i dati di locazioni, manutenzioni, economia e scadenze e ne ricava
 * il rendiconto di un immobile per un periodo, il calendario dei prossimi 90 giorni e l'elenco dei mandati di gestione.
 * Il mandato e' un dato proprio (`management_mandate`): gestore dalla rubrica, date, compenso scritto dal proprietario come
 * testo, documento; la scadenza di fine e' il promemoria collegato. Dice solo cio' che risulta dai dati; non giudica l'operato del gestore.
 */
import type { UnitOfWork } from "@/platform/db/unit-of-work";
import type { Db } from "@/platform/db/types";
import { todayInItaly } from "@/platform/clock";
import { listAssets } from "@/modules/assets";
import { createDeadline, listOccurrences, setDeadlineArchived } from "@/modules/deadlines";
import { listParties } from "@/modules/directory";
import { documentTitles as readDocumentTitles } from "@/modules/documents";
import { economyEntries } from "@/modules/economy";
import { getLettingDetail, listLettings } from "@/modules/lettings";
import { listWarranties, listWorks } from "@/modules/maintenance";
import { buildCalendar, buildStatement, type LedgerLine } from "./domain/management";
import type { ManagementCollaborators } from "./application/ports";
import * as mandateCases from "./application/mandates";
import { drizzleMandateRepository } from "./infrastructure/drizzle-mandate-repository";

export { CALENDAR_DAYS, compareDeclared, type CalendarEvent, type CalendarKind, type CheckKey, type Comparison, type Occupation, type Statement, type WorkStage } from "./domain/management";
export type { MandateLine } from "./domain/management";
export { statementCsv, type StatementCsvLabels } from "./application/csv";
export { todayInItaly };

const COST_AREAS = ["taxes", "insurance", "maintenance", "condominium"];

function mandateCollaborators(db: Db, uow?: UnitOfWork): ManagementCollaborators {
  return {
    assetNames: async () => new Map((await listAssets(db)).map((a) => [a.id, a.name])),
    partyNames: async () => new Map((await listParties(db, { includeArchived: true })).map((p) => [p.id, p.displayName])),
    documentTitles: (ids) => readDocumentTitles(db, ids),
    async createEndDeadline(d) {
      if (!uow) throw new Error("Per creare una scadenza serve un'unita' di lavoro");
      const created = await createDeadline(uow, {
        title: d.title,
        description: d.description,
        category: "contractual",
        level: "contract",
        assetId: d.assetId ?? undefined,
        professionalPartyId: d.managerPartyId ?? undefined,
        calc: { type: "manual" },
        firstDueOn: d.endsOn,
        priority: "normal",
        proofRequired: false,
      });
      return created.ok ? created.value.id : null;
    },
    async archiveDeadline(deadlineId, archived) {
      if (!uow) throw new Error("Per archiviare una scadenza serve un'unita' di lavoro");
      await setDeadlineArchived(uow, deadlineId, archived);
    },
  };
}

/** I mandati di gestione non archiviati (di un immobile, piu' quelli per tutti gli immobili), con lo stato dalla data di fine scritta. */
export const listMandates = (db: Db, today = todayInItaly(), assetId?: string) => mandateCases.listMandates({ repo: drizzleMandateRepository(db), others: mandateCollaborators(db) }, today, assetId);

/** Registra un mandato (gestore dalla rubrica, date, compenso come testo, documento) e la scadenza di fine collegata. */
export const createMandate = (uow: UnitOfWork, raw: unknown) => mandateCases.createMandate({ repo: drizzleMandateRepository(uow.tx), others: mandateCollaborators(uow.tx, uow), audit: uow.audit }, raw);

export const setMandateArchived = (uow: UnitOfWork, id: string, archived: boolean) =>
  mandateCases.setMandateArchived({ repo: drizzleMandateRepository(uow.tx), others: mandateCollaborators(uow.tx, uow), audit: uow.audit }, id, archived);

/** Il rendiconto di un immobile: canoni, incassi e pagamenti registrati, interventi, codici, adempimenti, mandati e punti da verificare. */
export async function getManagementStatement(db: Db, args: { assetId: string; from: string; to: string }, today = todayInItaly()) {
  const { assetId, from, to } = args;
  const [assets, lettingList, entries, works, mandates] = await Promise.all([listAssets(db), listLettings(db, { assetId, includeEnded: true }, today), economyEntries(db, from, to, assetId), listWorks(db, { assetId, includeClosed: true }), listMandates(db, today, assetId)]);
  const details = (await Promise.all(lettingList.map((l) => getLettingDetail(db, l.id, today)))).filter((d) => d !== null);
  const line = (e: (typeof entries)[number]): LedgerLine => ({ area: e.area, date: e.date, label: e.label, amountCents: e.amountCents });
  const statement = buildStatement({
    from,
    to,
    today,
    contracts: details.map((d) => ({ id: d.id, title: d.title, type: d.type, status: d.status, startsOn: d.startsOn, endsOn: d.endsOn, monthlyRentCents: d.monthlyRentCents, managerName: d.managerName, registered: d.registeredOn !== null || d.registrationNumber !== null })),
    rents: details.flatMap((d) => d.rents.map((r) => ({ lettingId: d.id, lettingTitle: d.title, dueOn: r.dueOn, amountCents: r.amountCents, paidCents: r.paidCents, paidOn: r.paidOn, hasProof: r.receipts.length > 0 ? r.receipts.every((x) => x.documentId !== null) : r.documentId !== null }))),
    receipts: entries.filter((e) => e.area === "lettings").map(line),
    payments: entries.filter((e) => COST_AREAS.includes(e.area)).map(line),
    works: works.map((w) => ({ id: w.id, title: w.title, status: w.status, scheduledOn: w.scheduledOn, startedOn: w.startedOn, completedOn: w.completedOn, supplierName: w.supplierName, acceptedQuotesCents: w.acceptedQuotesCents, invoicedCents: w.invoicedCents, paidCents: w.paidCents })),
    codes: details.flatMap((d) => d.codes.map((c) => ({ lettingTitle: d.title, label: c.label, value: c.value, issuer: c.issuer, validUntil: c.validUntil, state: c.state }))),
    reports: details.flatMap((d) => d.reports.map((r) => ({ lettingTitle: d.title, title: r.title, period: r.period, dueOn: r.dueOn, doneOn: r.doneOn, hasProof: r.documentId !== null }))),
    mandates,
  });
  return { ...statement, assetId, assetName: assets.find((a) => a.id === assetId)?.name ?? null };
}

/** Il calendario dei prossimi giorni (90 per default): scadenze, canoni, adempimenti, fine contratti, codici, garanzie, lavori e occupazioni. */
export async function getManagementCalendar(db: Db, args: { assetId?: string; days?: number } = {}, today = todayInItaly()) {
  const days = args.days ?? 90;
  const [occurrences, lettingList, warranties, works] = await Promise.all([
    listOccurrences(db, "open", { ...(args.assetId && { assetId: args.assetId }) }, today),
    listLettings(db, { assetId: args.assetId, includeEnded: false }, today),
    listWarranties(db, { assetId: args.assetId }, today),
    listWorks(db, { assetId: args.assetId }),
  ]);
  const details = (await Promise.all(lettingList.map((l) => getLettingDetail(db, l.id, today)))).filter((d) => d !== null);
  return buildCalendar({
    today,
    days,
    occurrences: occurrences.map((o) => ({ id: o.id, deadlineId: o.deadlineId, dueOn: o.dueOn, title: o.title, assetName: o.assetName })),
    lettings: details.map((d) => ({
      id: d.id,
      title: d.title,
      type: d.type,
      status: d.status,
      assetName: d.assetName,
      startsOn: d.startsOn,
      endsOn: d.endsOn,
      deadlineId: d.deadlineId,
      rents: d.rents.map((r) => ({ dueOn: r.dueOn, amountCents: r.amountCents, paidCents: r.paidCents, deadlineId: r.deadlineId })),
      reports: d.reports.map((r) => ({ title: r.title, dueOn: r.dueOn, doneOn: r.doneOn, deadlineId: r.deadlineId })),
      codes: d.codes.map((c) => ({ label: c.label, validUntil: c.validUntil })),
    })),
    warranties: warranties.filter((w) => !w.archived).map((w) => ({ id: w.id, title: w.title, assetName: w.assetName, endsOn: w.endsOn, deadlineId: w.deadlineId })),
    works: works.map((w) => ({ id: w.id, title: w.title, assetName: w.assetName, status: w.status, scheduledOn: w.scheduledOn })),
  });
}
