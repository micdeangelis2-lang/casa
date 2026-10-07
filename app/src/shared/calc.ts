import { z } from "./zod";
import { addDays, addUnit, clampedDate, isCalendarDate, weekday, yearOf } from "./dates";

/**
 * Regole di calcolo delle scadenze (sezione 5.4): sempre RELATIVE a un'ancora, mai date assolute del futuro.
 *  - fixed_annual: ogni anno nello stesso giorno e mese;
 *  - relative_to: un'ancora piu' uno scostamento (es. 30 giorni dopo la data del contratto);
 *  - recurring: ogni N giorni/mesi/anni a partire da un'ancora;
 *  - manual: nessun calcolo, le date le inserisce il proprietario.
 */
const unit = z.enum(["days", "months", "years"], { error: "Scegli l'unità" });
const amount = z.number({ error: "Inserisci un numero" }).int("Inserisci un numero intero").min(1, "Deve essere almeno 1").max(1200, "Valore troppo grande");

export const anchorSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({ kind: z.literal("date"), date: z.string().refine(isCalendarDate, "Data non valida") }),
    z.object({ kind: z.literal("attribute"), name: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, "Nome della caratteristica non valido") }),
  ],
  { error: "Scegli l'ancora" },
);
export type Anchor = z.infer<typeof anchorSchema>;

export const calcSchema = z.discriminatedUnion(
  "type",
  [
    z.object({
      type: z.literal("fixed_annual"),
      month: z.number().int().min(1, "Mese non valido").max(12, "Mese non valido"),
      day: z.number().int().min(1, "Giorno non valido").max(31, "Giorno non valido"),
    }),
    z.object({ type: z.literal("relative_to"), anchor: anchorSchema, offset: z.object({ unit, amount: z.number().int().min(-1200).max(1200) }) }),
    z.object({ type: z.literal("recurring"), anchor: anchorSchema, every: z.object({ unit, amount }) }),
    z.object({ type: z.literal("manual") }),
  ],
  { error: "Scegli come si calcola la scadenza" },
);
export type Calc = z.infer<typeof calcSchema>;

/** Contesto per risolvere le ancore: le caratteristiche tecniche del bene che contengono date (testo AAAA-MM-GG). */
export type CalcContext = { attributes: Record<string, string | number | boolean> };

function anchorDate(anchor: Anchor, ctx: CalcContext): string | null {
  if (anchor.kind === "date") return anchor.date;
  const value = ctx.attributes[anchor.name];
  return typeof value === "string" && isCalendarDate(value) ? value : null;
}

/**
 * Date che la regola produce nell'intervallo [from, to] (estremi inclusi), PRIMA dell'eventuale spostamento al giorno
 * lavorativo. Un'ancora mancante o non valida non produce date (non e' un errore: la scadenza non e' ancora calcolabile).
 */
export function occurrencesBetween(calc: Calc, ctx: CalcContext, from: string, to: string): string[] {
  const within = (d: string) => d >= from && d <= to;
  switch (calc.type) {
    case "manual":
      return [];
    case "fixed_annual": {
      const out: string[] = [];
      for (let year = yearOf(from); year <= yearOf(to); year += 1) {
        const date = clampedDate(year, calc.month, calc.day);
        if (within(date)) out.push(date);
      }
      return out;
    }
    case "relative_to": {
      const anchor = anchorDate(calc.anchor, ctx);
      if (!anchor) return [];
      const date = addUnit(anchor, calc.offset.unit, calc.offset.amount);
      return within(date) ? [date] : [];
    }
    case "recurring": {
      const anchor = anchorDate(calc.anchor, ctx);
      if (!anchor) return [];
      const out: string[] = [];
      // Ogni data si calcola dall'ancora (anchor + k * passo), non da quella precedente: un 31 gennaio non deriva verso il 28.
      for (let k = 0; k < 20_000; k += 1) {
        const date = addUnit(anchor, calc.every.unit, calc.every.amount * k);
        if (date > to) break;
        if (date >= from) out.push(date);
      }
      return out;
    }
  }
}

/** Sposta al primo giorno lavorativo successivo (sabato, domenica e festivi esclusi). Gli altri giorni restano com'erano. */
export function shiftToBusinessDay(date: string, holidays: ReadonlySet<string>): string {
  let result = date;
  for (let guard = 0; guard < 14; guard += 1) {
    const day = weekday(result);
    if (day !== 0 && day !== 6 && !holidays.has(result)) return result;
    result = addDays(result, 1);
  }
  return result;
}

