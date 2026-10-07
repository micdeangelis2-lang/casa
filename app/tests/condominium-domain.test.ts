import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { allocateByShares, checkVotes, formatMilli, installmentDates, milliFromDb, milliToDb, parseMilli, splitEvenly, tableTotals } from "@/modules/condominium/domain/millesimi";
import { budgetSchema, claimSchema, installmentPlanSchema, resolutionSchema } from "@/modules/condominium/domain/condominium";
import { formatCents, parseEuroToCents } from "@/shared/money";

describe("millesimi", () => {
  it("legge e scrive i millesimi come interi, senza virgola mobile", () => {
    expect(parseMilli("48,25")).toBe(482500);
    expect(parseMilli("48.25")).toBe(482500);
    expect(parseMilli("1.000")).toBe(10_000_000);
    expect(parseMilli("0,0001")).toBe(1);
    expect(parseMilli("")).toBeNull();
    expect(parseMilli("abc")).toBeNull();
    expect(parseMilli("1,23456")).toBeNull();
    expect(parseMilli("1000,0001")).toBeNull();
    expect(parseMilli("48.250")).toBeNull();
    expect(parseMilli("-3")).toBeNull();
    expect(formatMilli(482500)).toBe("48,25");
    expect(formatMilli(10_000_000)).toBe("1000");
    expect(formatMilli(1)).toBe("0,0001");
    expect(milliFromDb("48.2500")).toBe(482500);
    expect(milliToDb(482500)).toBe("48.2500");
    expect(milliFromDb(milliToDb(123456789)!)).toBe(123456789);
  });

  it("la somma di una tabella si confronta con 1000 senza imporla", () => {
    expect(tableTotals([5_000_000, 5_000_000])).toEqual({ total: 10_000_000, differsFromThousand: false });
    expect(tableTotals([5_000_000, 4_999_999])).toMatchObject({ differsFromThousand: true });
  });

  it("proprieta': la ripartizione non perde ne' inventa centesimi e segue i millesimi", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2_000_000_000 }), fc.array(fc.integer({ min: 0, max: 10_000_000 }), { minLength: 1, maxLength: 40 }), (total, weights) => {
        const parts = allocateByShares(total, weights);
        expect(parts).toHaveLength(weights.length);
        if (weights.every((w) => w === 0)) expect(parts.every((p) => p === 0)).toBe(true);
        else {
          expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
          weights.forEach((w, i) => {
            const exact = (total * w) / weights.reduce((a, b) => a + b, 0);
            expect(Math.abs(parts[i]! - exact)).toBeLessThan(1 + 1e-6);
            if (w === 0) expect(parts[i]).toBe(0);
          });
        }
      }),
      { numRuns: 300 },
    );
  });

  it("un esempio concreto: 100,00 euro su tre unita' uguali fa 33,34 + 33,33 + 33,33", () => {
    expect(allocateByShares(10000, [1, 1, 1])).toEqual([3334, 3333, 3333]);
    expect(allocateByShares(10000, [333, 333, 334])).toEqual([3330, 3330, 3340]);
    expect(allocateByShares(100, [0, 0])).toEqual([0, 0]);
  });

  it("proprieta': le rate sommano l'importo e differiscono al massimo di un centesimo", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000_000 }), fc.integer({ min: 1, max: 60 }), (total, count) => {
        const parts = splitEvenly(total, count);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
        expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1);
        expect([...parts].sort((a, b) => b - a)).toEqual(parts);
      }),
      { numRuns: 200 },
    );
  });

  it("le date delle rate si calcolano dalla prima, senza deriva a fine mese", () => {
    expect(installmentDates("2026-01-31", 4, 1)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(installmentDates("2026-03-15", 3, 3)).toEqual(["2026-03-15", "2026-06-15", "2026-09-15"]);
  });
});

describe("controllo dei voti registrati", () => {
  const base = { outcome: "approved", votesFor: 6_000_000, votesAgainst: 2_000_000, votesAbstain: 1_000_000, threshold: 5_000_000 };
  it("non giudica la validita': segnala solo numeri ed esito che non tornano rispetto alla soglia scritta dall'utente", () => {
    expect(checkVotes(base)).toMatchObject({ forReachesThreshold: true, attention: null, recordedTotal: 9_000_000 });
    expect(checkVotes({ ...base, votesFor: 4_000_000 }).attention).toContain("inferiori alla soglia");
    expect(checkVotes({ ...base, outcome: "rejected" }).attention).toContain("«respinta»");
    expect(checkVotes({ ...base, outcome: "rejected", votesFor: 4_000_000 }).attention).toBeNull();
    expect(checkVotes({ ...base, votesFor: 9_000_000, votesAgainst: 2_000_000 }).attention).toContain("supera 1000");
    expect(checkVotes({ outcome: "approved", votesFor: null, votesAgainst: null, votesAbstain: null, threshold: 5_000_000 })).toEqual({ recordedTotal: null, forReachesThreshold: null, attention: null });
    expect(JSON.stringify(checkVotes({ ...base, votesFor: 4_000_000 }))).not.toMatch(/valid|nulla|illegitt/i);
  });
});

describe("importi", () => {
  it("legge e scrive i centesimi", () => {
    expect(parseEuroToCents("1.234,56")).toBe(123456);
    expect(parseEuroToCents("€ 99")).toBe(9900);
    expect(parseEuroToCents("1,234,56")).toBeNull();
    expect(parseEuroToCents("50.000")).toBe(5_000_000);
    expect(parseEuroToCents("1.234.567,89")).toBe(123456789);
    expect(parseEuroToCents("1234.5")).toBe(123450);
    expect(parseEuroToCents("12.34")).toBe(1234);
    expect(formatCents(123456)).toBe("1.234,56");
    expect(formatCents(1234567)).toBe("12.345,67");
  });
});

describe("dati dei moduli del condominio", () => {
  const errors = (schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } } }, v: unknown) => {
    const r = schema.safeParse(v);
    return r.success ? {} : Object.fromEntries(r.error!.issues.map((i) => [i.path.join("."), i.message]));
  };
  it("preventivo, piano rate, delibera e segnalazione", () => {
    expect(budgetSchema.safeParse({ kind: "ordinary", title: "Preventivo", total: "12.000,50" })).toMatchObject({ success: true, data: { total: 1200050 } });
    expect(errors(budgetSchema, { kind: "ordinary", title: "x", total: "abc" })).toHaveProperty("total");
    expect(errors(budgetSchema, { kind: "boh", title: "", total: "" })).toMatchObject({ kind: expect.any(String), title: expect.any(String), total: expect.any(String) });
    expect(errors(installmentPlanSchema, { count: 0, firstDueOn: "2026-01-01", everyMonths: 1 })).toHaveProperty("count");
    expect(installmentPlanSchema.safeParse({ count: "4", firstDueOn: "2026-01-31", everyMonths: "3" })).toMatchObject({ success: true, data: { count: 4, everyMonths: 3, createDeadlines: false } });
    expect(resolutionSchema.safeParse({ title: "Approvazione", outcome: "approved", votesFor: "600", threshold: "500" })).toMatchObject({ success: true, data: { votesFor: 6_000_000, threshold: 5_000_000 } });
    expect(errors(resolutionSchema, { title: "x", votesFor: "abc" })).toHaveProperty("votesFor");
    expect(errors(claimSchema, { kind: "x", title: " " })).toMatchObject({ kind: expect.any(String), title: expect.any(String) });
  });
});
