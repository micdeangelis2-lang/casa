import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { getDb } from "@/platform/db/client";
import { listAssets } from "@/modules/assets";
import { WORK_STATUSES, listWorks } from "@/modules/maintenance";
import { isUuid } from "@/lib/ids";
import { formatDate, formatEuro } from "@/lib/format";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export async function SectionWorks({ params }: { params: Record<string, string | string[] | undefined> }) {
  const t = await getTranslations("maintenance");
  const status = (WORK_STATUSES as readonly string[]).includes(first(params.stato)) ? first(params.stato) : undefined;
  const assetId = isUuid(first(params.immobile)) ? first(params.immobile) : undefined;
  const includeClosed = first(params.chiusi) === "1";
  const db = getDb();
  const [works, assets] = await Promise.all([listWorks(db, { status, assetId, includeClosed }), listAssets(db)]);
  const filtering = Boolean(status || assetId || includeClosed);

  return (
    <>
      <form method="get" className="flex flex-wrap items-end gap-3" role="search">
        <div className="flex w-48 flex-col gap-2">
          <Label htmlFor="stato">{t("filters.status")}</Label>
          <NativeSelect id="stato" name="stato" defaultValue={status ?? ""}>
            <option value="">{t("filters.openOnes")}</option>
            {WORK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex w-56 flex-col gap-2">
          <Label htmlFor="immobile">{t("filters.asset")}</Label>
          <NativeSelect id="immobile" name="immobile" defaultValue={assetId ?? ""}>
            <option value="">{t("filters.allAssets")}</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex items-center gap-2 pb-1.5">
          <input id="chiusi" name="chiusi" type="checkbox" value="1" defaultChecked={includeClosed} className="size-4" />
          <Label htmlFor="chiusi">{t("filters.closed")}</Label>
        </div>
        <Button type="submit" variant="secondary">
          {t("filters.apply")}
        </Button>
      </form>

      {works.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
          <Wrench className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">{filtering ? t("noResults") : t("emptyTitle")}</p>
          {filtering ? null : <p className="max-w-md text-sm text-muted-foreground">{t("emptyBody")}</p>}
        </div>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border" data-testid="work-list">
          {works.map((w) => (
            <li key={w.id}>
              <Link href={`/manutenzioni/${w.id}`} className="flex flex-col gap-1 p-4 hover:bg-accent/50 focus-visible:bg-accent/50">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{w.title}</span>
                  <Badge variant={w.status === "completed" || w.status === "cancelled" ? "outline" : "secondary"}>{t(`status.${w.status}`)}</Badge>
                </span>
                <span className="text-sm text-muted-foreground">
                  {[
                    w.assetName,
                    w.supplierName,
                    w.scheduledOn ? t("line.scheduled", { date: formatDate(w.scheduledOn) }) : null,
                    w.budgetCents !== null ? t("line.budget", { amount: formatEuro(w.budgetCents) }) : null,
                    w.acceptedQuotesCents > 0 ? t("line.accepted", { amount: formatEuro(w.acceptedQuotesCents) }) : null,
                    w.invoicedCents > 0 ? t("line.invoiced", { amount: formatEuro(w.invoicedCents) }) : null,
                    w.lastPercent !== null ? t("line.progress", { percent: w.lastPercent }) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
