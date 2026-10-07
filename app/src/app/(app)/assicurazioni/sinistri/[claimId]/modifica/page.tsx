import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { getClaimDetail } from "@/modules/insurance";
import { isUuid } from "@/lib/ids";
import { SimpleForm } from "@/components/simple-form";
import { claimSections, claimValues } from "../../../_components/insurance-form-data";
import { saveClaimAction } from "../../../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("insurance.claimForm");
  return { title: t("titleEdit") };
}

export default async function EditClaimPage({ params }: PageProps<"/assicurazioni/sinistri/[claimId]/modifica">) {
  await requireOwner();
  const { claimId } = await params;
  if (!isUuid(claimId)) notFound();
  const claim = await getClaimDetail(getDb(), claimId);
  if (!claim) notFound();
  const tf = await getTranslations("insurance.claimForm");
  return (
    <div className="mx-auto max-w-3xl">
      <SimpleForm title={tf("titleEdit")} intro={tf("intro")} sections={await claimSections()} initial={claimValues(claim)} submitLabel={tf("submitEdit")} onSubmit={saveClaimAction.bind(null, claimId)} cancelHref={`/assicurazioni/sinistri/${claimId}`} />
    </div>
  );
}
