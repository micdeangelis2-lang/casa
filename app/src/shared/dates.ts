/**
 * Date di calendario come stringhe AAAA-MM-GG, calcolate in UTC: nessun fuso orario, nessun orario legale.
 * Scadenze e validita' ragionano in giorni; l'istante non conta.
 */
export type CalendarUnit = "days" | "months" | "years";

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

export const isCalendarDate = (value: string): boolean => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
};

const toParts = (date: string) => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return { y, m, d };
};
const fromUtc = (d: Date) => `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const toUtc = (date: string) => {
  const { y, m, d } = toParts(date);
  return new Date(Date.UTC(y, m - 1, d));
};

export const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Costruisce una data portando il giorno all'ultimo del mese se non esiste (es. 29 febbraio in un anno non bisestile). */
export function clampedDate(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month)}-${pad(Math.min(day, daysInMonth(year, month)))}`;
}

export function addDays(date: string, days: number): string {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

/** Somma mesi mantenendo il giorno quando possibile, altrimenti l'ultimo del mese (31 gennaio + 1 mese = 28/29 febbraio). */
export function addMonths(date: string, months: number): string {
  const { y, m, d } = toParts(date);
  const index = y * 12 + (m - 1) + months;
  return clampedDate(Math.floor(index / 12), (index % 12 + 12) % 12 + 1, d);
}

export function addUnit(date: string, unit: CalendarUnit, amount: number): string {
  if (unit === "days") return addDays(date, amount);
  return addMonths(date, unit === "months" ? amount : amount * 12);
}

/** Differenza in giorni (b - a). */
export const daysBetween = (a: string, b: string): number => Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);

/** 0 = domenica ... 6 = sabato. */
export const weekday = (date: string): number => toUtc(date).getUTCDay();

export const yearOf = (date: string): number => toParts(date).y;

export type PeriodState = "undated" | "upcoming" | "active" | "expiring" | "expired";

/**
 * Dove cade oggi rispetto a un periodo scritto dall'utente (garanzia, polizza): non ancora iniziato, in corso,
 * in scadenza (entro `soonDays` dalla fine) o finito. Senza data di fine non si puo' dire. Dice solo cosa risulta dalle date.
 */
export function periodState(period: { startsOn: string | null; endsOn: string | null }, today: string, soonDays = 60): PeriodState {
  if (!period.endsOn) return period.startsOn && period.startsOn > today ? "upcoming" : "undated";
  if (period.endsOn < today) return "expired";
  if (period.startsOn && period.startsOn > today) return "upcoming";
  return daysBetween(today, period.endsOn) <= soonDays ? "expiring" : "active";
}
