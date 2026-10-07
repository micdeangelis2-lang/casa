import { describe, expect, it } from "vitest";
import { closeSchema, obligationSchema, obligationState, paymentSchema, summarize, taxTypeSchema } from "@/modules/taxes/domain/taxes";

const TODAY = "2026-06-15";
const open = (over: Partial<{ dueOn: string | null; expectedCents: number | null }> = {}) => ({ status: "open" as const, dueOn: null, expectedCents: 45_000, ...over });

describe("stato di una voce di tributo (solo dai dati registrati)", () => {
  it("senza pagamenti la voce risulta senza pagamenti registrati", () => {
    expect(obligationState(open(), 0, TODAY)).toEqual({ state: "unpaid", remainingCents: 45_000, overdue: false });
  });

  it("un pagamento minore dell'atteso e' parziale, uno uguale o maggiore raggiunge l'importo indicato", () => {
    expect(obligationState(open(), 20_000, TODAY)).toMatchObject({ state: "partial", remainingCents: 25_000 });
    expect(obligationState(open(), 45_000, TODAY)).toMatchObject({ state: "settled", remainingCents: 0 });
    expect(obligationState(open(), 50_000, TODAY)).toMatchObject({ state: "settled", remainingCents: -5_000 });
  });

  it("senza importo atteso i pagamenti si registrano ma la voce non risulta mai 'pagata'", () => {
    expect(obligationState(open({ expectedCents: null }), 10_000, TODAY)).toEqual({ state: "recorded", remainingCents: null, overdue: false });
    expect(obligationState(open({ expectedCents: null }), 0, TODAY)).toMatchObject({ state: "unpaid", remainingCents: null });
  });

  it("la data superata segnala solo le voci senza pagamento completo", () => {
    expect(obligationState(open({ dueOn: "2026-06-14" }), 0, TODAY).overdue).toBe(true);
    expect(obligationState(open({ dueOn: "2026-06-14" }), 10_000, TODAY).overdue).toBe(true);
    expect(obligationState(open({ dueOn: "2026-06-15" }), 0, TODAY).overdue).toBe(false);
    expect(obligationState(open({ dueOn: "2026-06-14" }), 45_000, TODAY).overdue).toBe(false);
    expect(obligationState(open({ dueOn: "2026-06-14", expectedCents: null }), 10_000, TODAY).overdue).toBe(false);
  });

  it("una voce chiusa dal proprietario non e' mai in ritardo", () => {
    expect(obligationState({ status: "closed", dueOn: "2020-01-01", expectedCents: 100 }, 0, TODAY)).toMatchObject({ state: "closed", overdue: false });
  });
});

describe("totali", () => {
  it("non inventa gli importi mancanti: li conta a parte", () => {
    const totals = summarize([
      { expectedCents: 45_000, paidCents: 45_000, state: "settled", overdue: false },
      { expectedCents: 10_000, paidCents: 0, state: "unpaid", overdue: true },
      { expectedCents: null, paidCents: 5_000, state: "recorded", overdue: false },
      { expectedCents: null, paidCents: 0, state: "closed", overdue: false },
    ]);
    expect(totals).toEqual({ expectedCents: 55_000, paidCents: 50_000, withoutExpected: 1, open: 2, overdue: 1 });
  });
});

describe("campi dei moduli", () => {
  it("i tipi di tributo hanno un nome e un genere", () => {
    expect(taxTypeSchema.safeParse({ name: " " }).success).toBe(false);
    expect(taxTypeSchema.parse({ name: "  Imposta locale ", territoryId: "" })).toMatchObject({ name: "Imposta locale", kind: "tax", territoryId: undefined });
    expect(taxTypeSchema.safeParse({ name: "X", kind: "inventato" }).success).toBe(false);
  });

  it("una voce accetta importi all'italiana e un anno intero ragionevole", () => {
    const base = { assetId: "6b0d0bde-7e1a-4a0e-9a6b-8a8f0d4a2c11", taxTypeId: "6b0d0bde-7e1a-4a0e-9a6b-8a8f0d4a2c12" };
    expect(obligationSchema.parse({ ...base, year: "2026", expected: "1.234,56" })).toMatchObject({ year: 2026, expected: 123_456, askAdviser: false });
    expect(obligationSchema.parse({ ...base, year: 2026, expected: "" }).expected).toBeUndefined();
    expect(obligationSchema.safeParse({ ...base, year: "abc" }).success).toBe(false);
    expect(obligationSchema.safeParse({ ...base, year: 1800 }).success).toBe(false);
    expect(obligationSchema.safeParse({ ...base, year: 2026, expected: "molto" }).success).toBe(false);
  });

  it("un pagamento deve avere data e importo maggiore di zero", () => {
    expect(paymentSchema.parse({ paidOn: "2026-06-01", amount: "150,00" })).toMatchObject({ amount: 15_000, method: "other" });
    expect(paymentSchema.safeParse({ paidOn: "2026-06-01", amount: "0" })).toMatchObject({ success: false });
    expect(paymentSchema.safeParse({ paidOn: "ieri", amount: "10" }).success).toBe(false);
    expect(paymentSchema.safeParse({ paidOn: "2026-06-01", amount: "10", method: "baratto" }).success).toBe(false);
  });

  it("chiudere una voce richiede un motivo", () => {
    expect(closeSchema.safeParse({ reason: " " }).success).toBe(false);
    expect(closeSchema.parse({ reason: "Indicazione del consulente" })).toMatchObject({ reason: "Indicazione del consulente" });
  });
});
