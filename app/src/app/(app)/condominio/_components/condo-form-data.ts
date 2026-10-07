import { getTranslations } from "next-intl/server";
import { getDb } from "@/platform/db/client";
import { listParties } from "@/modules/directory";
import type { CondominiumDetail } from "@/modules/condominium";
import type { FormSection, FormValues } from "@/components/simple-form";

export const condoValues = (c?: Pick<CondominiumDetail, "name" | "address" | "taxCode" | "administratorPartyId" | "notes">): FormValues => ({
  name: c?.name ?? "",
  address: c?.address ?? "",
  taxCode: c?.taxCode ?? "",
  administratorPartyId: c?.administratorPartyId ?? "",
  notes: c?.notes ?? "",
});

export async function condoSections(): Promise<FormSection[]> {
  const tf = await getTranslations("condominium.form");
  const parties = await listParties(getDb());
  return [
    {
      fields: [
        { kind: "text", name: "name", label: tf("name"), maxLength: 160 },
        { kind: "text", name: "address", label: tf("address"), maxLength: 300 },
        { kind: "text", name: "taxCode", label: tf("taxCode"), maxLength: 20 },
        { kind: "select", name: "administratorPartyId", label: tf("administrator"), options: parties.map((p) => ({ value: p.id, label: p.displayName })), emptyLabel: tf("noAdministrator") },
        { kind: "textarea", name: "notes", label: tf("notes"), maxLength: 2000 },
      ],
    },
  ];
}
