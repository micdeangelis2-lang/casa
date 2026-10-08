/**
 * Interfaccia pubblica del modulo Importazione: legge un file CSV (contatti, immobili, scadenze, canoni, voci e pagamenti di tributo, polizze), ne mostra un'anteprima senza scrivere
 * e, su richiesta, importa le righe pronte in una sola transazione. Le regole di validazione sono quelle dei rispettivi moduli.
 */
import type { Db } from "@/platform/db/types";
import type { AuditActor } from "@/platform/audit";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { failGeneral, type Result } from "@/shared/result";
import { createAsset, listAssets, validateAssetInput } from "@/modules/assets";
import { createDeadline, listOccurrences, validateDeadlineInput } from "@/modules/deadlines";
import { createParty, listParties, validatePartyInput } from "@/modules/directory";
import { createPolicy, listPolicies, validatePolicyInput } from "@/modules/insurance";
import { addRent, getLettingDetail, listLettings, recordRentPayment, validateRentInput, validateRentPaymentInput } from "@/modules/lettings";
import { createObligation, getObligationDetail, listObligations, listTaxTypes, recordPayment, validateObligationInput, validateTaxPaymentInput } from "@/modules/taxes";
import { searchTerritories } from "@/modules/territory";
import type { UnitOfWork } from "@/platform/db/unit-of-work";
import { IMPORT_KINDS, type ImportKind } from "./domain/columns";
import type { ImportFailure, ImportLabels, ImportPorts, ImportPreview } from "./application/ports";
import * as cases from "./application/run";

export type { ImportKind } from "./domain/columns";
export { CSV_LIMITS } from "./domain/csv-reader";
export type { ImportCounts, ImportFailure, ImportLabels, ImportPreview, RowOutcome, RowStatus } from "./application/ports";

export const isImportKind = (value: unknown): value is ImportKind => IMPORT_KINDS.includes(value as ImportKind);

function readPorts(db: Db): Omit<ImportPorts, "create"> {
  return {
    existingParties: async () => (await listParties(db, { includeArchived: true })).map((p) => ({ id: p.id, displayName: p.displayName, taxCode: p.taxCode, email: p.email })),
    validateParty: validatePartyInput,
    existingAssets: async () => (await listAssets(db, { includeArchived: true })).map((a) => ({ id: a.id, name: a.name, address: a.address })),
    validateAsset: validateAssetInput,
    findMunicipalities: async (name) => (await searchTerritories(db, { query: name, kinds: ["municipality"], limit: 100 })).map((t) => ({ id: t.id, name: t.name, label: t.label })),
    existingDeadlines: async () => (await listOccurrences(db, "all", { includeArchived: true })).map((o) => ({ title: o.title, dueOn: o.dueOn, assetId: o.assetId })),
    validateDeadline: validateDeadlineInput,
    existingLettings: async () => (await listLettings(db, { includeEnded: true })).map((l) => ({ id: l.id, title: l.title })),
    rentDatesOf: async (lettingId) => ((await getLettingDetail(db, lettingId))?.rents ?? []).map((r) => r.dueOn),
    validateRent: validateRentInput,
    validateRentPayment: validateRentPaymentInput,
    existingTaxTypes: async () => (await listTaxTypes(db, true)).map((t) => ({ id: t.id, name: t.name })),
    existingObligations: async () => (await listObligations(db)).map((o) => ({ id: o.id, assetId: o.assetId, taxTypeId: o.taxTypeId, year: o.year, label: o.label, status: o.status })),
    paymentsOf: async (obligationId) => ((await getObligationDetail(db, obligationId))?.paymentList ?? []).map((p) => ({ paidOn: p.paidOn, amountCents: p.amountCents })),
    validateObligation: validateObligationInput,
    validateTaxPayment: validateTaxPaymentInput,
    existingPolicies: async () => (await listPolicies(db, true)).map((p) => ({ title: p.title, policyNumber: p.policyNumber, startsOn: p.startsOn })),
    validatePolicy: validatePolicyInput,
  };
}

/** Un canone con, se indicato, il suo incasso: due passi dello stesso modulo, nella stessa transazione. */
async function createRent(uow: UnitOfWork, payload: unknown): Promise<Result<unknown>> {
  const { lettingId, dueOn, amount, paid, paidOn } = payload as { lettingId: string; dueOn: string; amount: string; paid?: string; paidOn?: string };
  const added = await addRent(uow, lettingId, { dueOn, amount });
  if (!added.ok || paid === undefined) return added;
  const rent = (await getLettingDetail(uow.tx, lettingId))?.rents.find((r) => r.dueOn === dueOn);
  if (!rent) return failGeneral("Canone non trovato");
  return recordRentPayment(uow, rent.id, { paid, paidOn });
}

/** Scrive una riga «pronta» col modulo competente. */
function createRow(uow: UnitOfWork, owner: { displayName: string; email?: string }, kind: ImportKind, payload: unknown): Promise<Result<unknown>> {
  switch (kind) {
    case "contacts":
      return createParty(uow, payload);
    case "assets":
      return createAsset(uow, owner, payload);
    case "deadlines":
      return createDeadline(uow, payload);
    case "rents":
      return createRent(uow, payload);
    case "taxes":
      return createObligation(uow, payload);
    case "taxPayments": {
      const { obligationId, ...payment } = payload as { obligationId: string };
      return recordPayment(uow, obligationId, payment);
    }
    case "policies":
      return createPolicy(uow, payload);
  }
}

/** Anteprima del file: nessuna scrittura. */
export function previewImport(db: Db, kind: ImportKind, text: string, labels: ImportLabels): Promise<ImportPreview | ImportFailure> {
  const reads = readPorts(db);
  const ports: ImportPorts = {
    ...reads,
    create: () => Promise.reject(new Error("L'anteprima non scrive")),
  };
  return cases.previewImport(kind, text, ports, labels);
}

/** Le porte dell'importazione legate a una transazione: letture e scritture dei moduli competenti. */
export const importPorts = (uow: UnitOfWork, owner: { displayName: string; email?: string }): ImportPorts => ({
  ...readPorts(uow.tx),
  create: (kind, payload) => createRow(uow, owner, kind, payload),
});

/** Importa le righe pronte in UNA sola transazione: se una riga e' rifiutata non resta niente. */
export async function runImport(
  db: Db,
  actor: AuditActor,
  owner: { displayName: string; email?: string },
  kind: ImportKind,
  text: string,
  labels: ImportLabels,
): Promise<cases.ImportOutcome | ImportFailure> {
  const work = (uow: UnitOfWork) => cases.executeImport(kind, text, importPorts(uow, owner), labels, uow.audit);
  try {
    return await runInUnitOfWork(db, actor, work);
  } catch (error) {
    if (error instanceof cases.ImportAbort) return { ok: false, message: `${error.message} Non è stato importato nulla.` };
    throw error;
  }
}

/** Il modello CSV scaricabile per il tipo scelto. */
export const importTemplate = (kind: ImportKind) => cases.templateCsv(kind);
