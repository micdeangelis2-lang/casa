import type { Calc } from "./calc";

/** Campi piatti (tutti testo) con cui un modulo descrive una regola di calcolo. La validazione vera la fa `calcSchema`. */
export type CalcFields = {
  calcType: string;
  month: string;
  day: string;
  anchorKind: string;
  anchorDate: string;
  anchorAttribute: string;
  amount: string;
  unit: string;
};

export const emptyCalcFields = (): CalcFields => ({ calcType: "fixed_annual", month: "", day: "", anchorKind: "date", anchorDate: "", anchorAttribute: "", amount: "", unit: "days" });

const num = (s: string) => (s.trim() === "" ? Number.NaN : Number(s.replace(",", ".")));

/** Dai campi del modulo all'oggetto da validare. */
export function fieldsToCalc(f: CalcFields): unknown {
  const anchor = f.anchorKind === "attribute" ? { kind: "attribute", name: f.anchorAttribute.trim() } : { kind: "date", date: f.anchorDate };
  switch (f.calcType) {
    case "fixed_annual":
      return { type: "fixed_annual", month: num(f.month), day: num(f.day) };
    case "relative_to":
      return { type: "relative_to", anchor, offset: { unit: f.unit, amount: num(f.amount) } };
    case "recurring":
      return { type: "recurring", anchor, every: { unit: f.unit, amount: num(f.amount) } };
    default:
      return { type: "manual" };
  }
}

/** Dalla regola salvata ai campi del modulo di modifica. */
export function calcToFields(calc: Calc): CalcFields {
  const base = emptyCalcFields();
  switch (calc.type) {
    case "fixed_annual":
      return { ...base, calcType: "fixed_annual", month: String(calc.month), day: String(calc.day) };
    case "relative_to":
    case "recurring": {
      const step = calc.type === "relative_to" ? calc.offset : calc.every;
      return {
        ...base,
        calcType: calc.type,
        anchorKind: calc.anchor.kind,
        anchorDate: calc.anchor.kind === "date" ? calc.anchor.date : "",
        anchorAttribute: calc.anchor.kind === "attribute" ? calc.anchor.name : "",
        amount: String(step.amount),
        unit: step.unit,
      };
    }
    default:
      return { ...base, calcType: "manual" };
  }
}
