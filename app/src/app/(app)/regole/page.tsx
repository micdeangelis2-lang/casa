import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ListChecks, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { RULE_LEVELS, RULE_VERIFICATION, listRules, type RuleLevel, type RuleVerification } from "@/modules/rules";
import { ReevaluateAll, SeedRules } from "./_components/rule-controls";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("rules");
  return { title: t("title") };
}

const date = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("it-IT");

export default async function RulesPage({ searchParams }: PageProps<"/regole">) {
  await requireOwner();
  const t = await getTranslations("rules");
  const params = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

  const level = (RULE_LEVELS as readonly string[]).includes(first(params.livello)) ? (first(params.livello) as RuleLevel) : undefined;
  const status = (RULE_VERIFICATION as readonly string[]).includes(first(params.verifica)) ? (first(params.verifica) as RuleVerification) : undefined;
  const includeInactive = first(params.disattivate) === "1";

  const all = await listRules(getDb());
  const rules = all.filter((r) => (includeInactive || r.active) && (!level || r.current.level === level) && (!status || r.current.verificationStatus === status));
  const filtering = Boolean(level || status || includeInactive);

  const validity = (from: string | null, to: string | null) =>
    !from && !to ? t("validity.always") : [from ? t("validity.from", { date: date(from) }) : null, to ? t("validity.to", { date: date(to) }) : null].filter(Boolean).join(" ");

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <Link href="/regole/nuova" className={buttonVariants()}>
          <Plus aria-hidden /> {t("add")}
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">{t("intro")}</p>

      <form method="get" className="flex flex-wrap items-end gap-3" role="search">
        <div className="flex w-52 flex-col gap-2">
          <Label htmlFor="livello">{t("filters.level")}</Label>
          <NativeSelect id="livello" name="livello" defaultValue={level ?? ""}>
            <option value="">{t("filters.allLevels")}</option>
            {RULE_LEVELS.map((l) => (
              <option key={l} value={l}>
                {t(`level.${l}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex w-56 flex-col gap-2">
          <Label htmlFor="verifica">{t("filters.status")}</Label>
          <NativeSelect id="verifica" name="verifica" defaultValue={status ?? ""}>
            <option value="">{t("filters.allStatuses")}</option>
            {RULE_VERIFICATION.map((s) => (
              <option key={s} value={s}>
                {t(`verification.${s}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex items-center gap-2 pb-1.5">
          <input id="disattivate" name="disattivate" type="checkbox" value="1" defaultChecked={includeInactive} className="size-4" />
          <Label htmlFor="disattivate">{t("filters.showInactive")}</Label>
        </div>
        <Button type="submit" variant="secondary">
          {t("filters.apply")}
        </Button>
      </form>

      {rules.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
          <ListChecks className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">{filtering ? t("noResults") : t("emptyTitle")}</p>
          {filtering ? null : <p className="max-w-md text-sm text-muted-foreground">{t("emptyBody")}</p>}
        </div>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border" data-testid="rule-list">
          {rules.map((r) => (
            <li key={r.id}>
              <Link href={`/regole/${r.id}`} className="flex flex-col gap-1 p-4 hover:bg-accent/50 focus-visible:bg-accent/50">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.current.title}</span>
                  <Badge variant="secondary">{t(`level.${r.current.level}`)}</Badge>
                  {r.current.verificationStatus === "draft" || r.current.verificationStatus === "to_verify" ? (
                    <Badge variant="outline">{t("unverified")}</Badge>
                  ) : (
                    <Badge variant="outline">{t(`verification.${r.current.verificationStatus}`)}</Badge>
                  )}
                  {r.active ? null : <Badge variant="destructive">{t("inactiveBadge")}</Badge>}
                </span>
                <span className="text-sm text-muted-foreground">
                  {[r.territoryLabel ?? t("everywhere"), validity(r.current.validFrom, r.current.validTo), t("versionCount", { count: r.versionCount })].join(" · ")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <section className="flex flex-col gap-3 rounded-lg border p-4" aria-labelledby="seed-heading">
        <h2 id="seed-heading" className="text-lg font-medium">
          {t("seed.heading")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("seed.body")}</p>
        <SeedRules />
      </section>

      <ReevaluateAll />
    </div>
  );
}
