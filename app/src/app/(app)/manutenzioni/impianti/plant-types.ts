import { getTranslations } from "next-intl/server";
import { PLANT_KINDS, type PlantKind, type PlantTypeDef } from "@/modules/maintenance";

/** Ordine dei tipi: il primo che corrisponde vince (vedi `classifyPlantType`). Nomi e parole chiave stanno nei messaggi. */
export const PLANT_TYPE_CODES = PLANT_KINDS.filter((k): k is Exclude<PlantKind, "other"> => k !== "other");
type PlantTypeCode = (typeof PLANT_TYPE_CODES)[number];

export async function loadPlantTypes(): Promise<{ defs: PlantTypeDef[]; name: (code: string) => string }> {
  const t = await getTranslations("impiantista");
  const defs = PLANT_TYPE_CODES.map((code) => ({
    code,
    keywords: t(`types.${code}.keywords`)
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean),
  }));
  return { defs, name: (code) => ((PLANT_TYPE_CODES as readonly string[]).includes(code) ? t(`types.${code as PlantTypeCode}.name`) : t("otherType")) };
}
