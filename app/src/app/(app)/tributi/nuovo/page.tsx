import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireOwner } from "@/platform/auth/owner";
import { isUuid } from "@/lib/ids";
import { SimpleForm } from "@/components/simple-form";
import { obligationSections, obligationValues } from "../_components/obligation-form-data";
import { saveObligationAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("taxes.form");
  return { title: t("titleNew") };
}

export default async function NewObligationPage({ searchParams }: PageProps<"/tributi/nuovo">) {
  await requireOwner();
  const tf = await getTranslations("taxes.form");
  const { immobile } = await searchParams;
  const assetId = typeof immobile === "string" && isUuid(immobile) ? immobile : undefined;
  return (
    <div className="mx-auto max-w-3xl">
      <SimpleForm title={tf("titleNew")} sections={await obligationSections(false)} initial={obligationValues(undefined, { assetId })} submitLabel={tf("submitNew")} onSubmit={saveObligationAction.bind(null, null)} cancelHref="/tributi" />
    </div>
  );
}
