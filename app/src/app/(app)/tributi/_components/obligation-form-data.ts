import { getTranslations } from "next-intl/server";
import { getDb } from "@/platform/db/client";
import { listAssets } from "@/modules/assets";
import { listTaxTypes, todayInItaly, type ObligationItem } from "@/modules/taxes";
import type { FormSection, FormValues } from "@/components/simple-form";
import { formatEuro } from "@/lib/format";

export const obligationValues = (o?: ObligationItem, preset: { assetId?: string } = {}): FormValues => ({
  assetId: o?.assetId ?? preset.assetId ?? "",
  taxTypeId: o?.taxTypeId ?? "",
  year: String(o?.year ?? todayInItaly().slice(0, 4)),
  label: o?.label ?? "",
  dueOn: o?.dueOn ?? "",
  expected: o?.expectedCents != null ? formatEuro(o.expectedCents) : "",
  note: o?.note ?? "",
  askAdviser: o?.askAdviser ?? false,
  createDeadline: false,
});

/** Il modulo di una voce. In modifica non si propone di creare la scadenza (si fa dalla scheda della voce). */
export async function obligationSections(editing: boolean, current?: ObligationItem): Promise<FormSection[]> {
  const tf = await getTranslations("taxes.form");
  const db = getDb();
  const [assets, types] = await Promise.all([listAssets(db), listTaxTypes(db, true)]);
  return [
    {
      fields: [
        { kind: "select", name: "assetId", label: tf("asset"), options: assets.map((a) => ({ value: a.id, label: a.name })), emptyLabel: tf("chooseAsset") },
        { kind: "select", name: "taxTypeId", label: tf("type"), options: types.filter((t) => !t.archived || t.id === current?.taxTypeId).map((t) => ({ value: t.id, label: t.name })), emptyLabel: tf("chooseType") },
        { kind: "text", name: "year", label: tf("year"), inputMode: "numeric", maxLength: 4 },
        { kind: "text", name: "label", label: tf("label"), hint: tf("labelHint"), maxLength: 80 },
        { kind: "date", name: "dueOn", label: tf("dueOn"), hint: editing ? tf("dueOnEditHint") : undefined },
        { kind: "text", name: "expected", label: tf("expected"), hint: tf("expectedHint"), inputMode: "decimal", maxLength: 14 },
      ],
      columns: 2,
    },
    {
      fields: [
        { kind: "textarea", name: "note", label: tf("note"), maxLength: 1000 },
        { kind: "checkbox", name: "askAdviser", label: tf("askAdviser") },
        ...(editing ? [] : ([{ kind: "checkbox", name: "createDeadline", label: tf("createDeadline") }] as const)),
      ],
    },
  ];
}
