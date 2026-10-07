import { addMonths } from "@/shared/dates";

/**
 * Millesimi con quattro decimali, come numeri interi (diecimillesimi): niente errori di virgola mobile.
 * 48,25 millesimi = 482500.
 */
export const MILLI_SCALE = 10_000;

/**
 * "48,25" o "48.25" -> 482500. La virgola e' sempre il decimale; con soli punti, un punto seguito da esattamente tre cifre
 * ("1.000") e' il separatore delle migliaia all'italiana. Null se non e' un numero valido tra 0 e 1000 millesimi
 * (un valore piu' grande e' quasi certamente una virgola sbagliata: meglio rifiutarlo che indovinare).
 */
export function parseMilli(raw: string): number | null {
  const s = raw.trim().replace(/\s/g, "");
  let normalized: string;
  if (s.includes(",")) normalized = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) normalized = s.replace(/\./g, "");
  else normalized = s;
  if (!/^\d{1,7}(\.\d{1,4})?$/.test(normalized)) return null;
  const [whole, frac = ""] = normalized.split(".");
  const value = Number(whole) * MILLI_SCALE + Number(frac.padEnd(4, "0"));
  return value <= 1000 * MILLI_SCALE ? value : null;
}

/** 482500 -> "48,25" (senza zeri inutili). */
export function formatMilli(value: number): string {
  const whole = Math.trunc(value / MILLI_SCALE);
  const frac = String(value % MILLI_SCALE).padStart(4, "0").replace(/0+$/, "");
  return frac === "" ? String(whole) : `${whole},${frac}`;
}

/** Il valore numeric di Postgres ("48.2500") come intero. */
export const milliFromDb = (value: string | null): number | null => {
  if (value === null || value === undefined) return null;
  const [whole = "0", frac = ""] = String(value).split(".");
  return Number(whole) * MILLI_SCALE + Number(frac.padEnd(4, "0").slice(0, 4));
};
export const milliToDb = (value: number | null): string | null => (value === null ? null : `${Math.trunc(value / MILLI_SCALE)}.${String(value % MILLI_SCALE).padStart(4, "0")}`);

/** Somma di una tabella millesimale e di quanto si discosta da 1000 (di solito il totale e' 1000, ma non si impone). */
export function tableTotals(values: number[]): { total: number; differsFromThousand: boolean } {
  const total = values.reduce((n, v) => n + v, 0);
  return { total, differsFromThousand: total !== 1000 * MILLI_SCALE };
}

/**
 * Ripartisce un importo in centesimi in proporzione ai millesimi con il metodo del resto maggiore: la somma delle parti
 * e' SEMPRE uguale all'importo (nessun centesimo perso o inventato). Con pesi tutti nulli restituisce zeri.
 */
export function allocateByShares(totalCents: number, weights: number[]): number[] {
  const sum = weights.reduce((n, w) => n + w, 0);
  if (sum === 0) return weights.map(() => 0);
  const exact = weights.map((w) => (BigInt(totalCents) * BigInt(w)) / BigInt(sum));
  const remainders = weights.map((w, i) => ({ i, rem: (BigInt(totalCents) * BigInt(w)) % BigInt(sum) }));
  let left = BigInt(totalCents) - exact.reduce((n, v) => n + v, 0n);
  remainders.sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1));
  const result = exact.map(Number);
  for (const { i } of remainders) {
    if (left <= 0n) break;
    result[i]! += 1;
    left -= 1n;
  }
  return result;
}

export type BudgetScopeName = "owner_only" | "building";

/**
 * Parti di un importo che spettano alle unita' del proprietario, una per ciascun peso (millesimi della tabella).
 * - `owner_only`: l'importo e' gia' quello da ripartire tra le sole unita' del proprietario (comportamento di sempre).
 * - `building`: l'importo e' del PALAZZO. Il totale del palazzo e' la somma dei millesimi del proprietario e degli altri
 *   registrati, ma non meno di 1000: il resto non attribuito al proprietario e' di altri e non gli viene addebitato.
 * In entrambi i casi il resto si assegna col metodo del resto maggiore: nessun centesimo perso o inventato.
 */
export function allocateOwnerParts(totalCents: number, weights: number[], scope: BudgetScopeName, othersMilli: number): number[] {
  if (scope === "owner_only") return allocateByShares(totalCents, weights);
  const own = weights.reduce((n, w) => n + w, 0);
  const building = Math.max(own + othersMilli, 1000 * MILLI_SCALE);
  return allocateByShares(totalCents, [...weights, building - own]).slice(0, weights.length);
}

/** Divide un importo in N rate: uguali, con i centesimi in piu' sulle prime. La somma e' sempre l'importo. */
export function splitEvenly(totalCents: number, count: number): number[] {
  const base = Math.floor(totalCents / count);
  const extra = totalCents - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}

/** Date di scadenza di N rate: la prima, poi ogni `everyMonths` mesi (calcolate dalla prima, senza deriva di fine mese). */
export const installmentDates = (firstDueOn: string, count: number, everyMonths: number): string[] => Array.from({ length: count }, (_, i) => addMonths(firstDueOn, i * everyMonths));

export type VoteCheck = {
  recordedTotal: number | null;
  /** Vero se i favorevoli raggiungono la soglia scritta dal proprietario; null se manca un dato. */
  forReachesThreshold: boolean | null;
  /** Una frase neutra se esito e numeri non tornano; altrimenti null. L'app non dice se una delibera e' valida. */
  attention: string | null;
};

/**
 * Confronta i voti REGISTRATI con la soglia che ha scritto il proprietario. Non conosce le maggioranze di legge e non
 * giudica la validita' di una delibera: segnala solo se i numeri inseriti e l'esito scelto sembrano incoerenti,
 * invitando a ricontrollare il verbale con l'amministratore o un professionista.
 */
export function checkVotes(r: { outcome: string; votesFor: number | null; votesAgainst: number | null; votesAbstain: number | null; threshold: number | null }): VoteCheck {
  const parts = [r.votesFor, r.votesAgainst, r.votesAbstain].filter((v): v is number => v !== null);
  const recordedTotal = parts.length > 0 ? parts.reduce((n, v) => n + v, 0) : null;
  const reaches = r.votesFor !== null && r.threshold !== null ? r.votesFor >= r.threshold : null;
  let attention: string | null = null;
  if (reaches === false && r.outcome === "approved") {
    attention = "I voti favorevoli registrati sono inferiori alla soglia che hai indicato, ma l'esito segnato è «approvata»: ricontrolla il verbale con l'amministratore o un professionista.";
  } else if (reaches === true && r.outcome === "rejected") {
    attention = "I voti favorevoli registrati raggiungono la soglia che hai indicato, ma l'esito segnato è «respinta»: ricontrolla il verbale con l'amministratore o un professionista.";
  } else if (recordedTotal !== null && recordedTotal > 1000 * MILLI_SCALE) {
    attention = "La somma dei millesimi dei voti registrati supera 1000: ricontrolla i numeri inseriti.";
  }
  return { recordedTotal, forReachesThreshold: reaches, attention };
}
