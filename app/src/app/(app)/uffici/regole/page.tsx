import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ListChecks } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { PrintButton } from "@/components/print-button";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { listAssets } from "@/modules/assets";
import { DEFAULT_REVIEW_MONTHS, REVIEW_MONTHS_CHOICES, reviewRules } from "@/modules/offices";
import { isUuid } from "@/lib/ids";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("offices.rules");
  return { title: t("title") };
}

const date = (v: string) => new Date(`${v}T00:00:00`).toLocaleDateString("it-IT");

export default async function RuleReviewPage({ searchParams }: PageProps<"/uffici/regole">) {
  await requireOwner();
  const t = await getTranslations("offices.rules");
  const tr = await getTranslations("rules");
  const params = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const assetParam = first(params.immobile);
  const assetId = isUuid(assetParam) ? assetParam : undefined;
  const monthsParam = Number(first(params.mesi));
  const months = (REVIEW_MONTHS_CHOICES as readonly number[]).includes(monthsParam) ? monthsParam : DEFAULT_REVIEW_MONTHS;

  const db = getDb();
  const [assets, review] = await Promise.all([listAssets(db), reviewRules(db, { assetId, maxAgeMonths: months })]);
  const rows = review?.rows ?? [];
  const counts = review?.counts ?? { unverified: 0, no_check_date: 0, stale: 0, recent: 0 };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <PrintButton />
      </div>
      <p className="text-sm text-muted-foreground">{t("intro")}</p>

      <form method="get" className="flex flex-wrap items-end gap-3 print:hidden" role="search">
        <div className="flex w-64 flex-col gap-2">
          <Label htmlFor="immobile">{t("assetLabel")}</Label>
          <NativeSelect id="immobile" name="immobile" defaultValue={assetId ?? ""}>
            <option value="">{t("allRules")}</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex w-52 flex-col gap-2">
          <Label htmlFor="mesi">{t("monthsLabel")}</Label>
          <NativeSelect id="mesi" name="mesi" defaultValue={String(months)}>
            {REVIEW_MONTHS_CHOICES.map((m) => (
              <option key={m} value={m}>
                {t("months", { count: m })}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" variant="secondary">
          {t("apply")}
        </Button>
      </form>

      {review && review.territoryLabels.length > 0 ? <p className="text-sm">{t("territory", { labels: review.territoryLabels.join(" › ") })}</p> : null}
      {rows.length > 0 ? <p className="text-sm" data-testid="review-summary">{t("summary", { unverified: counts.unverified, noDate: counts.no_check_date, stale: counts.stale, months, recent: counts.recent })}</p> : null}

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
          <ListChecks className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">{t("empty")}</p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border" data-testid="review-list">
          {rows.map((r) => (
            <li key={r.ruleId} className="flex flex-col gap-1 p-4">
              <span className="flex flex-wrap items-center gap-2">
                <Link href={`/regole/${r.ruleId}`} className="font-medium underline underline-offset-2">
                  {r.title}
                </Link>
                <Badge variant="secondary">{tr(`level.${r.level}`)}</Badge>
                <Badge variant={r.state === "recent" ? "outline" : "destructive"}>{t(`state.${r.state}`)}</Badge>
              </span>
              <span className="text-sm text-muted-foreground">
                {[
                  r.territoryLabel ?? t("everywhere"),
                  tr(`verification.${r.verificationStatus}`),
                  t("version", { no: r.versionNo }),
                  r.lastCheckedOn ? t("lastChecked", { date: date(r.lastCheckedOn) }) : t("neverChecked"),
                  t("inserted", { date: date(r.insertedOn) }),
                ].join(" · ")}
              </span>
              <span className="text-sm">
                {t("source", { source: r.sourceText })}
                {r.sourceUrl ? (
                  <>
                    {" "}
                    <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 print:hidden">
                      {t("sourceLink")}
                    </a>
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
