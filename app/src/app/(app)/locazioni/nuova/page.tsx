import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireOwner } from "@/platform/auth/owner";
import { isUuid } from "@/lib/ids";
import { SimpleForm } from "@/components/simple-form";
import { lettingSections, lettingValues } from "../_components/letting-form-data";
import { saveLettingAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("lettings.form");
  return { title: t("titleNew") };
}

export default async function NewLettingPage({ searchParams }: PageProps<"/locazioni/nuova">) {
  await requireOwner();
  const tf = await getTranslations("lettings.form");
  const { immobile } = await searchParams;
  const assetId = typeof immobile === "string" && isUuid(immobile) ? immobile : undefined;
  return (
    <div className="mx-auto max-w-3xl">
      <SimpleForm title={tf("titleNew")} sections={await lettingSections(false)} initial={lettingValues(undefined, { assetId })} submitLabel={tf("submitNew")} onSubmit={saveLettingAction.bind(null, null)} cancelHref="/locazioni" />
    </div>
  );
}
