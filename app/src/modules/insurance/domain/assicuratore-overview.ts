import type { PeriodState } from "@/shared/dates";

/**
 * Riepilogo «polizze per bene» e «scheda sinistro»: confronti puri su cio' che il proprietario ha registrato.
 * Non interpretano le condizioni di polizza: dicono solo quali polizze risultano collegate a quale bene e quali dati mancano.
 */

/** Polizza gia' arricchita con le garanzie copiate a mano (nessuna interpretazione). */
export type OverviewPolicy = {
  id: string;
  title: string;
  insurerName: string | null;
  policyNumber: string | null;
  startsOn: string | null;
  endsOn: string | null;
  state: PeriodState;
  premiumCents: number | null;
  assetIds: string[];
  openClaims: number;
  coverages: { title: string; sumInsuredCents: number | null; deductibleCents: number | null }[];
};

/**
 * Cosa risulta per un bene dalle polizze registrate:
 * - `none`: nessuna polizza (non archiviata) collegata al bene;
 * - `notCurrent`: ci sono polizze collegate, ma tutte scadute o non ancora iniziate alla data di oggi;
 * - `current`: almeno una polizza collegata e in corso (anche in scadenza o senza data di fine).
 */
export type AssetPolicyStatus = "none" | "notCurrent" | "current";

export type AssetPolicyRow = { assetId: string; assetName: string; status: AssetPolicyStatus; policies: OverviewPolicy[] };

export const isPolicyCurrent = (state: PeriodState): boolean => state === "active" || state === "expiring" || state === "undated";

export function groupPoliciesByAsset(assets: { id: string; name: string }[], policies: OverviewPolicy[]): AssetPolicyRow[] {
  return assets.map((a) => {
    const linked = policies.filter((p) => p.assetIds.includes(a.id)).sort((x, y) => (x.endsOn ?? "9999-12-31").localeCompare(y.endsOn ?? "9999-12-31") || x.title.localeCompare(y.title, "it"));
    const status: AssetPolicyStatus = linked.length === 0 ? "none" : linked.some((p) => isPolicyCurrent(p.state)) ? "current" : "notCurrent";
    return { assetId: a.id, assetName: a.name, status, policies: linked };
  });
}

/** Polizze non archiviate che non risultano collegate ad alcun bene (dalle sole registrazioni). */
export const policiesWithoutAsset = (policies: OverviewPolicy[]): OverviewPolicy[] => policies.filter((p) => p.assetIds.length === 0);

/** Una voce dell'elenco «cosa risulta presente nell'app» della scheda sinistro. */
export type SheetCheckKey = "reportedOn" | "claimNumber" | "description" | "policyNumber" | "coverages" | "claimed" | "entries" | "documents" | "photos" | "works" | "adjuster";
export type SheetCheck = { key: SheetCheckKey; present: boolean; count?: number };

export function sheetChecks(c: {
  reportedOn: string | null;
  claimNumber: string | null;
  description: string | null;
  claimedCents: number | null;
  adjusterName: string | null;
  policyNumber: string | null;
  coverageCount: number;
  entryCount: number;
  documentCount: number;
  photoCount: number;
  workCount: number;
}): SheetCheck[] {
  return [
    { key: "reportedOn", present: c.reportedOn !== null },
    { key: "claimNumber", present: c.claimNumber !== null },
    { key: "description", present: c.description !== null && c.description.trim() !== "" },
    { key: "policyNumber", present: c.policyNumber !== null },
    { key: "coverages", present: c.coverageCount > 0, count: c.coverageCount },
    { key: "claimed", present: c.claimedCents !== null },
    { key: "adjuster", present: c.adjusterName !== null },
    { key: "entries", present: c.entryCount > 0, count: c.entryCount },
    { key: "documents", present: c.documentCount > 0, count: c.documentCount },
    { key: "photos", present: c.photoCount > 0, count: c.photoCount },
    { key: "works", present: c.workCount > 0, count: c.workCount },
  ];
}
