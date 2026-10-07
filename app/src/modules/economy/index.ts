/**
 * Interfaccia pubblica del modulo Quadro economico: legge i movimenti registrati dagli altri moduli (tributi, assicurazioni,
 * manutenzioni, condominio, locazioni) e li somma per immobile e per anno. Sola lettura; non scrive nulla e non ha un
 * proprio schema. Non e' un bilancio ne' una dichiarazione.
 */
import type { Db } from "@/platform/db/types";
import { getAssetDetail, listAssets } from "@/modules/assets";
import { condominiumLedger } from "@/modules/condominium";
import { getPolicyDetail, insuranceLedger, listPolicies } from "@/modules/insurance";
import { getLettingDetail, isContractType, lettingLedger, listLettings } from "@/modules/lettings";
import { maintenanceLedger } from "@/modules/maintenance";
import { adviserSummary, taxLedger, todayInItaly } from "@/modules/taxes";
import type { LedgerEntry } from "./domain/economy";
import * as useCases from "./application/use-cases";
import * as dossierCases from "./application/dossier";

export { COST_AREAS, type Area, type CostArea, type EconomyRow, type LedgerEntry } from "./domain/economy";
export type { EconomyView } from "./application/use-cases";

function collaborators(db: Db): useCases.EconomyCollaborators {
  return {
    assets: async () => (await listAssets(db)).map((a) => ({ id: a.id, name: a.name })),
    async ledger(from, to) {
      const [taxes, insurance, maintenance, condominium, lettings] = await Promise.all([taxLedger(db, from, to), insuranceLedger(db, from, to), maintenanceLedger(db, from, to), condominiumLedger(db, from, to), lettingLedger(db, from, to)]);
      const tag = <A extends LedgerEntry["area"]>(area: A, rows: Omit<LedgerEntry, "area">[]): LedgerEntry[] => rows.map((r) => ({ ...r, area }));
      return [...tag("taxes", taxes), ...tag("insurance", insurance), ...tag("maintenance", maintenance), ...tag("condominium", condominium), ...tag("lettings", lettings)];
    },
  };
}

export const getEconomy = (db: Db, year: number, assetId?: string) => useCases.getEconomy(collaborators(db), year, assetId);
export const economyYears = (db: Db) => useCases.economyYears(collaborators(db));
export const economyCsv = useCases.economyCsv;
/** I movimenti registrati con data tra due date (estremi inclusi), da tutti i moduli; con `assetId` solo quelli di quel bene. */
export async function economyEntries(db: Db, from: string, to: string, assetId?: string): Promise<LedgerEntry[]> {
  const all = await collaborators(db).ledger(from, to);
  return assetId ? all.filter((e) => e.assetId === assetId) : all;
}

export type { DossierView, DossierMovement } from "./application/dossier";
export { type DossierGap, type GapKind, type ProofState } from "./domain/dossier";
export const dossierCsv = dossierCases.dossierCsv;

function dossierCollaborators(db: Db): dossierCases.DossierCollaborators {
  return {
    ledger: (from, to) => collaborators(db).ledger(from, to),
    async assets() {
      const list = await listAssets(db);
      const details = await Promise.all(list.map((a) => getAssetDetail(db, a.id)));
      return list.map((a, i) => ({
        id: a.id,
        name: a.name,
        address: a.address,
        territoryLabel: a.territoryLabel,
        rights: (details[i]?.rights ?? []).map((r) => ({ holderName: r.holder.displayName, rightType: r.rightType, quotaNumerator: r.quotaNumerator, quotaDenominator: r.quotaDenominator, validFrom: r.validFrom, validTo: r.validTo })),
        cadastral: (details[i]?.cadastral ?? []).map((c) => ({ sheet: c.sheet, parcel: c.parcel, subunit: c.subunit, category: c.cadastralCategory, cadastralClass: c.cadastralClass, consistency: c.consistency, incomeCents: c.incomeCents, validFrom: c.validFrom, validTo: c.validTo })),
      }));
    },
    async lettings() {
      const list = await listLettings(db, { includeEnded: true });
      const details = await Promise.all(list.map((l) => getLettingDetail(db, l.id)));
      return list.flatMap((l, i) => {
        const d = details[i];
        if (!d) return [];
        return [{ id: l.id, assetId: l.assetId, assetName: l.assetName, title: l.title, type: l.type, isContract: isContractType(l.type), status: l.status, startsOn: l.startsOn, endsOn: l.endsOn, people: l.people, registeredOn: l.registeredOn, registrationNumber: l.registrationNumber, registrationOffice: l.registrationOffice, hasContractDocument: l.contractDocumentId !== null, rents: d.rents.map((r) => ({ dueOn: r.dueOn, amountCents: r.amountCents, paidCents: r.paidCents })) }];
      });
    },
    async premiums() {
      const policies = await listPolicies(db, true);
      const details = await Promise.all(policies.map((p) => getPolicyDetail(db, p.id)));
      return policies.flatMap((p, i) => (details[i]?.premiums ?? []).map((x) => ({ id: x.id, policyId: p.id, policyTitle: p.title, assetName: p.assets.length === 1 ? p.assets[0]!.name : null, dueOn: x.dueOn, amountCents: x.amountCents, paidOn: x.paidOn })));
    },
    taxSummary: (year) => adviserSummary(db, year),
  };
}

/** Dossier annuale per il commercialista: dati registrati e dati mancanti, senza calcoli fiscali. */
export const getDossier = (db: Db, year: number, today = todayInItaly()) => dossierCases.getDossier(dossierCollaborators(db), year, today);
