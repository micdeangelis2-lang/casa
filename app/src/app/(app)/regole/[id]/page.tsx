import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Pencil } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { getRule } from "@/modules/rules";
import { isUuid } from "@/lib/ids";
import { ConditionText } from "../_components/condition-text";
import { OutcomeList } from "../_components/outcome-list";
import { RuleActions, VerificationForm } from "../_components/rule-controls";

type Props = PageProps<"/regole/[id]">;

async function load(id: string) {
  if (!isUuid(id)) return null;
  return getRule(getDb(), id);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const rule = await load((await params).id);
  return { title: rule?.versions[0]?.title ?? "Regola" };
}

const date = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("it-IT");

export default async function RulePage({ params }: Props) {
  await requireOwner();
  const { id } = await params;
  const rule = await load(id);
  if (!rule) notFound();
  const t = await getTranslations("rules");
  const current = rule.versions[0]!;
  const territory = current.territoryId ? (rule.territoryLabels[current.territoryId] ?? "") : t("everywhere");
  const validity =
    !current.validFrom && !current.validTo
      ? t("validity.always")
      : [current.validFrom ? t("validity.from", { date: date(current.validFrom) }) : null, current.validTo ? t("validity.to", { date: date(current.validTo) }) : null].filter(Boolean).join(" ");
  const unverified = current.verificationStatus === "draft" || current.verificationStatus === "to_verify";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{current.title}</h1>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{t(`level.${current.level}`)}</Badge>
            <Badge variant="outline">{unverified ? t("unverified") : t(`verification.${current.verificationStatus}`)}</Badge>
            {rule.active ? null : <Badge variant="destructive">{t("inactiveBadge")}</Badge>}
          </div>
          <p className="font-mono text-xs text-muted-foreground">{rule.key}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/regole/${rule.id}/modifica`} className={buttonVariants({ variant: "outline" })}>
            <Pencil aria-hidden /> {t("detail.edit")}
          </Link>
          <RuleActions ruleId={rule.id} active={rule.active} />
        </div>
      </div>

      {rule.active ? null : (
        <Alert>
          <AlertDescription>{t("detail.inactiveNotice")}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("detail.current", { number: current.versionNo })}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          {current.description ? <p className="whitespace-pre-wrap">{current.description}</p> : null}
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted-foreground">{t("form.territory")}</dt>
            <dd>{territory}</dd>
            <dt className="text-muted-foreground">{t("compare.fields.validity")}</dt>
            <dd>{validity}</dd>
            <dt className="text-muted-foreground">{t("detail.source")}</dt>
            <dd>
              {current.sourceText}
              {current.sourceUrl ? (
                <>
                  {" "}
                  <a href={current.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                    {current.sourceUrl}
                  </a>
                </>
              ) : null}
            </dd>
          </dl>
          <div>
            <h3 className="mb-1 font-medium">{t("detail.when")}</h3>
            <ConditionText condition={current.appliesWhen} />
          </div>
          <div>
            <h3 className="mb-1 font-medium">{t("detail.outcomes")}</h3>
            <OutcomeList outcomes={current.outcomes} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("detail.history")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <ul className="flex flex-col divide-y" data-testid="rule-versions">
            {rule.versions.map((v) => (
              <li key={v.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{t("detail.versionLine", { number: v.versionNo })}</span>
                  <span className="text-muted-foreground">{t("detail.createdOn", { date: v.createdAt.toLocaleDateString("it-IT") })}</span>
                  {v.validFrom || v.validTo ? (
                    <span className="text-muted-foreground">
                      · {[v.validFrom ? t("validity.from", { date: date(v.validFrom) }) : null, v.validTo ? t("validity.to", { date: date(v.validTo) }) : null].filter(Boolean).join(" ")}
                    </span>
                  ) : null}
                </div>
                {v.changeNote ? (
                  <p className="text-sm">
                    <span className="text-muted-foreground">{t("detail.changeNote")}: </span>
                    {v.changeNote}
                  </p>
                ) : null}
                <VerificationForm ruleId={rule.id} versionId={v.id} current={v.verificationStatus} />
              </li>
            ))}
          </ul>

          {rule.versions.length < 2 ? (
            <p className="text-sm text-muted-foreground">{t("detail.onlyOneVersion")}</p>
          ) : (
            <form method="get" action={`/regole/${rule.id}/confronta`} className="flex flex-wrap items-end gap-3" aria-label={t("detail.compare")}>
              <div className="flex flex-col gap-1">
                <Label htmlFor="a">{t("detail.compareA")}</Label>
                <NativeSelect id="a" name="a" defaultValue={String(rule.versions[1]!.versionNo)}>
                  {rule.versions.map((v) => (
                    <option key={v.id} value={v.versionNo}>
                      {t("detail.versionLine", { number: v.versionNo })}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="b">{t("detail.compareB")}</Label>
                <NativeSelect id="b" name="b" defaultValue={String(rule.versions[0]!.versionNo)}>
                  {rule.versions.map((v) => (
                    <option key={v.id} value={v.versionNo}>
                      {t("detail.versionLine", { number: v.versionNo })}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <Button type="submit" variant="secondary">
                {t("detail.compareButton")}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Link href="/regole" className={buttonVariants({ variant: "ghost" })}>
        {t("detail.back")}
      </Link>
    </div>
  );
}
