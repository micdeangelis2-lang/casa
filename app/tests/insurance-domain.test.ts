import { describe, expect, it } from "vitest";
import { claimEntrySchema, claimSchema, coverageSchema, isClaimOpen, policySchema, premiumOverdue, premiumPaidSchema, premiumSchema } from "@/modules/insurance/domain/insurance";

const ID = "6b0d0bde-7e1a-4a0e-9a6b-8a8f0d4a2c11";

describe("polizze", () => {
  it("una polizza ha un titolo; le date devono essere in ordine; gli immobili sono facoltativi e senza doppioni gestiti dal caso d'uso", () => {
    expect(policySchema.safeParse({ title: " " }).success).toBe(false);
    expect(policySchema.parse({ title: "Polizza casa", premium: "480,50", assetIds: [ID] })).toMatchObject({ premium: 48_050, assetIds: [ID], createDeadline: false });
    expect(policySchema.parse({ title: "Polizza casa" }).assetIds).toEqual([]);
    expect(policySchema.safeParse({ title: "P", startsOn: "2026-06-01", endsOn: "2026-05-01" })).toMatchObject({ success: false });
    expect(policySchema.safeParse({ title: "P", assetIds: ["non-un-id"] }).success).toBe(false);
    expect(policySchema.safeParse({ title: "P", premium: "molto" }).success).toBe(false);
  });

  it("le garanzie copiate dalla polizza hanno importi facoltativi", () => {
    expect(coverageSchema.parse({ title: "Incendio", sumInsured: "200.000", deductible: "250" })).toMatchObject({ sumInsured: 20_000_000, deductible: 25_000 });
    expect(coverageSchema.parse({ title: "Responsabilità civile" })).toEqual({ title: "Responsabilità civile" });
    expect(coverageSchema.safeParse({ title: " " }).success).toBe(false);
  });
});

describe("premi", () => {
  it("hanno scadenza e importo; il pagamento ha una data", () => {
    expect(premiumSchema.parse({ dueOn: "2026-07-01", amount: "480,50" })).toMatchObject({ amount: 48_050, createDeadline: false });
    expect(premiumSchema.safeParse({ amount: "10" }).success).toBe(false);
    expect(premiumPaidSchema.safeParse({}).success).toBe(false);
    expect(premiumPaidSchema.parse({ paidOn: "2026-07-02" })).toMatchObject({ paidOn: "2026-07-02" });
  });

  it("un premio e' in ritardo solo se non pagato e con la scadenza passata", () => {
    expect(premiumOverdue({ paidOn: null, dueOn: "2026-06-14" }, "2026-06-15")).toBe(true);
    expect(premiumOverdue({ paidOn: null, dueOn: "2026-06-15" }, "2026-06-15")).toBe(false);
    expect(premiumOverdue({ paidOn: "2026-06-10", dueOn: "2026-06-01" }, "2026-06-15")).toBe(false);
  });
});

describe("sinistri", () => {
  it("richiedono polizza, titolo e data dell'evento; la denuncia non puo' precedere l'evento", () => {
    expect(claimSchema.safeParse({ title: "Infiltrazione", occurredOn: "2026-05-01" }).success).toBe(false);
    expect(claimSchema.parse({ policyId: ID, title: "Infiltrazione", occurredOn: "2026-05-01", claimed: "1.200,00" })).toMatchObject({ status: "open", claimed: 120_000 });
    expect(claimSchema.safeParse({ policyId: ID, title: "X", occurredOn: "2026-05-10", reportedOn: "2026-05-01" })).toMatchObject({ success: false });
    expect(claimSchema.safeParse({ policyId: ID, title: "X", occurredOn: "2026-05-10", status: "pagato" }).success).toBe(false);
  });

  it("e' aperto finche' non e' liquidato o chiuso", () => {
    expect(["open", "reported", "in_review"].map((s) => isClaimOpen(s as never))).toEqual([true, true, true]);
    expect(["settled", "closed"].map((s) => isClaimOpen(s as never))).toEqual([false, false]);
  });

  it("le comunicazioni hanno un riepilogo e un tipo", () => {
    expect(claimEntrySchema.parse({ summary: "Inviata la denuncia", direction: "sent" })).toMatchObject({ direction: "sent" });
    expect(claimEntrySchema.parse({ summary: "Nota" }).direction).toBe("note");
    expect(claimEntrySchema.safeParse({ summary: " " }).success).toBe(false);
    expect(claimEntrySchema.safeParse({ summary: "x", direction: "telepatia" }).success).toBe(false);
  });
});
