import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Pencil } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { listDocumentOptions } from "@/modules/documents";
import { getDeadlineDetail, todayInItaly, type Explanation } from "@/modules/deadlines";
import { describeTerritories } from "@/modules/territory";
import { isUuid } from "@/lib/ids";
import { TraceText } from "../../regole/_components/condition-text";
import { AddOccurrence, ArchiveDeadlineButton, OccurrenceControls } from "../_components/occurrence-controls";

type Props = PageProps<"/scadenze/[id]">;

async function load(id: string) {
  if (!isUuid(id)) return null;
  return getDeadlineDetail(getDb(), id);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: (await load((await params).id))?.deadline.title ?? "Scadenza" };
}

const date = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });

export default async function DeadlinePage({ params }: Props) {
  await requireOwner();
  const { id } = await params;
  const detail = await load(id);
  if (!detail) notFound();
  const t = await getTranslations("deadlines");
  const td = await getTranslations("deadlines.detail");
  const tr = await getTranslations("rules");
  const tc = await getTranslations("calc");
  const ti = await getTranslations("dossier.item");
  const { deadline, occurrences } = detail;
  const today = todayInItaly();

  const documents = (await listDocumentOptions(getDb())).map((d) => ({ id: d.value, label: d.label }));
  const kindLabels = { owner: t("completion.owner"), auto_verified: t("completion.auto_verified"), professional_validated: t("completion.professional_validated") };
  const exp = deadline.explanation as Explanation | null;
  const territoryIds = exp?.territoryId ? [exp.territoryId] : [];
  const territory = territoryIds.length > 0 ? (await describeTerritories(getDb(), territoryIds))[0]?.label : null;

  const calcText =
    deadline.calc.type === "fixed_annual"
      ? `${tc("types.fixed_annual")}: ${deadline.calc.day} ${tc(`months.${deadline.calc.month as 1}`)}`
      : deadline.calc.type === "manual"
        ? tc("types.manual")
        : `${tc(`types.${deadline.calc.type}`)}: ${deadline.calc.type === "relative_to" ? deadline.calc.offset.amount : deadline.calc.every.amount} ${tc(`units.${deadline.calc.type === "relative_to" ? deadline.calc.offset.unit : deadline.calc.every.unit}`)} (${deadline.calc.anchor.kind === "date" ? date(deadline.calc.anchor.date) : deadline.calc.anchor.name})`;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{deadline.title}</h1>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{t(`category.${deadline.category}`)}</Badge>
            <Badge variant="secondary">{tr(`level.${deadline.level}`)}</Badge>
            <Badge variant="outline">{t(`priority.${deadline.priority}`)}</Badge>
            <Badge variant="outline">{deadline.origin === "rule" ? t("badges.rule") : t("badges.manual")}</Badge>
            {deadline.stale ? <Badge variant="destructive">{t("badges.stale")}</Badge> : null}
            {deadline.archived ? <Badge variant="destructive">{t("badges.archived")}</Badge> : null}
          </div>
        </div>
        <div className="flex gap-2 print:hidden">
          <Link href={`/scadenze/${deadline.id}/modifica`} className={buttonVariants({ variant: "outline" })}>
            <Pencil aria-hidden /> {td("edit")}
          </Link>
          <ArchiveDeadlineButton deadlineId={deadline.id} archived={deadline.archived} />
        </div>
      </div>

      {deadline.stale ? (
        <Alert>
          <AlertDescription>{td("staleHelp")}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{td("details")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[11rem_1fr]">
            {deadline.description ? (
              <>
                <dt className="text-muted-foreground">{t("form.description")}</dt>
                <dd className="whitespace-pre-wrap">{deadline.description}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">{td("asset")}</dt>
            <dd>{deadline.assetId && deadline.assetName ? <Link href={`/immobili/${deadline.assetId}`} className="underline underline-offset-2">{deadline.assetName}</Link> : t("form.noAsset")}</dd>
            <dt className="text-muted-foreground">{td("when")}</dt>
            <dd>{calcText}{deadline.shiftToBusinessDay ? ` · ${tc("shiftNote")}` : ""}</dd>
            <dt className="text-muted-foreground">{td("leadDays")}</dt>
            <dd>{deadline.leadDays.length > 0 ? td("leadDaysValue", { days: deadline.leadDays.join(", ") }) : "—"}</dd>
            {deadline.legalBasis ? (
              <>
                <dt className="text-muted-foreground">{td("basis")}</dt>
                <dd>{deadline.legalBasis}</dd>
              </>
            ) : null}
            {deadline.responsibleName ? (
              <>
                <dt className="text-muted-foreground">{td("responsible")}</dt>
                <dd>{deadline.responsibleName}</dd>
              </>
            ) : null}
            {deadline.professionalName ? (
              <>
                <dt className="text-muted-foreground">{td("professional")}</dt>
                <dd>{deadline.professionalName}</dd>
              </>
            ) : null}
            {deadline.consequences ? (
              <>
                <dt className="text-muted-foreground">{td("consequences")}</dt>
                <dd>{deadline.consequences}</dd>
              </>
            ) : null}
            {deadline.requiredDocuments ? (
              <>
                <dt className="text-muted-foreground">{td("documents")}</dt>
                <dd>{deadline.requiredDocuments}</dd>
              </>
            ) : null}
          </dl>
          {exp ? (
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer font-medium">{td("why")}</summary>
              <div className="mt-2 flex flex-col gap-2">
                <p>{ti("ruleLine", { title: exp.ruleTitle, number: exp.versionNo })}</p>
                <p>{ti("verification", { status: tr(`verification.${exp.verificationStatus}`) })}</p>
                {territory ? <p>{ti("territory", { territory })}</p> : null}
                <p>{ti("source", { source: exp.sourceText })}</p>
                {exp.trace ? <TraceText trace={exp.trace} /> : <p className="text-muted-foreground">{ti("noConditions")}</p>}
              </div>
            </details>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{td("occurrences")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {occurrences.length === 0 ? <p className="text-sm text-muted-foreground">{td("noOccurrences")}</p> : null}
          <ul className="flex flex-col divide-y" data-testid="occurrences">
            {occurrences.map((o) => (
              <li key={o.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0" data-testid="occurrence">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{date(o.dueOn)}</span>
                  {o.status === "open" && o.overdue ? <Badge variant="destructive">{t("status.overdue")}</Badge> : <Badge variant={o.status === "done" ? "secondary" : "outline"}>{t(`status.${o.status}` as "status.open", { date: o.snoozedUntil ?? "" })}</Badge>}
                  {o.status === "open" && o.snoozedUntil && o.snoozedUntil > today ? <Badge variant="outline">{t("status.snoozed", { date: date(o.snoozedUntil) })}</Badge> : null}
                  {o.status === "done" && o.completionKind ? <Badge variant="outline">{t(`completion.${o.completionKind}`)}</Badge> : null}
                  {o.status === "done" && o.completedOn ? <span className="text-sm text-muted-foreground">{td("completedOn", { date: date(o.completedOn) })}</span> : null}
                </div>
                {o.note ? <p className="text-sm text-muted-foreground">{o.note}</p> : null}
                <div className="text-sm">
                  <span className="font-medium">{td("proofs")}: </span>
                  {o.proofs.length === 0 ? (
                    <span className="text-muted-foreground">{td("noProofs")}</span>
                  ) : (
                    <ul className="ml-5 list-disc">
                      {o.proofs.map((p) => (
                        <li key={p.id}>
                          {p.documentId ? (
                            <Link href={`/documenti/${p.documentId}`} className="underline underline-offset-2">
                              {p.documentTitle ?? p.documentId}
                            </Link>
                          ) : null}
                          {p.documentId && p.reference ? " · " : ""}
                          {p.reference ? td("proofReference", { reference: p.reference }) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <OccurrenceControls deadlineId={deadline.id} occurrenceId={o.id} status={o.status} dueOn={o.dueOn} documents={documents} kindLabels={kindLabels} proofRequired={deadline.proofRequired} />
              </li>
            ))}
          </ul>
          <AddOccurrence deadlineId={deadline.id} />
        </CardContent>
      </Card>
    </div>
  );
}
