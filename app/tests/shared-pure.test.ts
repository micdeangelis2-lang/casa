import { describe, expect, it } from "vitest";
import { calcSchema } from "@/shared/calc";
import { calcToFields, emptyCalcFields, fieldsToCalc } from "@/shared/calc-form";
import { canRemovePasskey, describeUserAgent, maskIpAddress } from "@/shared/account-security";
import { isUuid } from "@/lib/ids";

describe("calc-form: campi del modulo <-> regola di calcolo", () => {
  it("una regola salvata, riportata nei campi e rivalidata, resta la stessa", () => {
    const rules = [
      { type: "fixed_annual", month: 3, day: 31 },
      { type: "relative_to", anchor: { kind: "date", date: "2026-01-10" }, offset: { unit: "days", amount: 30 } },
      { type: "recurring", anchor: { kind: "attribute", name: "scadenza" }, every: { unit: "months", amount: 6 } },
      { type: "manual" },
    ];
    for (const rule of rules) {
      const parsed = calcSchema.parse(rule);
      expect(calcSchema.parse(fieldsToCalc(calcToFields(parsed)))).toEqual(parsed);
    }
  });

  it("accetta la virgola decimale e non inventa numeri dai campi vuoti", () => {
    const fields = { ...emptyCalcFields(), calcType: "relative_to", anchorDate: "2026-01-01", amount: "" };
    expect(calcSchema.safeParse(fieldsToCalc(fields)).success).toBe(false);
    expect(fieldsToCalc({ ...emptyCalcFields(), month: "2", day: "1,0" })).toEqual({ type: "fixed_annual", month: 2, day: 1 });
  });
});

describe("sicurezza dell'account: regole pure", () => {
  it("una passkey si rimuove solo se ne resta un'altra", () => {
    expect(canRemovePasskey(0)).toBe(false);
    expect(canRemovePasskey(1)).toBe(false);
    expect(canRemovePasskey(2)).toBe(true);
  });

  it("riconosce browser e sistema rispettando l'ordine (Edge prima di Chrome)", () => {
    const edge = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0";
    expect(describeUserAgent(edge)).toEqual({ browser: "Edge", os: "Windows" });
    expect(describeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Safari/604.1")).toEqual({ browser: "Safari", os: "iOS" });
    expect(describeUserAgent(null)).toEqual({ browser: null, os: null });
    expect(describeUserAgent("curl/8")).toEqual({ browser: null, os: null });
  });

  it("nasconde la parte finale dell'indirizzo IP e scarta i valori non riconosciuti", () => {
    expect(maskIpAddress("198.51.100.23")).toBe("198.51.100.x");
    expect(maskIpAddress("::ffff:198.51.100.23")).toBe("198.51.100.x");
    expect(maskIpAddress("2001:db8:1:2:3:4:5:6")).toBe("2001:db8:1:2:…");
    expect(maskIpAddress("2001:db8::1")).toBe("2001:db8:0:0:…");
    expect(maskIpAddress("non-un-ip")).toBeNull();
    expect(maskIpAddress("  ")).toBeNull();
    expect(maskIpAddress(undefined)).toBeNull();
  });
});

describe("isUuid", () => {
  it("accetta solo UUID ben formati", () => {
    expect(isUuid("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
    expect(isUuid("123e4567")).toBe(false);
    expect(isUuid("../etc/passwd")).toBe(false);
  });
});
