import { csvDocument, type CsvCell } from "@/shared/csv";
import { COST_AREAS, buildEconomy, type EconomyRow, type LedgerEntry } from "../domain/economy";

export interface EconomyCollaborators {
  /** Tutti i movimenti registrati con data tra `from` e `to` (estremi inclusi), da tutti i moduli. */
  ledger(from: string, to: string): Promise<LedgerEntry[]>;
  assets(): Promise<{ id: string; name: string }[]>;
}

export type EconomyView = ReturnType<typeof buildEconomy> & { year: number; entries: (LedgerEntry & { assetName: string | null })[]; assetId: string | null };

const bounds = (year: number) => ({ from: `${year}-01-01`, to: `${year}-12-31` });

/** Il quadro di un anno; con `assetId` solo i movimenti di quel bene (quelli non ripartiti restano fuori). */
export async function getEconomy(deps: EconomyCollaborators, year: number, assetId?: string): Promise<EconomyView> {
  const { from, to } = bounds(year);
  const [all, assets] = await Promise.all([deps.ledger(from, to), deps.assets()]);
  const entries = assetId ? all.filter((e) => e.assetId === assetId) : all;
  const names = new Map(assets.map((a) => [a.id, a.name]));
  const scope = assetId ? assets.filter((a) => a.id === assetId) : assets;
  return {
    ...buildEconomy(entries, scope),
    year,
    assetId: assetId ?? null,
    entries: entries.map((e) => ({ ...e, assetName: e.assetId ? (names.get(e.assetId) ?? null) : null })).sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label, "it")),
  };
}

/** Gli anni per cui c'e' almeno un movimento registrato, dal piu' recente. */
export async function economyYears(deps: EconomyCollaborators): Promise<number[]> {
  const entries = await deps.ledger("1990-01-01", "2100-12-31");
  return [...new Set(entries.map((e) => Number(e.date.slice(0, 4))))].sort((a, b) => b - a);
}

const euros = (cents: number): number => cents / 100;

const AREA_LABEL = { taxes: "Tributi", insurance: "Assicurazioni", maintenance: "Manutenzioni", condominium: "Condominio", lettings: "Locazioni (incassi)" } as const;

/** Il quadro in CSV (UTF-8 con BOM, «;», virgola decimale): una tabella per immobile e l'elenco dei movimenti. */
export function economyCsv(view: EconomyView, unassignedLabel: string): string {
  const rowLine = (r: EconomyRow): CsvCell[] => [r.assetId === null && r.assetName === "" ? unassignedLabel : r.assetName, ...COST_AREAS.map((a) => euros(r.costs[a])), euros(r.costsTotal), euros(r.income), euros(r.balance)];
  const rows: CsvCell[][] = [
    [`Quadro economico ${view.year}`],
    ["Somma dei pagamenti e degli incassi registrati con data nell'anno: non e' un bilancio ne' una dichiarazione."],
    [],
    ["Immobile", ...COST_AREAS.map((a) => `${AREA_LABEL[a]} (€)`), "Pagamenti totali (€)", "Incassi da locazioni (€)", "Differenza (€)"],
    ...view.rows.map(rowLine),
    rowLine({ ...view.totals, assetName: "Totale" }),
    [],
    ["Movimenti"],
    ["Data", "Area", "Descrizione", "Immobile", "Importo (€)"],
    ...view.entries.map((e): CsvCell[] => [e.date, AREA_LABEL[e.area], e.label, e.assetName ?? unassignedLabel, euros(e.amountCents)]),
  ];
  return csvDocument(rows);
}
