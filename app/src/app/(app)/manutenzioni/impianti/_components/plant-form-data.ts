import { getTranslations } from "next-intl/server";
import { getDb } from "@/platform/db/client";
import { listAssets } from "@/modules/assets";
import { listParties } from "@/modules/directory";
import { PLANT_KINDS, type PlantItem } from "@/modules/maintenance";
import type { FormSection, FormValues } from "@/components/simple-form";
import { loadPlantTypes } from "../plant-types";

export const plantValues = (p?: PlantItem, preset: { assetId?: string } = {}): FormValues => ({
  assetId: p?.assetId ?? preset.assetId ?? "",
  kind: p?.kind ?? "",
  name: p?.name ?? "",
  installedOn: p?.installedOn ?? "",
  installerPartyId: p?.installerPartyId ?? "",
  maintainerPartyId: p?.maintainerPartyId ?? "",
  serialNumber: p?.serialNumber ?? "",
  note: p?.note ?? "",
});

/** Il modulo di un impianto. In modifica l'immobile non si cambia: ne dipendono le verifiche, le garanzie e gli interventi collegati. */
export async function plantSections(editing: boolean): Promise<FormSection[]> {
  const tf = await getTranslations("impiantista.plant");
  const db = getDb();
  const [assets, parties, { name: typeName }] = await Promise.all([listAssets(db), listParties(db), loadPlantTypes()]);
  const contacts = parties.map((p) => ({ value: p.id, label: p.displayName }));
  return [
    {
      fields: [
        ...(editing ? [] : ([{ kind: "select", name: "assetId", label: tf("asset"), options: assets.map((a) => ({ value: a.id, label: a.name })), emptyLabel: tf("chooseAsset") }] as const)),
        { kind: "select", name: "kind", label: tf("kind"), options: PLANT_KINDS.map((k) => ({ value: k, label: typeName(k) })), emptyLabel: tf("chooseAsset") },
        { kind: "text", name: "name", label: tf("name"), maxLength: 160 },
        { kind: "date", name: "installedOn", label: tf("installedOn") },
        { kind: "select", name: "installerPartyId", label: tf("installer"), options: contacts, emptyLabel: tf("noParty") },
        { kind: "select", name: "maintainerPartyId", label: tf("maintainer"), options: contacts, emptyLabel: tf("noParty") },
        { kind: "text", name: "serialNumber", label: tf("serialNumber"), maxLength: 120 },
      ],
      columns: 2,
    },
    { fields: [{ kind: "textarea", name: "note", label: tf("note"), maxLength: 1000 }] },
  ];
}
