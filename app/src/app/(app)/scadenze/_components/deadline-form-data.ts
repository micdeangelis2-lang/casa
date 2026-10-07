import { getTranslations } from "next-intl/server";
import { getDb } from "@/platform/db/client";
import { listAssets } from "@/modules/assets";
import { DEADLINE_CATEGORIES, LEVELS, PRIORITIES, type DeadlineRow } from "@/modules/deadlines";
import { listParties } from "@/modules/directory";
import { listMatters } from "@/modules/matters";
import { calcToFields, emptyCalcFields, fieldsToCalc } from "@/shared/calc-form";
import type { FormSection, FormValues } from "@/components/simple-form";

/** Valori iniziali del modulo scadenza (vuoto, oppure dalla scadenza da modificare). */
export function deadlineValues(d?: DeadlineRow, preset: { assetId?: string; professionalPartyId?: string; matterId?: string } = {}): FormValues {
  const calc = d ? calcToFields(d.calc) : emptyCalcFields();
  return {
    title: d?.title ?? "",
    description: d?.description ?? "",
    category: d?.category ?? "administrative",
    level: d?.level ?? "national",
    legalBasis: d?.legalBasis ?? "",
    assetId: d?.assetId ?? preset.assetId ?? "",
    responsiblePartyId: d?.responsiblePartyId ?? "",
    professionalPartyId: d?.professionalPartyId ?? preset.professionalPartyId ?? "",
    matterId: d?.matterId ?? preset.matterId ?? "",
    ...calc,
    firstDueOn: "",
    shiftToBusinessDay: d?.shiftToBusinessDay ?? false,
    priority: d?.priority ?? "normal",
    leadDays: d ? d.leadDays.join(", ") : "",
    proofRequired: d?.proofRequired ?? false,
    consequences: d?.consequences ?? "",
    requiredDocuments: d?.requiredDocuments ?? "",
  };
}

const str = (v: FormValues, k: string) => (typeof v[k] === "string" ? (v[k] as string) : "");

/** Dai valori del modulo al formato atteso dal server (la validazione vera la fa il server). */
export function deadlinePayload(v: FormValues): unknown {
  const days = str(v, "leadDays")
    .split(/[,\s;]+/)
    .filter(Boolean)
    .map(Number);
  return {
    title: str(v, "title"),
    description: str(v, "description"),
    category: str(v, "category"),
    level: str(v, "level"),
    legalBasis: str(v, "legalBasis"),
    assetId: str(v, "assetId"),
    responsiblePartyId: str(v, "responsiblePartyId"),
    professionalPartyId: str(v, "professionalPartyId"),
    matterId: str(v, "matterId"),
    calc: fieldsToCalc({
      calcType: str(v, "calcType"),
      month: str(v, "month"),
      day: str(v, "day"),
      anchorKind: str(v, "anchorKind"),
      anchorDate: str(v, "anchorDate"),
      anchorAttribute: str(v, "anchorAttribute"),
      amount: str(v, "amount"),
      unit: str(v, "unit"),
    }),
    shiftToBusinessDay: v.shiftToBusinessDay === true,
    priority: str(v, "priority"),
    leadDays: days.length > 0 ? days : undefined,
    proofRequired: v.proofRequired === true,
    consequences: str(v, "consequences"),
    requiredDocuments: str(v, "requiredDocuments"),
    firstDueOn: str(v, "firstDueOn"),
  };
}

/** Le sezioni del modulo (dati semplici: passano dal server al componente client). */
export async function deadlineSections(options: { ownerFieldsOnly?: boolean } = {}): Promise<FormSection[]> {
  const t = await getTranslations("deadlines");
  const tf = await getTranslations("deadlines.form");
  const tc = await getTranslations("calc");
  const tr = await getTranslations("rules");
  const db = getDb();
  const [assets, parties, matters] = await Promise.all([listAssets(db), listParties(db), listMatters(db, { includeClosed: true })]);
  const contacts = parties.map((p) => ({ value: p.id, label: p.displayName }));

  const people: FormSection = {
    legend: tf("notices"),
    fields: [
      { kind: "select", name: "responsiblePartyId", label: tf("responsible"), options: contacts, emptyLabel: tf("noContact") },
      { kind: "select", name: "professionalPartyId", label: tf("professional"), options: contacts, emptyLabel: tf("noContact") },
      { kind: "select", name: "matterId", label: tf("matter"), hint: tf("matterHint"), options: matters.map((m) => ({ value: m.id, label: m.title })), emptyLabel: tf("noMatter") },
      { kind: "select", name: "priority", label: tf("priority"), options: PRIORITIES.map((p) => ({ value: p, label: t(`priority.${p}`) })) },
      { kind: "text", name: "leadDays", label: tf("leadDays"), hint: tf("leadDaysHint") },
    ],
    columns: 2,
  };
  if (options.ownerFieldsOnly) return [{ intro: tf("ownerOnly"), fields: [] }, people];

  return [
    {
      legend: tf("basics"),
      fields: [
        { kind: "text", name: "title", label: tf("ruleTitle"), maxLength: 200 },
        { kind: "textarea", name: "description", label: tf("description"), maxLength: 1000 },
        { kind: "select", name: "category", label: tf("category"), options: DEADLINE_CATEGORIES.map((c) => ({ value: c, label: t(`category.${c}`) })) },
        { kind: "select", name: "level", label: tf("level"), options: LEVELS.map((l) => ({ value: l, label: tr(`level.${l}`) })) },
        { kind: "text", name: "legalBasis", label: tf("legalBasis"), hint: tf("legalBasisHint"), maxLength: 500 },
        { kind: "select", name: "assetId", label: tf("asset"), options: assets.map((a) => ({ value: a.id, label: a.name })), emptyLabel: tf("noAsset") },
      ],
      columns: 2,
    },
    {
      legend: tf("calc"),
      fields: [
        {
          kind: "select",
          name: "calcType",
          label: tc("type"),
          options: (["fixed_annual", "relative_to", "recurring", "manual"] as const).map((c) => ({ value: c, label: tc(`types.${c}`) })),
        },
        { kind: "date", name: "firstDueOn", label: tf("firstDueOn"), hint: tf("firstDueOnHint"), showIf: { name: "calcType", in: ["manual"] } },
        { kind: "text", name: "day", label: tc("day"), inputMode: "numeric", showIf: { name: "calcType", in: ["fixed_annual"] } },
        {
          kind: "select",
          name: "month",
          label: tc("month"),
          emptyLabel: tc("choose"),
          options: Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: tc(`months.${(i + 1) as 1}`) })),
          showIf: { name: "calcType", in: ["fixed_annual"] },
        },
        {
          kind: "select",
          name: "anchorKind",
          label: tc("anchorKind"),
          options: [
            { value: "date", label: tc("anchorDate") },
            { value: "attribute", label: tc("anchorAttribute") },
          ],
          showIf: { name: "calcType", in: ["relative_to", "recurring"] },
        },
        { kind: "date", name: "anchorDate", label: tc("anchorDateValue"), showIf: [{ name: "calcType", in: ["relative_to", "recurring"] }, { name: "anchorKind", in: ["date"] }] },
        { kind: "text", name: "anchorAttribute", label: tc("anchorAttributeValue"), hint: tc("anchorAttributeHint"), maxLength: 40, showIf: [{ name: "calcType", in: ["relative_to", "recurring"] }, { name: "anchorKind", in: ["attribute"] }] },
        { kind: "text", name: "amount", label: tc("offset"), hint: tc("offsetHint"), inputMode: "numeric", showIf: { name: "calcType", in: ["relative_to", "recurring"] } },
        {
          kind: "select",
          name: "unit",
          label: tc("unit"),
          options: (["days", "months", "years"] as const).map((u) => ({ value: u, label: tc(`units.${u}`) })),
          showIf: { name: "calcType", in: ["relative_to", "recurring"] },
        },
        { kind: "checkbox", name: "shiftToBusinessDay", label: tf("shift") },
      ],
      columns: 2,
    },
    people,
    {
      fields: [
        { kind: "checkbox", name: "proofRequired", label: tf("proof") },
        { kind: "textarea", name: "consequences", label: tf("consequences"), maxLength: 1000 },
        { kind: "textarea", name: "requiredDocuments", label: tf("documents"), maxLength: 1000 },
      ],
    },
  ];
}
