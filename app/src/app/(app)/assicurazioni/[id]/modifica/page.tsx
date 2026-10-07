import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { getPolicyDetail } from "@/modules/insurance";
import { isUuid } from "@/lib/ids";
import { SimpleForm } from "@/components/simple-form";
import { policySections, policyValues } from "../../_components/insurance-form-data";
import { savePolicyAction } from "../../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("insurance.form");
  return { title: t("titleEdit") };
}

export default async function EditPolicyPage({ params }: PageProps<"/assicurazioni/[id]/modifica">) {
  await requireOwner();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const policy = await getPolicyDetail(getDb(), id);
  if (!policy) notFound();
  const tf = await getTranslations("insurance.form");
  return (
    <div className="mx-auto max-w-3xl">
      <SimpleForm title={tf("titleEdit")} sections={await policySections(true)} initial={policyValues(policy)} submitLabel={tf("submitEdit")} onSubmit={savePolicyAction.bind(null, id)} cancelHref={`/assicurazioni/${id}`} />
    </div>
  );
}
