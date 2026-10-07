import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Landmark, Plus } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { listAssets } from "@/modules/assets";
import { listObligations, listTaxTypes, summarize, todayInItaly, yearsWithData } from "@/modules/taxes";
import { isUuid } from "@/lib/ids";
import { formatDate, formatEuro } from "@/lib/format";
import { ObligationBadges } from "./_components/state-badges";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("taxes");
  return { title: t("title") };
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function TaxesPage({ searchParams }: PageProps<"/tributi">) {
  await requireOwner();
  const t = await getTranslations("taxes");
  const params = await searchParams;
  const db = getDb();
  const currentYear = Number(todayInItaly().slice(0, 4));
  const years = await yearsWithData(db);
  const askedYear = first(params.anno);
  const year = askedYear === "tutti" ? undefined : /^\d{4}$/.test(askedYear) ? Number(askedYear) : (years[0] ?? currentYear);
  const assetId = isUuid(first(params.immobile)) ? first(params.immobile) : undefined;
  const [items, assets, types] = await Promise.all([listObligations(db, { year, assetId }), listAssets(db), listTaxTypes(db)]);
  const totals = summarize(items);
  const withoutProof = items.reduce((n, i) => n + i.paymentsWithoutProof, 0);
  const yearOptions = [...new Set([...years, currentYear])].sort((a, b) => b - a);
  const filtering = askedYear !== "" || assetId !== undefined;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <Link href="/tributi/nuovo" className={buttonVariants()}>
          <Plus aria-hidden /> {t("add")}
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
      <Alert>
        <AlertDescription>{t("notice")}</AlertDescription>
      </Alert>

      <nav aria-label={t("title")} className="print:hidden">
        <ul className="flex flex-wrap gap-2">
          {(["types", "returns", "summary"] as const).map((k) => (
            <li key={k}>
              <Link href={k === "types" ? "/tributi/tipi" : k === "returns" ? "/tributi/dichiarazioni" : `/tributi/riepilogo${year ? `?anno=${year}` : ""}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                {t(`links.${k}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {types.length === 0 ? (
        <Alert>
          <AlertDescription>
            {t("noTypes")}{" "}
            <Link href="/tributi/tipi" className="underline underline-offset-2">
              {t("links.types")}
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}

      <form method="get" className="flex flex-wrap items-end gap-3" role="search">
        <div className="flex w-40 flex-col gap-2">
          <Label htmlFor="anno">{t("filters.year")}</Label>
          <NativeSelect id="anno" name="anno" defaultValue={year === undefined ? "tutti" : String(year)}>
            <option value="tutti">{t("filters.allYears")}</option>
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

      {items.length > 0 ? (
        <Card>
          <CardContent>
            <h2 className="sr-only">{t("totals.heading")}</h2>
            <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3" data-testid="tax-totals">
              {[
                [t("totals.expected"), `${formatEuro(totals.expectedCents)} €`],
                [t("totals.paid"), `${formatEuro(totals.paidCents)} €`],
                [t("totals.open"), String(totals.open)],
                [t("totals.overdue"), String(totals.overdue)],
                [t("totals.withoutExpected"), String(totals.withoutExpected)],
                [t("totals.withoutProof"), String(withoutProof)],
              ].map(([label, value]) => (
                <div key={label} className="flex flex-col gap-1">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-lg font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      ) : null}

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
          <Landmark className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">{filtering ? t("noResults") : t("emptyTitle")}</p>
          {filtering ? null : <p className="max-w-md text-sm text-muted-foreground">{t("emptyBody")}</p>}
        </div>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border" data-testid="obligation-list">
          {items.map((o) => (
            <li key={o.id}>
              <Link href={`/tributi/${o.id}`} className="flex flex-col gap-1 p-4 hover:bg-accent/50 focus-visible:bg-accent/50">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {o.typeName} {o.year}
                    {o.label ? ` – ${o.label}` : ""}
                  </span>
                  <ObligationBadges item={o} />
                </span>
                <span className="text-sm text-muted-foreground">
                  {[o.assetName, o.dueOn ? t("dueLine", { date: formatDate(o.dueOn) }) : null, o.expectedCents !== null ? t("amountsLine", { paid: formatEuro(o.paidCents), expected: formatEuro(o.expectedCents) }) : o.paidCents > 0 ? t("paidOnlyLine", { paid: formatEuro(o.paidCents) }) : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
