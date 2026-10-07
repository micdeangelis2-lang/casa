import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { listClaims, listPolicies } from "@/modules/insurance";
import { cn } from "@/lib/utils";
import { formatDate, formatEuro } from "@/lib/format";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("insurance");
  return { title: t("title") };
}

const SECTIONS = ["policies", "claims"] as const;
type Section = (typeof SECTIONS)[number];
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function InsurancePage({ searchParams }: PageProps<"/assicurazioni">) {
  await requireOwner();
  const t = await getTranslations("insurance");
  const tb = await getTranslations("assicuratore.byAsset");
  const params = await searchParams;
  const section: Section = (SECTIONS as readonly string[]).includes(first(params.sezione)) ? (first(params.sezione) as Section) : "policies";
  const showAll = first(params.tutte) === "1";
  const db = getDb();

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <div className="flex flex-wrap gap-2">
          <Link href="/assicurazioni/sinistri/nuovo" className={buttonVariants({ variant: "outline" })}>
            <Plus aria-hidden /> {t("addClaim")}
          </Link>
          <Link href="/assicurazioni/nuova" className={buttonVariants()}>
            <Plus aria-hidden /> {t("addPolicy")}
          </Link>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
      <Link href="/assicurazioni/per-immobile" className="w-fit text-sm underline underline-offset-2">
        {tb("open")}
      </Link>

      <nav aria-label={t("sectionsLabel")}>
        <ul className="flex flex-wrap gap-2">
          {SECTIONS.map((s) => (
            <li key={s}>
              <Link href={s === "policies" ? "/assicurazioni" : `/assicurazioni?sezione=${s}`} aria-current={s === section ? "page" : undefined} className={cn(buttonVariants({ variant: s === section ? "secondary" : "outline", size: "sm" }), s === section && "font-semibold")}>
                {t(`sections.${s}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <form method="get" className="flex flex-wrap items-center gap-3" role="search">
        {section === "claims" ? <input type="hidden" name="sezione" value="claims" /> : null}
        <input id="tutte" name="tutte" type="checkbox" value="1" defaultChecked={showAll} className="size-4" />
        <Label htmlFor="tutte">{section === "policies" ? t("showArchived") : t("showClosed")}</Label>
        <Button type="submit" variant="secondary" size="sm">
          {t("apply")}
        </Button>
      </form>

      {section === "policies" ? await Policies({ showAll }) : await Claims({ showAll })}
    </div>
  );

  async function Policies({ showAll }: { showAll: boolean }) {
    const policies = await listPolicies(db, showAll);
    if (policies.length === 0) {
      return (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
          <ShieldCheck className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">{t("emptyPolicies")}</p>
          <p className="max-w-md text-sm text-muted-foreground">{t("emptyPoliciesBody")}</p>
        </div>
      );
    }
    return (
      <ul className="flex flex-col divide-y rounded-lg border" data-testid="policy-list">
        {policies.map((p) => (
          <li key={p.id}>
            <Link href={`/assicurazioni/${p.id}`} className="flex flex-col gap-1 p-4 hover:bg-accent/50 focus-visible:bg-accent/50">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{p.title}</span>
                <Badge variant={p.state === "expired" ? "outline" : p.state === "expiring" ? "destructive" : "secondary"}>{t(`state.${p.state}`)}</Badge>
                {p.archived ? <Badge variant="outline">{t("archivedBadge")}</Badge> : null}
                {p.openClaims > 0 ? <Badge variant="outline">{t("openClaims", { count: p.openClaims })}</Badge> : null}
              </span>
              <span className="text-sm text-muted-foreground">
                {[
                  p.insurerName,
                  p.assets.length > 0 ? p.assets.map((a) => a.name).join(", ") : null,
                  p.endsOn ? t("endsOn", { date: formatDate(p.endsOn) }) : null,
                  p.nextPremium ? t(p.nextPremium.overdue ? "nextPremiumOverdue" : "nextPremium", { date: formatDate(p.nextPremium.dueOn), amount: formatEuro(p.nextPremium.amountCents) }) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    );
  }

  async function Claims({ showAll }: { showAll: boolean }) {
    const claims = await listClaims(db, { includeClosed: showAll });
    if (claims.length === 0) return <p className="text-sm text-muted-foreground">{t("emptyClaims")}</p>;
    return (
      <ul className="flex flex-col divide-y rounded-lg border" data-testid="claim-list">
        {claims.map((c) => (
          <li key={c.id}>
            <Link href={`/assicurazioni/sinistri/${c.id}`} className="flex flex-col gap-1 p-4 hover:bg-accent/50 focus-visible:bg-accent/50">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{c.title}</span>
                <Badge variant={c.open ? "secondary" : "outline"}>{t(`claimStatus.${c.status}`)}</Badge>
              </span>
              <span className="text-sm text-muted-foreground">{[c.policyTitle, c.assetName, t("occurredOn", { date: formatDate(c.occurredOn) }), c.claimedCents !== null ? t("claimedLine", { amount: formatEuro(c.claimedCents) }) : null].filter(Boolean).join(" · ")}</span>
            </Link>
          </li>
        ))}
      </ul>
    );
  }
}
