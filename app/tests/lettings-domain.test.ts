import { describe, expect, it } from "vitest";
import { codeSchema, codeState, isContractType, lettingSchema, partySchema, rentDates, rentPaymentSchema, rentScheduleSchema, rentState, rentTotals, reportDoneSchema, reportSchema, reportState } from "@/modules/lettings/domain/lettings";

const ASSET = "6b0d0bde-7e1a-4a0e-9a6b-8a8f0d4a2c11";

describe("tipi di locazione", () => {
  it("il contratto di durata riguarda abitativa, transitoria e studenti; breve e ricettiva sono attivita' di soggiorno", () => {
    expect(["residential", "transitional", "student"].map((t) => isContractType(t as never))).toEqual([true, true, true]);
    expect(["short_term", "accommodation"].map((t) => isContractType(t as never))).toEqual([false, false]);
  });

  it("senza il tipo la locazione non si salva: va scelto quello reale", () => {
    expect(lettingSchema.safeParse({ assetId: ASSET, title: "Casa" })).toMatchObject({ success: false });
    expect(lettingSchema.safeParse({ assetId: ASSET, title: "Casa", type: "affitto_magico" }).success).toBe(false);
    expect(lettingSchema.parse({ assetId: ASSET, title: "Casa", type: "residential", monthlyRent: "650,00", deposit: "1.300,00" })).toMatchObject({ status: "active", monthlyRent: 65_000, deposit: 130_000, createDeadline: false });
  });

  it("le date devono essere in ordine, cauzione compresa", () => {
    expect(lettingSchema.safeParse({ assetId: ASSET, title: "x", type: "residential", startsOn: "2026-06-01", endsOn: "2026-05-01" }).success).toBe(false);
    expect(lettingSchema.safeParse({ assetId: ASSET, title: "x", type: "residential", depositReceivedOn: "2026-06-01", depositReturnedOn: "2026-05-01" }).success).toBe(false);
    expect(lettingSchema.safeParse({ assetId: ASSET, title: "x", type: "short_term", startsOn: "2026-06-01", endsOn: "2026-06-01" }).success).toBe(true);
  });
});

describe("calendario dei canoni", () => {
  it("una data al mese dalla prima, senza deriva: il 31 gennaio non diventa per sempre il 28", () => {
    expect(rentDates("2026-01-31", 4)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(rentDates("2026-11-05", 3)).toEqual(["2026-11-05", "2026-12-05", "2027-01-05"]);
  });

  it("lo stato dipende solo dai dati registrati", () => {
    const today = "2026-06-15";
    expect(rentState({ dueOn: "2026-07-01", amountCents: 50_000, paidCents: 0 }, today)).toBe("due");
    expect(rentState({ dueOn: "2026-07-01", amountCents: 50_000, paidCents: 10_000 }, today)).toBe("partial");
    expect(rentState({ dueOn: "2026-06-01", amountCents: 50_000, paidCents: 10_000 }, today)).toBe("overdue");
    expect(rentState({ dueOn: "2026-06-01", amountCents: 50_000, paidCents: 50_000 }, today)).toBe("paid");
    expect(rentState({ dueOn: "2026-06-15", amountCents: 50_000, paidCents: 0 }, today)).toBe("due");
  });

  it("i totali non contano piu' del dovuto e l'arretrato e' solo quello con scadenza passata", () => {
    const totals = rentTotals(
      [
        { dueOn: "2026-05-01", amountCents: 50_000, paidCents: 50_000 },
        { dueOn: "2026-06-01", amountCents: 50_000, paidCents: 20_000 },
        { dueOn: "2026-07-01", amountCents: 50_000, paidCents: 60_000 },
        { dueOn: "2026-08-01", amountCents: 50_000, paidCents: 0 },
      ],
      "2026-06-15",
    );
    expect(totals).toEqual({ dueCents: 200_000, paidCents: 50_000 + 20_000 + 50_000, overdueCents: 30_000 });
  });

  it("il calendario si descrive con prima scadenza, numero di mesi e importo", () => {
    expect(rentScheduleSchema.parse({ firstDueOn: "2026-07-01", months: "12", amount: "650,00" })).toMatchObject({ months: 12, amount: 65_000, createDeadlines: false });
    expect(rentScheduleSchema.safeParse({ firstDueOn: "2026-07-01", months: "0", amount: "650" }).success).toBe(false);
    expect(rentScheduleSchema.safeParse({ firstDueOn: "2026-07-01", months: "121", amount: "650" }).success).toBe(false);
    expect(rentScheduleSchema.safeParse({ firstDueOn: "2026-07-01", months: "12", amount: "tanto" }).success).toBe(false);
    expect(rentPaymentSchema.parse({ paid: "650" }).paid).toBe(65_000);
  });
});

describe("codici e adempimenti", () => {
  it("un codice ha nome e valore; la validita' e' quella scritta dal proprietario", () => {
    expect(codeSchema.safeParse({ label: " ", value: "X" }).success).toBe(false);
    expect(codeSchema.safeParse({ label: "Codice", value: "ABC", issuedOn: "2026-06-01", validUntil: "2026-05-01" }).success).toBe(false);
    expect(codeState({ issuedOn: "2026-01-01", validUntil: "2026-12-31" }, "2026-06-15")).toBe("active");
    expect(codeState({ issuedOn: null, validUntil: "2026-06-01" }, "2026-06-15")).toBe("expired");
    expect(codeState({ issuedOn: null, validUntil: null }, "2026-06-15")).toBe("undated");
  });

  it("un adempimento ha un tipo e un titolo; lo stato dipende da data e esecuzione", () => {
    expect(reportSchema.parse({ kind: "tourist_tax", title: "Imposta del trimestre", amount: "120,50" })).toMatchObject({ amount: 12_050 });
    expect(reportSchema.safeParse({ kind: "altro_tipo", title: "x" }).success).toBe(false);
    expect(reportSchema.safeParse({ kind: "statistics", title: " " }).success).toBe(false);
    expect(reportDoneSchema.safeParse({}).success).toBe(false);
    expect(reportState({ doneOn: "2026-06-01", dueOn: "2026-05-01" }, "2026-06-15")).toBe("done");
    expect(reportState({ doneOn: null, dueOn: "2026-06-01" }, "2026-06-15")).toBe("overdue");
    expect(reportState({ doneOn: null, dueOn: null }, "2026-06-15")).toBe("open");
  });

  it("le persone collegate sono contatti della rubrica con un ruolo", () => {
    expect(partySchema.parse({ partyId: ASSET })).toMatchObject({ role: "tenant" });
    expect(partySchema.safeParse({ partyId: "" }).success).toBe(false);
    expect(partySchema.safeParse({ partyId: ASSET, role: "padrone" }).success).toBe(false);
  });
});
