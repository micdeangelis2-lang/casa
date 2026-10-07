import { getTranslations } from "next-intl/server";
import { getDb } from "@/platform/db/client";
import { listAssets } from "@/modules/assets";
import { listParties } from "@/modules/directory";
import { MATTER_STATUSES, type MatterDetail } from "@/modules/matters";
import type { FormSection, FormValues } from "@/components/simple-form";

export const matterValues = (m?: MatterDetail, preset: { assetId?: string } = {}): FormValues => ({
  title: m?.title ?? "",
  description: m?.description ?? "",
  assetId: m?.assetId ?? preset.assetId ?? "",
  status: m?.status ?? "open",
  openedOn: m?.openedOn ?? "",
  officePartyId: m?.officePartyId ?? "",
  protocolNumber: m?.protocolNumber ?? "",
  submittedOn: m?.submittedOn ?? "",
  responseDueOn: m?.responseDueOn ?? "",
});

export async function matterSections(): Promise<FormSection[]> {
  const t = await getTranslations("matters");
  const tf = await getTranslations("matters.form");
  const [assets, parties] = await Promise.all([listAssets(getDb()), listParties(getDb())]);
  return [
    {
      fields: [
        { kind: "text", name: "title", label: tf("title"), maxLength: 200 },
        { kind: "textarea", name: "description", label: tf("description"), maxLength: 2000 },
        { kind: "select", name: "assetId", label: tf("asset"), options: assets.map((a) => ({ value: a.id, label: a.name })), emptyLabel: tf("noAsset") },
        { kind: "select", name: "status", label: tf("status"), options: MATTER_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) })) },
        { kind: "date", name: "openedOn", label: tf("openedOn"), hint: tf("openedOnHint") },
      ],
      columns: 2,
    },
    {
      legend: tf("submissionLegend"),
      fields: [
        { kind: "select", name: "officePartyId", label: tf("office"), hint: tf("officeHint"), options: parties.map((p) => ({ value: p.id, label: p.displayName })), emptyLabel: tf("noOffice") },
        { kind: "text", name: "protocolNumber", label: tf("protocolNumber"), maxLength: 80 },
        { kind: "date", name: "submittedOn", label: tf("submittedOn") },
        { kind: "date", name: "responseDueOn", label: tf("responseDueOn"), hint: tf("responseDueOnHint") },
      ],
      columns: 2,
    },
  ];
}
