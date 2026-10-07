import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireOwner } from "@/platform/auth/owner";
import { isUuid } from "@/lib/ids";
import { SimpleForm } from "@/components/simple-form";
import { matterSections, matterValues } from "../_components/matter-form-data";
import { saveMatterAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("matters.form");
  return { title: t("titleNew") };
}

export default async function NewMatterPage({ searchParams }: PageProps<"/pratiche/nuova">) {
  await requireOwner();
  const tf = await getTranslations("matters.form");
  const { immobile } = await searchParams;
  const assetId = typeof immobile === "string" && isUuid(immobile) ? immobile : undefined;
  return (
    <div className="mx-auto max-w-3xl">
      <SimpleForm title={tf("titleNew")} sections={await matterSections()} initial={matterValues(undefined, { assetId })} submitLabel={tf("submitNew")} onSubmit={saveMatterAction.bind(null, null)} cancelHref="/pratiche" />
    </div>
  );
}
