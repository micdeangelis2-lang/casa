import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { getPlantDetail } from "@/modules/maintenance";
import { isUuid } from "@/lib/ids";
import { SimpleForm } from "@/components/simple-form";
import { plantSections, plantValues } from "../../_components/plant-form-data";
import { savePlantAction } from "../../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("impiantista.plant");
  return { title: t("titleEdit") };
}

export default async function EditPlantPage({ params }: PageProps<"/manutenzioni/impianti/[id]/modifica">) {
  await requireOwner();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const plant = await getPlantDetail(getDb(), id);
  if (!plant) notFound();
  const tf = await getTranslations("impiantista.plant");
  return (
    <div className="mx-auto max-w-3xl">
      <SimpleForm title={tf("titleEdit")} sections={await plantSections(true)} initial={plantValues(plant)} submitLabel={tf("submitEdit")} onSubmit={savePlantAction.bind(null, id)} cancelHref={`/manutenzioni/impianti/${id}`} />
    </div>
  );
}
