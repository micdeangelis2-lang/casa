import { getTranslations } from "next-intl/server";
import { getDb } from "@/platform/db/client";
import { listAssets } from "@/modules/assets";
import { listParties } from "@/modules/directory";
import { WORK_STATUSES, type WorkDetail } from "@/modules/maintenance";
import type { FormSection, FormValues } from "@/components/simple-form";
import { formatEuro } from "@/lib/format";

export const workValues = (w?: WorkDetail, preset: { assetId?: string } = {}): FormValues => ({
  assetId: w?.assetId ?? preset.assetId ?? "",
  title: w?.title ?? "",
  description: w?.description ?? "",
  status: w?.status ?? "planned",
  supplierPartyId: w?.supplierPartyId ?? "",
  scheduledOn: w?.scheduledOn ?? "",
  startedOn: w?.startedOn ?? "",
  completedOn: w?.completedOn ?? "",
  budget: w?.budgetCents != null ? formatEuro(w.budgetCents) : "",
  note: w?.note ?? "",
  createDeadline: false,
});

/** Il modulo di un intervento. In modifica non si propone la scadenza: la ricorrenza si gestisce da Scadenze. */
export async function workSections(editing: boolean): Promise<FormSection[]> {
  const tf = await getTranslations("maintenance.form");
  const ts = await getTranslations("maintenance");
  const db = getDb();
  const [assets, parties] = await Promise.all([listAssets(db), listParties(db)]);
  return [
    {
      fields: [
        { kind: "select", name: "assetId", label: tf("asset"), options: assets.map((a) => ({ value: a.id, label: a.name })), emptyLabel: tf("chooseAsset") },
        { kind: "text", name: "title", label: tf("title"), maxLength: 200 },
        { kind: "select", name: "status", label: tf("status"), options: WORK_STATUSES.map((s) => ({ value: s, label: ts(`status.${s}`) })) },
        { kind: "select", name: "supplierPartyId", label: tf("supplier"), options: parties.map((p) => ({ value: p.id, label: p.displayName })), emptyLabel: tf("noSupplier") },
        { kind: "date", name: "scheduledOn", label: tf("scheduledOn") },
        { kind: "date", name: "startedOn", label: tf("startedOn") },
        { kind: "date", name: "completedOn", label: tf("completedOn") },
        { kind: "text", name: "budget", label: tf("budget"), inputMode: "decimal", maxLength: 14 },
      ],
      columns: 2,
    },
    {
      fields: [
        { kind: "textarea", name: "description", label: tf("description"), maxLength: 2000 },
        { kind: "textarea", name: "note", label: tf("note"), maxLength: 1000 },
        ...(editing ? [] : ([{ kind: "checkbox", name: "createDeadline", label: tf("createDeadline") }] as const)),
      ],
    },
  ];
}
