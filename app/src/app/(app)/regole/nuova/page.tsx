import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireOwner } from "@/platform/auth/owner";
import { RuleForm } from "../_components/rule-form";
import { loadRuleFormOptions } from "../_components/form-options";
import { saveRuleAction } from "../actions";
import { emptyRuleForm } from "../rule-form-state";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("rules.form");
  return { title: t("titleNew") };
}

export default async function NewRulePage() {
  await requireOwner();
  const options = await loadRuleFormOptions();
  return (
    <div className="mx-auto max-w-3xl">
      <RuleForm mode="create" initial={emptyRuleForm()} {...options} onSubmit={saveRuleAction.bind(null, null)} cancelHref="/regole" />
    </div>
  );
}
