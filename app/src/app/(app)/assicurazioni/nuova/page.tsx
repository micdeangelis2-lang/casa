import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireOwner } from "@/platform/auth/owner";
import { SimpleForm } from "@/components/simple-form";
import { policySections, policyValues } from "../_components/insurance-form-data";
import { savePolicyAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("insurance.form");
  return { title: t("titleNew") };
}

export default async function NewPolicyPage() {
  await requireOwner();
  const tf = await getTranslations("insurance.form");
  return (
    <div className="mx-auto max-w-3xl">
      <SimpleForm title={tf("titleNew")} sections={await policySections(false)} initial={policyValues()} submitLabel={tf("submitNew")} onSubmit={savePolicyAction.bind(null, null)} cancelHref="/assicurazioni" />
    </div>
  );
}
