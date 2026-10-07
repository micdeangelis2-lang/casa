import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireOwner } from "@/platform/auth/owner";
import { isUuid } from "@/lib/ids";
import { SimpleForm } from "@/components/simple-form";
import { workSections, workValues } from "../_components/work-form-data";
import { saveWorkAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("maintenance.form");
  return { title: t("titleNew") };
}

export default async function NewWorkPage({ searchParams }: PageProps<"/manutenzioni/nuovo">) {
  await requireOwner();
  const tf = await getTranslations("maintenance.form");
  const { immobile } = await searchParams;
  const assetId = typeof immobile === "string" && isUuid(immobile) ? immobile : undefined;
  return (
    <div className="mx-auto max-w-3xl">
      <SimpleForm title={tf("titleNew")} sections={await workSections(false)} initial={workValues(undefined, { assetId })} submitLabel={tf("submitNew")} onSubmit={saveWorkAction.bind(null, null)} cancelHref="/manutenzioni" />
    </div>
  );
}
