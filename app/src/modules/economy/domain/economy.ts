/**
 * Quadro economico: somma, per immobile e per anno, dei pagamenti e degli incassi che il proprietario ha REGISTRATO negli altri
 * moduli (tributi, assicurazioni, manutenzioni, condominio, locazioni), per data del pagamento. Non e' un bilancio, non e'
 * una dichiarazione e non dice cosa sia deducibile o dovuto. Nessuna ripartizione inventata: un premio di una polizza su piu'
 * immobili resta nella riga «non ripartito».
 */

export const COST_AREAS = ["taxes", "insurance", "maintenance", "condominium"] as const;
export type CostArea = (typeof COST_AREAS)[number];
export const INCOME_AREAS = ["lettings"] as const;
export type IncomeArea = (typeof INCOME_AREAS)[number];
export type Area = CostArea | IncomeArea;

export type LedgerEntry = {
  area: Area;
  /** Identificativo della riga di origine (pagamento, fattura, premio, rata, canone). */
  id: string;
  /** Identificativo della scheda a cui rimanda (voce di tributo, intervento, polizza, condominio, locazione). */
  refId: string;
  date: string;
  amountCents: number;
  /** Il documento di prova (ricevuta, fattura quietanzata...): nullo se non collegato, assente se il modulo di origine non ha un campo per la prova. */
  documentId?: string | null;
  /** Solo per i pagamenti di tributi: natura scelta dal proprietario e sanzioni/interessi da lui dichiarati (nulli = non dichiarati). */
  taxDetail?: { kind: "ordinary" | "late_payment_correction" | "other"; penaltyCents: number | null; interestCents: number | null };
  /** Il bene a cui il movimento si riferisce; nullo se non e' attribuibile a uno solo. */
  assetId: string | null;
  label: string;
};

export type EconomyRow = {
  /** Nullo per la riga «non ripartito». */
  assetId: string | null;
  assetName: string;
  costs: Record<CostArea, number>;
  costsTotal: number;
  income: number;
  /** Incassi meno pagamenti registrati. Puo' essere negativo. */
  balance: number;
};

const isCost = (area: Area): area is CostArea => (COST_AREAS as readonly string[]).includes(area);
const emptyCosts = (): Record<CostArea, number> => ({ taxes: 0, insurance: 0, maintenance: 0, condominium: 0 });

function finish(row: Omit<EconomyRow, "costsTotal" | "balance">): EconomyRow {
  const costsTotal = COST_AREAS.reduce((n, a) => n + row.costs[a], 0);
  return { ...row, costsTotal, balance: row.income - costsTotal };
}

/** Una riga per ogni bene (anche a zero), piu' la riga «non ripartito» se serve; i totali sommano tutte le righe. */
export function buildEconomy(entries: LedgerEntry[], assets: { id: string; name: string }[]): { rows: EconomyRow[]; totals: EconomyRow } {
  const acc = new Map<string | null, { costs: Record<CostArea, number>; income: number }>(assets.map((a) => [a.id, { costs: emptyCosts(), income: 0 }]));
  for (const entry of entries) {
    const key = entry.assetId !== null && acc.has(entry.assetId) ? entry.assetId : null;
    const row = acc.get(key) ?? { costs: emptyCosts(), income: 0 };
    acc.set(key, row);
    if (isCost(entry.area)) row.costs[entry.area] += entry.amountCents;
    else row.income += entry.amountCents;
  }
  const names = new Map(assets.map((a) => [a.id, a.name]));
  const rows = [...acc.entries()]
    .filter(([key]) => key !== null)
    .map(([key, v]) => finish({ assetId: key, assetName: names.get(key!) ?? "", ...v }))
    .sort((a, b) => a.assetName.localeCompare(b.assetName, "it"));
  const unassigned = acc.get(null);
  if (unassigned) rows.push(finish({ assetId: null, assetName: "", ...unassigned }));
  const totals = finish({
    assetId: null,
    assetName: "",
    costs: Object.fromEntries(COST_AREAS.map((a) => [a, rows.reduce((n, r) => n + r.costs[a], 0)])) as Record<CostArea, number>,
    income: rows.reduce((n, r) => n + r.income, 0),
  });
  return { rows, totals };
}
