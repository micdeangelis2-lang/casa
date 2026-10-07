import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { getRule } from "@/modules/rules";
import { isUuid } from "@/lib/ids";
import { RuleForm } from "../../_components/rule-form";
import { loadRuleFormOptions } from "../../_components/form-options";
import { saveRuleAction } from "../../actions";
import { versionToForm } from "../../rule-form-state";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("rules.form");
  return { title: t("titleEdit") };
}

export default async function EditRulePage({ params }: PageProps<"/regole/[id]/modifica">) {
  await requireOwner();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const rule = await getRule(getDb(), id);
  if (!rule) notFound();
  const options = await loadRuleFormOptions();
  const latest = rule.versions[0]!;

  return (
    <div className="mx-auto max-w-3xl">
      <RuleForm
        mode="edit"
        initial={versionToForm(latest, latest.territoryId ? (rule.territoryLabels[latest.territoryId] ?? null) : null)}
        {...options}
        nextVersionNo={latest.versionNo + 1}
        onSubmit={saveRuleAction.bind(null, id)}
        cancelHref={`/regole/${id}`}
      />
    </div>
  );
}
