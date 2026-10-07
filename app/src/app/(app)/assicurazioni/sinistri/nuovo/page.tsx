import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireOwner } from "@/platform/auth/owner";
import { isUuid } from "@/lib/ids";
import { SimpleForm } from "@/components/simple-form";
import { claimSections, claimValues } from "../../_components/insurance-form-data";
import { saveClaimAction } from "../../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("insurance.claimForm");
  return { title: t("titleNew") };
}

export default async function NewClaimPage({ searchParams }: PageProps<"/assicurazioni/sinistri/nuovo">) {
  await requireOwner();
  const tf = await getTranslations("insurance.claimForm");
  const { polizza } = await searchParams;
  const policyId = typeof polizza === "string" && isUuid(polizza) ? polizza : undefined;
  return (
    <div className="mx-auto max-w-3xl">
      <SimpleForm title={tf("titleNew")} intro={tf("intro")} sections={await claimSections()} initial={claimValues(undefined, { policyId })} submitLabel={tf("submitNew")} onSubmit={saveClaimAction.bind(null, null)} cancelHref="/assicurazioni?sezione=claims" />
    </div>
  );
}
