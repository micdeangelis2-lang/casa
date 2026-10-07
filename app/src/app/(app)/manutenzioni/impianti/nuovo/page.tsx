import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireOwner } from "@/platform/auth/owner";
import { isUuid } from "@/lib/ids";
import { SimpleForm } from "@/components/simple-form";
import { plantSections, plantValues } from "../_components/plant-form-data";
import { savePlantAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("impiantista.plant");
  return { title: t("titleNew") };
}

export default async function NewPlantPage({ searchParams }: PageProps<"/manutenzioni/impianti/nuovo">) {
  await requireOwner();
  const tf = await getTranslations("impiantista.plant");
  const { immobile } = await searchParams;
  const assetId = typeof immobile === "string" && isUuid(immobile) ? immobile : undefined;
  return (
    <div className="mx-auto max-w-3xl">
      <SimpleForm
        title={tf("titleNew")}
        intro={tf("intro")}
        sections={await plantSections(false)}
        initial={plantValues(undefined, { assetId })}
        submitLabel={tf("submitNew")}
        onSubmit={savePlantAction.bind(null, null)}
        cancelHref="/manutenzioni/impianti"
      />
    </div>
  );
}
