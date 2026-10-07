import { calcToFields, emptyCalcFields, fieldsToCalc, type CalcFields } from "@/shared/calc-form";
import { fromFlat, toFlat, type Condition, type ConditionOp, type FlatRow, type Primitive, type RuleLevel, type RuleVerification, type Outcome } from "@/modules/rules/client";

/** Fatti che l'editor offre. Le caratteristiche tecniche libere stanno sotto «attribute». */
export const FACT_KINDS = ["asset.kind", "asset.useType", "asset.inCondominium", "rights.regimes", "letting.types", "attribute"] as const;
export type FactKind = (typeof FACT_KINDS)[number];

/** Confronti ammessi per ogni fatto (gli altri non avrebbero senso). */
export const OPS_BY_FACT: Record<FactKind, ConditionOp[]> = {
  "asset.kind": ["eq", "in"],
  "asset.useType": ["eq", "in"],
  "asset.inCondominium": ["eq"],
  "rights.regimes": ["contains"],
  "letting.types": ["contains"],
  attribute: ["eq", "in", "gte", "lte", "exists"],
};

export type ValueType = "text" | "number" | "boolean";

export type ConditionRow = {
  key: string;
  negate: boolean;
  factKind: FactKind;
  attrName: string;
  op: ConditionOp;
  value: string;
  list: string[];
  valueType: ValueType;
};

export type OutcomeRow = {
  key: string;
  type: "checklist" | "notice" | "deadline";
  code: string;
  title: string;
  dossierCategory: string;
  expectedDocumentCategory: string;
  note: string;
  message: string;
  /** Solo per le scadenze. */
  deadlineCategory: string;
  priority: string;
  shift: boolean;
  proof: boolean;
  legalBasis: string;
  consequences: string;
  requiredDocuments: string;
  calc: CalcFields;
};

export type RuleFormValues = {
  title: string;
  description: string;
  level: RuleLevel;
  territory: { id: string; label: string } | null;
  validFrom: string;
  validTo: string;
  /** "locked": condizione complessa che il modulo non sa modificare, conservata cosi' com'e'. */
  conditionMode: "always" | "all" | "any" | "locked";
  rows: ConditionRow[];
  locked: Condition | null;
  outcomes: OutcomeRow[];
  sourceText: string;
  sourceUrl: string;
  verificationStatus: RuleVerification;
  changeNote: string;
};

export const newConditionRow = (): ConditionRow => ({
  key: crypto.randomUUID(),
  negate: false,
  factKind: "asset.kind",
  attrName: "",
  op: "eq",
  value: "dwelling",
  list: [],
  valueType: "text",
});

export const newOutcomeRow = (): OutcomeRow => ({
  key: crypto.randomUUID(),
  type: "checklist",
  code: "",
  title: "",
  dossierCategory: "",
  expectedDocumentCategory: "",
  note: "",
  message: "",
  deadlineCategory: "administrative",
  priority: "normal",
  shift: false,
  proof: false,
  legalBasis: "",
  consequences: "",
  requiredDocuments: "",
  calc: emptyCalcFields(),
});

export const emptyRuleForm = (): RuleFormValues => ({
  title: "",
  description: "",
  level: "national",
  territory: null,
  validFrom: "",
  validTo: "",
  conditionMode: "always",
  rows: [],
  locked: null,
  outcomes: [newOutcomeRow()],
  sourceText: "",
  sourceUrl: "",
  verificationStatus: "to_verify",
  changeNote: "",
});

const typeOf = (v: Primitive): ValueType => (typeof v === "number" ? "number" : typeof v === "boolean" ? "boolean" : "text");

function rowFromFlat(r: FlatRow): ConditionRow {
  const isAttribute = r.path.startsWith("attributes.");
  const sample = Array.isArray(r.value) ? r.value[0] : r.value;
  return {
    key: crypto.randomUUID(),
    negate: r.negate,
    factKind: isAttribute ? "attribute" : (r.path as FactKind),
    attrName: isAttribute ? r.path.slice("attributes.".length) : "",
    op: r.op,
    value: Array.isArray(r.value) ? "" : r.value === undefined ? "" : String(r.value),
    list: Array.isArray(r.value) ? r.value.map(String) : [],
    valueType: sample === undefined ? "text" : typeOf(sample),
  };
}

/** Dalla versione salvata al modulo di modifica. */
export function versionToForm(
  v: {
    title: string;
    description: string | null;
    level: RuleLevel;
    territoryId: string | null;
    validFrom: string | null;
    validTo: string | null;
    appliesWhen: Condition | null;
    outcomes: Outcome[];
    sourceText: string;
    sourceUrl: string | null;
    verificationStatus: RuleVerification;
  },
  territoryLabel: string | null,
): RuleFormValues {
  const flat = toFlat(v.appliesWhen);
  return {
    title: v.title,
    description: v.description ?? "",
    level: v.level,
    territory: v.territoryId ? { id: v.territoryId, label: territoryLabel ?? "" } : null,
    validFrom: v.validFrom ?? "",
    validTo: v.validTo ?? "",
    conditionMode: flat === null ? "locked" : flat.mode,
    rows: flat && flat.mode !== "always" ? flat.rows.map(rowFromFlat) : [],
    locked: flat === null ? v.appliesWhen : null,
    outcomes: v.outcomes.map((o) => ({
      ...newOutcomeRow(),
      type: o.type,
      code: o.key,
      title: o.title,
      dossierCategory: o.type === "checklist" ? o.dossierCategory : "",
      expectedDocumentCategory: o.type === "checklist" ? (o.expectedDocumentCategory ?? "") : "",
      note: o.type === "checklist" ? (o.note ?? "") : "",
      message: o.type === "notice" ? o.message : "",
      ...(o.type === "deadline"
        ? {
            deadlineCategory: o.category,
            priority: o.priority,
            shift: o.shiftToBusinessDay,
            proof: o.proofRequired,
            legalBasis: o.legalBasis ?? "",
            consequences: o.consequences ?? "",
            requiredDocuments: o.requiredDocuments ?? "",
            calc: calcToFields(o.calc),
          }
        : {}),
    })),
    sourceText: v.sourceText,
    sourceUrl: v.sourceUrl ?? "",
    verificationStatus: v.verificationStatus,
    changeNote: "",
  };
}

const parseValue = (raw: string, type: ValueType): Primitive => {
  if (type === "number") return raw.trim() === "" ? Number.NaN : Number(raw.replace(",", "."));
  if (type === "boolean") return raw === "true";
  return raw.trim();
};

function rowToFlat(r: ConditionRow): FlatRow {
  const path = r.factKind === "attribute" ? `attributes.${r.attrName.trim()}` : r.factKind;
  const base = { negate: r.negate, op: r.op, path };
  if (r.op === "exists") return base;
  if (r.factKind === "asset.inCondominium") return { ...base, value: r.value === "true" };
  const type: ValueType = r.factKind === "attribute" ? (r.op === "gte" || r.op === "lte" ? "number" : r.valueType) : "text";
  if (r.op === "in") {
    const items = r.factKind === "attribute" ? r.value.split("\n").map((x) => x.trim()).filter(Boolean) : r.list;
    return { ...base, value: items.map((x) => parseValue(x, type)) };
  }
  return { ...base, value: parseValue(r.value, type) };
}

/** Dal modulo al formato atteso dal server (la validazione vera la fa il server). */
export function formToPayload(f: RuleFormValues): unknown {
  const appliesWhen =
    f.conditionMode === "locked"
      ? f.locked
      : fromFlat(f.conditionMode === "always" ? { mode: "always" } : { mode: f.conditionMode, rows: f.rows.map(rowToFlat) });
  return {
    title: f.title,
    description: f.description,
    level: f.level,
    territoryId: f.territory?.id ?? "",
    validFrom: f.validFrom,
    validTo: f.validTo,
    appliesWhen,
    outcomes: f.outcomes.map((o) =>
      o.type === "checklist"
        ? { type: "checklist", key: o.code, title: o.title, dossierCategory: o.dossierCategory, expectedDocumentCategory: o.expectedDocumentCategory, note: o.note }
        : o.type === "notice"
          ? { type: "notice", key: o.code, title: o.title, message: o.message }
          : {
              type: "deadline",
              key: o.code,
              title: o.title,
              category: o.deadlineCategory,
              calc: fieldsToCalc(o.calc),
              shiftToBusinessDay: o.shift,
              priority: o.priority,
              legalBasis: o.legalBasis,
              consequences: o.consequences,
              requiredDocuments: o.requiredDocuments,
              proofRequired: o.proof,
            },
    ),
    sourceText: f.sourceText,
    sourceUrl: f.sourceUrl,
    verificationStatus: f.verificationStatus,
    changeNote: f.changeNote,
  };
}
