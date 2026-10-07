import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Download } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { todayInItaly } from "@/platform/clock";
import { listAssets } from "@/modules/assets";
import { COST_AREAS, economyYears, getEconomy, type Area } from "@/modules/economy";
import { PrintButton } from "@/components/print-button";
import { ScrollRegion } from "@/components/scroll-region";
import { isUuid } from "@/lib/ids";
import { formatDate, formatEuro } from "@/lib/format";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("economy");
  return { title: t("title") };
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Dove sta la scheda di origine di un movimento. */
const HREF: Record<Area, string> = { taxes: "/tributi", insurance: "/assicurazioni", maintenance: "/manutenzioni", condominium: "/condominio", lettings: "/locazioni" };

export default async function EconomyPage({ searchParams }: PageProps<"/economia">) {
  await requireOwner();
  const t = await getTranslations("economy");
  const tc = await getTranslations("commercialista");
  const params = await searchParams;
  const db = getDb();
  const currentYear = Number(todayInItaly().slice(0, 4));
  const years = await economyYears(db);
  const asked = first(params.anno);
  const year = /^\d{4}$/.test(asked) ? Number(asked) : (years[0] ?? currentYear);
  const assetId = isUuid(first(params.immobile)) ? first(params.immobile) : undefined;
  const [view, assets] = await Promise.all([getEconomy(db, year, assetId), listAssets(db)]);
  const yearOptions = [...new Set([...years, currentYear, year])].sort((a, b) => b - a);
  const money = (cents: number) => t("amount", { amount: formatEuro(cents) });
  const rowName = (r: { assetId: string | null; assetName: string }) => (r.assetId === null ? t("table.unassigned") : r.assetName);
  const csvHref = `/api/economia?anno=${year}${assetId ? `&immobile=${assetId}` : ""}`;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <Alert>
        <AlertDescription>{t("intro")}</AlertDescription>
      </Alert>

      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <form method="get" className="flex flex-wrap items-end gap-3" role="search">
          <div className="flex w-40 flex-col gap-2">
            <Label htmlFor="anno">{t("filters.year")}</Label>
            <NativeSelect id="anno" name="anno" defaultValue={String(year)}>
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
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
          <Button type="submit" variant="secondary">
            {t("filters.apply")}
          </Button>
        </form>
        <PrintButton />
        <Link href={`/economia/dossier?anno=${year}`} className={buttonVariants({ variant: "outline" })}>
          {tc("title")}
        </Link>
        <a href={csvHref} className={buttonVariants({ variant: "outline" })}>
          <Download aria-hidden /> {t("csv")}
        </a>
      </div>

      <section aria-labelledby="table-heading" className="flex flex-col gap-3">
        <h2 id="table-heading" className="sr-only">
          {t("table.caption")}
        </h2>
        <ScrollRegion label={t("table.caption")}>
          <table className="w-full text-left text-sm" data-testid="economy-table">
            <caption className="sr-only">{t("table.caption")}</caption>
            <thead>
              <tr className="border-b">
                <th scope="col" className="py-2 pr-4 font-medium">
                  {t("table.asset")}
                </th>
                {COST_AREAS.map((a) => (
                  <th key={a} scope="col" className="py-2 pr-4 text-right font-medium">
                    {t(`areas.${a}`)}
                  </th>
                ))}
                <th scope="col" className="py-2 pr-4 text-right font-medium">
                  {t("table.costsTotal")}
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">
                  {t("table.income")}
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  {t("table.balance")}
                </th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((r) => (
                <tr key={r.assetId ?? "unassigned"} className="border-b">
                  <th scope="row" className="py-2 pr-4 font-normal">
                    {rowName(r)}
                    {r.assetId === null ? <span className="block text-xs text-muted-foreground">{t("table.unassignedHint")}</span> : null}
                  </th>
                  {COST_AREAS.map((a) => (
                    <td key={a} className="py-2 pr-4 text-right">
                      {money(r.costs[a])}
                    </td>
                  ))}
                  <td className="py-2 pr-4 text-right font-medium">{money(r.costsTotal)}</td>
                  <td className="py-2 pr-4 text-right">{money(r.income)}</td>
                  <td className="py-2 text-right font-medium">{money(r.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <th scope="row" className="py-2 pr-4">
                  {t("table.total")}
                </th>
                {COST_AREAS.map((a) => (
                  <td key={a} className="py-2 pr-4 text-right">
                    {money(view.totals.costs[a])}
                  </td>
                ))}
                <td className="py-2 pr-4 text-right" data-testid="total-costs">
                  {money(view.totals.costsTotal)}
                </td>
                <td className="py-2 pr-4 text-right" data-testid="total-income">
                  {money(view.totals.income)}
                </td>
                <td className="py-2 text-right" data-testid="total-balance">
                  {money(view.totals.balance)}
                </td>
              </tr>
            </tfoot>
          </table>
        </ScrollRegion>
        <p className="text-xs text-muted-foreground">{t("datesNote")}</p>
      </section>

      <section aria-labelledby="entries-heading" className="flex flex-col gap-3">
        <h2 id="entries-heading" className="text-lg font-medium">
          {t("entries.heading")}
        </h2>
        {view.entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty", { year })}</p>
        ) : (
          <ScrollRegion label={t("entries.heading")}>
            <table className="w-full text-left text-sm" data-testid="economy-entries">
              <thead>
                <tr className="border-b">
                  {(["date", "area", "description", "asset"] as const).map((c) => (
                    <th key={c} scope="col" className="py-2 pr-4 font-medium">
                      {t(`entries.${c}`)}
                    </th>
                  ))}
                  <th scope="col" className="py-2 text-right font-medium">
                    {t("entries.amount")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.entries.map((e) => (
                  <tr key={`${e.area}-${e.id}`} className="border-b align-top">
                    <td className="py-2 pr-4">{formatDate(e.date)}</td>
                    <td className="py-2 pr-4">{t(`areas.${e.area}`)}</td>
                    <td className="py-2 pr-4">
                      <Link href={`${HREF[e.area]}/${e.refId}`} className="underline underline-offset-2">
                        {e.label}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">{e.assetName ?? t("table.unassigned")}</td>
                    <td className="py-2 text-right">{money(e.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}
      </section>
    </div>
  );
}
