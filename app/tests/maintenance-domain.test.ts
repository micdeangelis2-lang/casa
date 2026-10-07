import { describe, expect, it } from "vitest";
import { periodState } from "@/shared/dates";
import { inspectionPlanSchema, invoiceSchema, progressSchema, quoteExpired, quoteSchema, warrantySchema, workFinancials, workSchema } from "@/modules/maintenance/domain/maintenance";

const ASSET = "6b0d0bde-7e1a-4a0e-9a6b-8a8f0d4a2c11";

describe("importi di un intervento (solo dai dati inseriti)", () => {
  it("somma i preventivi accettati, il fatturato e il pagato; non valuta nulla", () => {
    const f = workFinancials({
      budgetCents: 500_000,
      quotes: [
        { status: "accepted", amountCents: 420_000 },
        { status: "rejected", amountCents: 380_000 },
        { status: "received", amountCents: 450_000 },
      ],
      invoices: [
        { amountCents: 200_000, paidOn: "2026-05-01" },
        { amountCents: 100_000, paidOn: null },
      ],
    });
    expect(f).toEqual({ budgetCents: 500_000, acceptedQuotesCents: 420_000, invoicedCents: 300_000, paidCents: 200_000, unpaidInvoicesCents: 100_000 });
    expect(workFinancials({ budgetCents: null, quotes: [], invoices: [] })).toEqual({ budgetCents: null, acceptedQuotesCents: 0, invoicedCents: 0, paidCents: 0, unpaidInvoicesCents: 0 });
  });

  it("un preventivo e' scaduto solo se non ancora deciso e con la validita' passata", () => {
    expect(quoteExpired({ status: "received", validUntil: "2026-05-01" }, "2026-06-01")).toBe(true);
    expect(quoteExpired({ status: "received", validUntil: "2026-06-01" }, "2026-06-01")).toBe(false);
    expect(quoteExpired({ status: "accepted", validUntil: "2026-05-01" }, "2026-06-01")).toBe(false);
    expect(quoteExpired({ status: "received", validUntil: null }, "2026-06-01")).toBe(false);
  });
});

describe("periodi (garanzie e polizze)", () => {
  it("risulta futura, attiva, in scadenza o scaduta in base alle sole date indicate", () => {
    const today = "2026-06-15";
    expect(periodState({ startsOn: "2026-07-01", endsOn: "2028-07-01" }, today)).toBe("upcoming");
    expect(periodState({ startsOn: "2026-01-01", endsOn: "2028-01-01" }, today)).toBe("active");
    expect(periodState({ startsOn: null, endsOn: "2026-08-01" }, today)).toBe("expiring");
    expect(periodState({ startsOn: null, endsOn: "2026-06-15" }, today)).toBe("expiring");
    expect(periodState({ startsOn: null, endsOn: "2026-06-14" }, today)).toBe("expired");
    expect(periodState({ startsOn: "2026-01-01", endsOn: null }, today)).toBe("undated");
    expect(periodState({ startsOn: "2026-07-01", endsOn: null }, today)).toBe("upcoming");
  });
});

describe("campi dei moduli", () => {
  it("un intervento richiede immobile e titolo e non ammette una fine prima dell'inizio", () => {
    expect(workSchema.safeParse({ assetId: ASSET, title: " " }).success).toBe(false);
    expect(workSchema.parse({ assetId: ASSET, title: "Sostituzione caldaia", budget: "3.500,00" })).toMatchObject({ status: "planned", budget: 350_000, createDeadline: false });
    expect(workSchema.safeParse({ assetId: ASSET, title: "X", startedOn: "2026-05-10", completedOn: "2026-05-01" })).toMatchObject({ success: false });
    expect(workSchema.safeParse({ assetId: ASSET, title: "X", status: "finito" }).success).toBe(false);
  });

  it("preventivi e fatture accettano importi all'italiana e rifiutano il resto", () => {
    expect(quoteSchema.parse({ amount: "1.250,50" }).amount).toBe(125_050);
    expect(quoteSchema.safeParse({ amount: "tanto" }).success).toBe(false);
    expect(quoteSchema.safeParse({ amount: "10", status: "boh" }).success).toBe(false);
    expect(invoiceSchema.parse({ issuedOn: "2026-05-01", amount: "99" })).toMatchObject({ amount: 9_900 });
    expect(invoiceSchema.safeParse({ amount: "99" }).success).toBe(false);
  });

  it("l'avanzamento ha una nota e una percentuale facoltativa tra 0 e 100", () => {
    expect(progressSchema.parse({ note: "Ponteggio montato", percent: "" }).percent).toBeUndefined();
    expect(progressSchema.parse({ note: "Metà lavoro", percent: "50" }).percent).toBe(50);
    expect(progressSchema.safeParse({ note: "x", percent: "120" }).success).toBe(false);
    expect(progressSchema.safeParse({ note: "x", percent: "2,5" }).success).toBe(false);
    expect(progressSchema.safeParse({ note: " " }).success).toBe(false);
  });

  it("una garanzia ha la fine; un piano di ispezione ha un intervallo in mesi ragionevole", () => {
    expect(warrantySchema.safeParse({ assetId: ASSET, title: "Garanzia caldaia" }).success).toBe(false);
    expect(warrantySchema.safeParse({ assetId: ASSET, title: "G", startsOn: "2026-06-01", endsOn: "2026-05-01" }).success).toBe(false);
    expect(warrantySchema.parse({ assetId: ASSET, title: "G", endsOn: "2028-05-01" })).toMatchObject({ createDeadline: false });
    expect(inspectionPlanSchema.parse({ assetId: ASSET, title: "Controllo impianto", intervalMonths: "12", firstDueOn: "2026-09-01" }).intervalMonths).toBe(12);
    expect(inspectionPlanSchema.safeParse({ assetId: ASSET, title: "x", intervalMonths: "0", firstDueOn: "2026-09-01" }).success).toBe(false);
    expect(inspectionPlanSchema.safeParse({ assetId: ASSET, title: "x", intervalMonths: "121", firstDueOn: "2026-09-01" }).success).toBe(false);
  });
});
