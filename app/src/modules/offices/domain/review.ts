/**
 * Controllo periodico delle regole (funzioni pure). Nessuna soglia e' scritta qui: l'eta' massima in mesi la sceglie il
 * proprietario. Il risultato dice solo se una regola risulta verificata e quando e' stata controllata l'ultima volta:
 * non dice se la regola si applica a un immobile.
 */
import type { RuleVerification } from "@/modules/rules";

/** Valori proposti dall'interfaccia per l'eta' massima dell'ultimo controllo (scelta dell'utente, non un termine di legge). */
export const REVIEW_MONTHS_CHOICES = [3, 6, 12, 24] as const;
export const DEFAULT_REVIEW_MONTHS = 12;

export type ReviewState =
  /** Bozza o «da verificare»: non risulta ancora verificata. */
  | "unverified"
  /** Verificata, ma nessuna data di controllo registrata. */
  | "no_check_date"
  /** Verificata, ultimo controllo piu' vecchio dell'eta' scelta. */
  | "stale"
  /** Verificata, ultimo controllo entro l'eta' scelta. */
  | "recent";

/** Ordine di attenzione: prima cio' che risulta non verificato. */
export const REVIEW_STATE_ORDER: readonly ReviewState[] = ["unverified", "no_check_date", "stale", "recent"];

/** Sottrae `months` mesi a una data AAAA-MM-GG (il giorno si riduce all'ultimo del mese se serve). */
export function monthsBefore(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const index = y * 12 + (m - 1) - months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}

export function classifyReview(args: { status: RuleVerification; lastCheckedOn: string | null; today: string; maxAgeMonths: number }): ReviewState {
  if (args.status === "draft" || args.status === "to_verify") return "unverified";
  if (!args.lastCheckedOn) return "no_check_date";
  return args.lastCheckedOn < monthsBefore(args.today, args.maxAgeMonths) ? "stale" : "recent";
}

export function countByState<T extends { state: ReviewState }>(rows: readonly T[]): Record<ReviewState, number> {
  const counts: Record<ReviewState, number> = { unverified: 0, no_check_date: 0, stale: 0, recent: 0 };
  for (const r of rows) counts[r.state] += 1;
  return counts;
}
