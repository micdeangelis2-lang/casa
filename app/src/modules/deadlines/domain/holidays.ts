import { addDays, clampedDate } from "@/shared/dates";

/** Pasqua (domenica) nel calendario gregoriano: algoritmo di Meeus/Jones/Butcher. */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return clampedDate(year, month, day);
}

/** Regola di festivo, cosi' com'e' nei dati. */
export type HolidayRule = { kind: "fixed"; month: number; day: number } | { kind: "easter_offset"; offsetDays: number };

/** Le date di festivo di un anno per un insieme di regole. */
export function holidaysOfYear(year: number, rules: readonly HolidayRule[]): string[] {
  const easter = easterSunday(year);
  return rules.map((r) => (r.kind === "fixed" ? clampedDate(year, r.month, r.day) : addDays(easter, r.offsetDays)));
}

/** Insieme dei festivi che coprono un intervallo di anni (per decidere i giorni lavorativi). */
export function holidaySet(fromYear: number, toYear: number, rules: readonly HolidayRule[]): Set<string> {
  const out = new Set<string>();
  for (let y = fromYear; y <= toYear; y += 1) for (const d of holidaysOfYear(y, rules)) out.add(d);
  return out;
}
