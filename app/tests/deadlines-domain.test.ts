import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { addDays, addMonths, addUnit, clampedDate, daysBetween, isCalendarDate, weekday } from "@/shared/dates";
import { calcSchema, occurrencesBetween, shiftToBusinessDay, type Calc } from "@/shared/calc";
import { easterSunday, holidaySet, holidaysOfYear, type HolidayRule } from "@/modules/deadlines/domain/holidays";
import { deadlineInputSchema, notificationText, pendingStep } from "@/modules/deadlines/domain/deadline";

const NATIONAL: HolidayRule[] = [
  { kind: "fixed", month: 1, day: 1 },
  { kind: "fixed", month: 4, day: 25 },
  { kind: "fixed", month: 5, day: 1 },
  { kind: "fixed", month: 12, day: 25 },
  { kind: "easter_offset", offsetDays: 1 },
];

describe("date di calendario", () => {
  it("somma giorni e mesi senza errori di fine mese o anni bisestili", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2026-11-30", 3)).toBe("2027-02-28");
    expect(addMonths("2026-03-15", -4)).toBe("2025-11-15");
    expect(addUnit("2024-02-29", "years", 1)).toBe("2025-02-28");
    expect(clampedDate(2026, 2, 29)).toBe("2026-02-28");
    expect(daysBetween("2026-01-01", "2026-12-31")).toBe(364);
    expect(isCalendarDate("2026-02-29")).toBe(false);
    expect(isCalendarDate("2024-02-29")).toBe(true);
  });

  it("proprieta': aggiungere e togliere gli stessi giorni riporta alla data di partenza", () => {
    fc.assert(
      fc.property(fc.date({ min: new Date("1990-01-01"), max: new Date("2090-01-01"), noInvalidDate: true }), fc.integer({ min: -4000, max: 4000 }), (d, n) => {
        const date = d.toISOString().slice(0, 10);
        expect(addDays(addDays(date, n), -n)).toBe(date);
        expect(daysBetween(date, addDays(date, n))).toBe(n);
        expect(isCalendarDate(addMonths(date, n))).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});

describe("festivi e giorni lavorativi", () => {
  it("calcola la Pasqua", () => {
    expect(easterSunday(2024)).toBe("2024-03-31");
    expect(easterSunday(2025)).toBe("2025-04-20");
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(easterSunday(2027)).toBe("2027-03-28");
    expect(holidaysOfYear(2026, NATIONAL)).toContain("2026-04-06");
  });

  it("sposta al primo giorno lavorativo successivo e non tocca gli altri giorni", () => {
    const holidays = holidaySet(2026, 2027, NATIONAL);
    expect(shiftToBusinessDay("2026-06-13", holidays)).toBe("2026-06-15"); // sabato -> lunedi'
    expect(shiftToBusinessDay("2026-06-14", holidays)).toBe("2026-06-15"); // domenica
    expect(shiftToBusinessDay("2026-06-16", holidays)).toBe("2026-06-16"); // martedi'
    expect(shiftToBusinessDay("2026-04-06", holidays)).toBe("2026-04-07"); // lunedi' dell'Angelo
    expect(shiftToBusinessDay("2026-12-25", holidays)).toBe("2026-12-28"); // Natale (venerdi') + sabato + domenica
    expect(shiftToBusinessDay("2027-01-01", holidays)).toBe("2027-01-04");
  });

  it("proprieta': il risultato non e' mai prima della data, mai nel weekend, mai un festivo", () => {
    const holidays = holidaySet(1990, 2095, NATIONAL);
    fc.assert(
      fc.property(fc.date({ min: new Date("1991-01-01"), max: new Date("2090-01-01"), noInvalidDate: true }), (d) => {
        const date = d.toISOString().slice(0, 10);
        const shifted = shiftToBusinessDay(date, holidays);
        expect(shifted >= date).toBe(true);
        expect([0, 6]).not.toContain(weekday(shifted));
        expect(holidays.has(shifted)).toBe(false);
        expect(daysBetween(date, shifted)).toBeLessThanOrEqual(5);
        if (shifted !== date) expect([0, 6].includes(weekday(date)) || holidays.has(date)).toBe(true);
      }),
      { numRuns: 400 },
    );
  });
});

describe("regole di calcolo", () => {
  const ctx = { attributes: { data_contratto: "2026-03-31", testo: "non una data" } as Record<string, string> };

  it("fixed_annual: ogni anno nello stesso giorno, anche il 29 febbraio", () => {
    const c: Calc = { type: "fixed_annual", month: 6, day: 16 };
    expect(occurrencesBetween(c, ctx, "2026-01-01", "2028-12-31")).toEqual(["2026-06-16", "2027-06-16", "2028-06-16"]);
    expect(occurrencesBetween(c, ctx, "2026-06-17", "2027-06-15")).toEqual([]);
    expect(occurrencesBetween({ type: "fixed_annual", month: 2, day: 29 }, ctx, "2026-01-01", "2028-12-31")).toEqual(["2026-02-28", "2027-02-28", "2028-02-29"]);
  });

  it("relative_to: ancora piu' scostamento; senza un'ancora valida non produce date", () => {
    const c: Calc = { type: "relative_to", anchor: { kind: "attribute", name: "data_contratto" }, offset: { unit: "days", amount: 30 } };
    expect(occurrencesBetween(c, ctx, "2026-01-01", "2026-12-31")).toEqual(["2026-04-30"]);
    expect(occurrencesBetween(c, ctx, "2026-05-01", "2026-12-31")).toEqual([]);
    expect(occurrencesBetween({ ...c, anchor: { kind: "attribute", name: "testo" } }, ctx, "2026-01-01", "2026-12-31")).toEqual([]);
    expect(occurrencesBetween({ ...c, anchor: { kind: "attribute", name: "assente" } }, ctx, "2026-01-01", "2026-12-31")).toEqual([]);
    expect(occurrencesBetween({ type: "relative_to", anchor: { kind: "date", date: "2026-01-31" }, offset: { unit: "months", amount: -2 } }, ctx, "2025-01-01", "2026-12-31")).toEqual(["2025-11-30"]);
  });

  it("recurring: dall'ancora, senza derivare (31 gennaio resta fine mese)", () => {
    const monthly: Calc = { type: "recurring", anchor: { kind: "date", date: "2026-01-31" }, every: { unit: "months", amount: 1 } };
    expect(occurrencesBetween(monthly, ctx, "2026-01-01", "2026-05-31")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
    expect(occurrencesBetween(monthly, ctx, "2026-03-01", "2026-03-31")).toEqual(["2026-03-31"]);
    const yearly: Calc = { type: "recurring", anchor: { kind: "date", date: "2024-02-29" }, every: { unit: "years", amount: 1 } };
    expect(occurrencesBetween(yearly, ctx, "2024-01-01", "2028-12-31")).toEqual(["2024-02-29", "2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29"]);
  });

  it("manual: nessuna data calcolata", () => {
    expect(occurrencesBetween({ type: "manual" }, ctx, "2000-01-01", "2100-01-01")).toEqual([]);
  });

  it("lo schema rifiuta calcoli senza senso", () => {
    const ok = (c: unknown) => calcSchema.safeParse(c).success;
    expect(ok({ type: "fixed_annual", month: 13, day: 1 })).toBe(false);
    expect(ok({ type: "fixed_annual", month: 6, day: 32 })).toBe(false);
    expect(ok({ type: "recurring", anchor: { kind: "date", date: "2026-02-30" }, every: { unit: "days", amount: 5 } })).toBe(false);
    expect(ok({ type: "recurring", anchor: { kind: "date", date: "2026-02-01" }, every: { unit: "days", amount: 0 } })).toBe(false);
    expect(ok({ type: "relative_to", anchor: { kind: "attribute", name: "Anno" }, offset: { unit: "days", amount: 1 } })).toBe(false);
    expect(ok({ type: "manual" })).toBe(true);
  });
});

describe("avvisi", () => {
  const leads = [30, 7, 1, 0];

  it("prima della scadenza vale il passo piu' vicino gia' raggiunto", () => {
    expect(pendingStep("2026-07-31", "2026-06-01", leads)).toBeNull(); // mancano 60 giorni: nessun passo raggiunto
    expect(pendingStep("2026-07-31", "2026-07-01", leads)).toBe(30);
    expect(pendingStep("2026-07-31", "2026-07-10", leads)).toBe(30);
    expect(pendingStep("2026-07-31", "2026-07-24", leads)).toBe(7);
    expect(pendingStep("2026-07-31", "2026-07-30", leads)).toBe(1);
    expect(pendingStep("2026-07-31", "2026-07-31", leads)).toBe(0);
  });

  it("dopo la scadenza e' escalation: negativo, con passi crescenti e poi ogni 30 giorni", () => {
    expect(pendingStep("2026-07-31", "2026-08-01", leads)).toBe(-1);
    expect(pendingStep("2026-07-31", "2026-08-03", leads)).toBe(-3);
    expect(pendingStep("2026-07-31", "2026-08-05", leads)).toBe(-3);
    expect(pendingStep("2026-07-31", "2026-08-07", leads)).toBe(-7);
    expect(pendingStep("2026-07-31", "2026-08-14", leads)).toBe(-14);
    expect(pendingStep("2026-07-31", "2026-08-29", leads)).toBe(-14);
    expect(pendingStep("2026-07-31", "2026-08-30", leads)).toBe(-30);
    expect(pendingStep("2026-07-31", "2026-08-29", [])).toBe(-14);
    expect(pendingStep("2026-07-31", "2026-08-31", leads)).toBe(-30);
    expect(pendingStep("2026-07-31", "2026-11-05", leads)).toBe(-90);
  });

  it("proprieta': il passo non e' mai nel futuro e non scende con il passare dei giorni", () => {
    fc.assert(
      fc.property(fc.integer({ min: -200, max: 200 }), fc.array(fc.integer({ min: 0, max: 120 }), { maxLength: 6 }), (offset, leadDays) => {
        const due = "2026-07-31";
        const today = addDays(due, offset);
        const step = pendingStep(due, today, leadDays);
        if (step !== null && step >= 0) expect(daysBetween(today, due)).toBeLessThanOrEqual(step);
        if (step !== null && step < 0) expect(-step).toBeLessThanOrEqual(daysBetween(due, today));
        if (offset > 0) expect(step).not.toBeNull();
        const next = pendingStep(due, addDays(today, 1), leadDays);
        if (offset > 0 && step !== null && next !== null) expect(next).toBeLessThanOrEqual(step);
      }),
      { numRuns: 300 },
    );
  });

  it("i testi sono neutri e riportano data e bene", () => {
    expect(notificationText({ title: "Pagamento", assetName: "Casa", dueOn: "2026-07-31", lead: 7 })).toEqual({ title: "Tra 7 giorni: Pagamento", body: "Scadenza il 31/07/2026 – Casa." });
    expect(notificationText({ title: "Pagamento", assetName: null, dueOn: "2026-07-31", lead: 0 }).title).toBe("Oggi: Pagamento");
    expect(notificationText({ title: "Pagamento", assetName: null, dueOn: "2026-07-31", lead: -1 }).title).toBe("In ritardo da 1 giorno: Pagamento");
    expect(notificationText({ title: "Pagamento", assetName: null, dueOn: "2026-07-31", lead: -14 }).body).toContain("Controlla");
  });
});

describe("dati di una scadenza", () => {
  const base = { title: "Revisione impianto", category: "technical", level: "national", calc: { type: "fixed_annual", month: 3, day: 1 } };
  it("accetta il minimo, ordina i preavvisi e toglie i doppioni", () => {
    const parsed = deadlineInputSchema.safeParse({ ...base, leadDays: [1, 30, 7, 7, 0] });
    expect(parsed.success && parsed.data).toMatchObject({ priority: "normal", shiftToBusinessDay: false, leadDays: [30, 7, 1, 0] });
  });
  it("una scadenza manuale vuole la data; i preavvisi non sono negativi", () => {
    const errors = (v: unknown) => {
      const r = deadlineInputSchema.safeParse(v);
      return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.join("."), i.message]));
    };
    expect(errors({ ...base, calc: { type: "manual" } })).toHaveProperty("firstDueOn");
    expect(errors({ ...base, calc: { type: "manual" }, firstDueOn: "2026-09-01" })).toEqual({});
    expect(errors({ ...base, leadDays: [-1] })).toHaveProperty(["leadDays.0"]);
    expect(errors({ ...base, title: " " })).toHaveProperty("title");
    expect(errors({ ...base, category: "boh" })).toHaveProperty("category");
  });
});
