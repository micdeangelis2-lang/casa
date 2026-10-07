import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireOwner } from "@/platform/auth/owner";
import { SimpleForm } from "@/components/simple-form";
import { condoSections, condoValues } from "../_components/condo-form-data";
import { saveCondominiumAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("condominium.form");
  return { title: t("titleNew") };
}

export default async function NewCondominiumPage() {
  await requireOwner();
  const tf = await getTranslations("condominium.form");
  return (
    <div className="mx-auto max-w-3xl">
      <SimpleForm title={tf("titleNew")} sections={await condoSections()} initial={condoValues()} submitLabel={tf("submitNew")} onSubmit={saveCondominiumAction.bind(null, null)} cancelHref="/condominio" />
    </div>
  );
}
