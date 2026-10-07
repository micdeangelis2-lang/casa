import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Card, CardContent } from "@/components/ui/card";
import { getDb } from "@/platform/db/client";
import { listAssets } from "@/modules/assets";
import { listParties } from "@/modules/directory";
import { listInspectionPlans } from "@/modules/maintenance";
import { ActionButton } from "@/components/action-button";
import { InlineForm } from "@/components/inline-form";
import { formatDate } from "@/lib/format";
import { archivePlanAction, createPlanAction } from "../actions";

export async function SectionInspections() {
  const t = await getTranslations("maintenance.inspections");
  const db = getDb();
  const [plans, assets, parties] = await Promise.all([listInspectionPlans(db), listAssets(db), listParties(db)]);

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
      {plans.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
      <ul className="flex flex-col gap-4" data-testid="plan-list">
        {plans.map((p) => (
          <li key={p.id}>
            <Card>
              <CardContent className="flex flex-col gap-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{p.title}</span>
                  <ActionButton action={archivePlanAction.bind(null, p.id, true)} srLabel={p.title}>
                    {t("archive")}
                  </ActionButton>
                </div>
                <p className="text-muted-foreground">{[p.assetName, p.supplierName, t("every", { months: p.intervalMonths })].filter(Boolean).join(" · ")}</p>
                <p>
                  {p.nextDueOn ? t("next", { date: formatDate(p.nextDueOn) }) : t("noNext")} · {p.lastDoneOn ? t("last", { date: formatDate(p.lastDoneOn) }) : t("noLast")}
                </p>
                {p.note ? <p className="whitespace-pre-wrap">{p.note}</p> : null}
                {p.deadlineId ? (
                  <Link href={`/scadenze/${p.deadlineId}`} className="underline underline-offset-2">
                    {t("openDeadline")}
                  </Link>
                ) : null}
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      <InlineForm
        idPrefix="plan"
        title={t("addHeading")}
        fields={[
          { kind: "select", name: "assetId", label: t("asset"), options: assets.map((a) => ({ value: a.id, label: a.name })), emptyLabel: t("chooseAsset") },
          { kind: "text", name: "title", label: t("title"), maxLength: 200 },
          { kind: "text", name: "intervalMonths", label: t("interval"), inputMode: "numeric", maxLength: 3 },
          { kind: "date", name: "firstDueOn", label: t("firstDue") },
          { kind: "select", name: "supplierPartyId", label: t("supplier"), options: parties.map((p) => ({ value: p.id, label: p.displayName })), emptyLabel: "—" },
          { kind: "text", name: "note", label: t("note"), maxLength: 500 },
        ]}
        initial={{ assetId: "", title: "", intervalMonths: "12", firstDueOn: "", supplierPartyId: "", note: "" }}
        submitLabel={t("add")}
        onSubmit={createPlanAction}
      />
    </div>
  );
}
