import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PrintButton } from "@/components/print-button";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { policiesByAsset, type OverviewPolicy } from "@/modules/insurance";
import { formatDate, formatEuro } from "@/lib/format";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("assicuratore.byAsset");
  return { title: t("title") };
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function PoliciesByAssetPage({ searchParams }: PageProps<"/assicurazioni/per-immobile">) {
  await requireOwner();
  const t = await getTranslations("assicuratore.byAsset");
  const ti = await getTranslations("insurance");
  const params = await searchParams;
  const onlyMissing = first(params.senza) === "1";
  const { rows, withoutAsset } = await policiesByAsset(getDb());
  const none = rows.filter((r) => r.status === "none").length;
  const notCurrent = rows.filter((r) => r.status === "notCurrent").length;
  const shown = onlyMissing ? rows.filter((r) => r.status === "none") : rows;

  const period = (p: OverviewPolicy) => (p.startsOn && p.endsOn ? t("period", { from: formatDate(p.startsOn), to: formatDate(p.endsOn) }) : p.endsOn ? t("periodUntil", { date: formatDate(p.endsOn) }) : p.startsOn ? t("periodFrom", { date: formatDate(p.startsOn) }) : t("periodNone"));

  const policyBlock = (p: OverviewPolicy) => (
    <li key={p.id} className="flex flex-col gap-1 p-4 text-sm">
      <span className="flex flex-wrap items-center gap-2">
        <Link href={`/assicurazioni/${p.id}`} className="font-medium underline underline-offset-2">
          {p.title}
        </Link>
        <Badge variant={p.state === "expired" ? "outline" : p.state === "expiring" ? "destructive" : "secondary"}>{ti(`state.${p.state}`)}</Badge>
      </span>
      <span className="text-muted-foreground">
        {[
          p.insurerName ? `${t("policy.insurer")}: ${p.insurerName}` : null,
          p.policyNumber ? `${t("policy.number")}: ${p.policyNumber}` : null,
          period(p),
          p.premiumCents !== null ? `${t("policy.premium")}: ${t("amount", { amount: formatEuro(p.premiumCents) })}` : null,
          p.openClaims > 0 ? `${t("policy.openClaims")}: ${p.openClaims}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </span>
      <span className="font-medium">{t("coverages")}</span>
      {p.coverages.length === 0 ? (
        <span className="text-muted-foreground">{t("noCoverages")}</span>
      ) : (
        <ul className="list-disc pl-5">
          {p.coverages.map((c, i) => (
            <li key={i}>
              {[c.title, c.sumInsuredCents !== null ? t("coverage.sum", { amount: formatEuro(c.sumInsuredCents) }) : null, c.deductibleCents !== null ? t("coverage.deductible", { amount: formatEuro(c.deductibleCents) }) : null].filter(Boolean).join(" — ")}
            </li>
          ))}
        </ul>
      )}
    </li>
  );

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <Link href="/assicurazioni" className={buttonVariants({ variant: "ghost", size: "sm" }) + " w-fit print:hidden"}>
        <ArrowLeft aria-hidden /> {t("back")}
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <PrintButton />
      </div>
      <Alert>
        <AlertDescription>{t("intro")}</AlertDescription>
      </Alert>
      <p className="text-sm" data-testid="by-asset-summary">
        {t("summary", { total: rows.length, none, notCurrent })}
      </p>

      <form method="get" className="flex flex-wrap items-center gap-3 print:hidden" role="search">
        <input id="senza" name="senza" type="checkbox" value="1" defaultChecked={onlyMissing} className="size-4" />
        <Label htmlFor="senza">{t("onlyMissing")}</Label>
        <Button type="submit" variant="secondary" size="sm">
          {t("apply")}
        </Button>
      </form>

      {rows.length === 0 ? <p className="text-sm text-muted-foreground">{t("emptyAssets")}</p> : null}
      {rows.length > 0 && shown.length === 0 ? <p className="text-sm text-muted-foreground">{t("noMatch")}</p> : null}
      <ul className="flex flex-col gap-4" data-testid="by-asset-list">
        {shown.map((r) => (
          <li key={r.assetId} className="rounded-lg border" data-status={r.status}>
            <div className="flex flex-wrap items-center gap-2 border-b p-4">
              <h2 className="font-medium">
                <Link href={`/immobili/${r.assetId}`} className="underline underline-offset-2">
                  {r.assetName}
                </Link>
              </h2>
              <Badge variant={r.status === "current" ? "secondary" : "outline"}>{t(`status.${r.status}`)}</Badge>
              <Link href={`/condivisione/nuovo?immobile=${r.assetId}&destinatario=insurer`} className="ml-auto text-sm underline underline-offset-2 print:hidden">
                {t("sheetsLink")}
              </Link>
            </div>
            {r.policies.length > 0 ? <ul className="divide-y">{r.policies.map(policyBlock)}</ul> : null}
          </li>
        ))}
      </ul>

      {withoutAsset.length > 0 && !onlyMissing ? (
        <section className="flex flex-col gap-2" data-testid="without-asset">
          <h2 className="text-lg font-medium">{t("withoutAsset")}</h2>
          <p className="text-sm text-muted-foreground">{t("withoutAssetHint")}</p>
          <ul className="divide-y rounded-lg border">{withoutAsset.map(policyBlock)}</ul>
        </section>
      ) : null}
    </div>
  );
}
