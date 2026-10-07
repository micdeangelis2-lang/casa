import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { ScrollRegion } from "@/components/scroll-region";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { getRule, type RuleVersion } from "@/modules/rules";
import { isUuid } from "@/lib/ids";
import { ConditionText } from "../../_components/condition-text";
import { OutcomeList } from "../../_components/outcome-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("rules.compare");
  return { title: t("title") };
}

const date = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("it-IT");
const canonical = (value: unknown): string =>
  JSON.stringify(value ?? null, (_k, v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));

export default async function ComparePage({ params, searchParams }: PageProps<"/regole/[id]/confronta">) {
  await requireOwner();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const rule = await getRule(getDb(), id);
  if (!rule) notFound();
  const query = await searchParams;
  const number = (v: string | string[] | undefined) => Number(Array.isArray(v) ? v[0] : v);
  const a = rule.versions.find((v) => v.versionNo === number(query.a));
  const b = rule.versions.find((v) => v.versionNo === number(query.b));
  if (!a || !b) notFound();
  const t = await getTranslations("rules");

  const validity = (v: RuleVersion) =>
    !v.validFrom && !v.validTo ? t("validity.always") : [v.validFrom ? t("validity.from", { date: date(v.validFrom) }) : null, v.validTo ? t("validity.to", { date: date(v.validTo) }) : null].filter(Boolean).join(" ");
  const territory = (v: RuleVersion) => (v.territoryId ? (rule.territoryLabels[v.territoryId] ?? "") : t("everywhere"));

  const rows: { field: string; differs: boolean; render: (v: RuleVersion) => React.ReactNode }[] = [
    { field: t("compare.fields.title"), differs: a.title !== b.title, render: (v) => v.title },
    { field: t("compare.fields.description"), differs: (a.description ?? "") !== (b.description ?? ""), render: (v) => v.description ?? "—" },
    { field: t("compare.fields.level"), differs: a.level !== b.level, render: (v) => t(`level.${v.level}`) },
    { field: t("compare.fields.territory"), differs: a.territoryId !== b.territoryId, render: territory },
    { field: t("compare.fields.validity"), differs: validity(a) !== validity(b), render: validity },
    { field: t("compare.fields.appliesWhen"), differs: canonical(a.appliesWhen) !== canonical(b.appliesWhen), render: (v) => <ConditionText condition={v.appliesWhen} /> },
    { field: t("compare.fields.outcomes"), differs: canonical(a.outcomes) !== canonical(b.outcomes), render: (v) => <OutcomeList outcomes={v.outcomes} /> },
    { field: t("compare.fields.source"), differs: a.sourceText !== b.sourceText || a.sourceUrl !== b.sourceUrl, render: (v) => [v.sourceText, v.sourceUrl].filter(Boolean).join(" · ") },
    { field: t("compare.fields.verification"), differs: a.verificationStatus !== b.verificationStatus, render: (v) => t(`verification.${v.verificationStatus}`) },
  ];
  const anyDifference = rows.some((r) => r.differs);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("compare.title")}</h1>
      <p className="text-sm text-muted-foreground">{b.title}</p>
      {anyDifference ? null : <p>{t("compare.same")}</p>}
      <ScrollRegion label={t("compare.title")}>
        <table className="w-full text-left text-sm" data-testid="compare-table">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className="py-2 pr-4 font-medium">{t("compare.field")}</th>
              <th className="py-2 pr-4 font-medium">{t("detail.versionLine", { number: a.versionNo })}</th>
              <th className="py-2 font-medium">{t("detail.versionLine", { number: b.versionNo })}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.field} className={`border-b align-top last:border-0 ${r.differs ? "bg-accent/40" : ""}`}>
                <th scope="row" className="py-2 pr-4 font-medium">
                  {r.field} {r.differs ? <Badge variant="outline">{t("compare.differs")}</Badge> : null}
                </th>
                <td className="py-2 pr-4">{r.render(a)}</td>
                <td className="py-2">{r.render(b)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
      <Link href={`/regole/${rule.id}`} className={buttonVariants({ variant: "ghost" })}>
        {t("compare.back")}
      </Link>
    </div>
  );
}
