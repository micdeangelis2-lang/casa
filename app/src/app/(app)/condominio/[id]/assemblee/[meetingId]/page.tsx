import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { listParties } from "@/modules/directory";
import { listDocumentOptions } from "@/modules/documents";
import { RESOLUTION_OUTCOMES, formatMilli, getCondominiumDetail, getMeetingDetail } from "@/modules/condominium";
import { ActionButton } from "@/components/action-button";
import { InlineForm } from "@/components/inline-form";
import type { FieldSpec } from "@/components/simple-form";
import { isUuid } from "@/lib/ids";
import { formatDate } from "@/lib/format";
import {
  addAgendaItemAction,
  addProxyAction,
  addResolutionAction,
  agendaDocumentAction,
  linkAgendaDocumentAction,
  removeAgendaItemAction,
  removeProxyAction,
  resolutionBudgetAction,
  resolutionDeadlineAction,
  updateAgendaItemAction,
  updateMeetingAction,
  updateResolutionAction,
} from "../../../actions";
import { meetingFields, meetingValues } from "../../../_components/meeting-form-data";

type Props = PageProps<"/condominio/[id]/assemblee/[meetingId]">;

async function load(id: string, meetingId: string) {
  if (!isUuid(id) || !isUuid(meetingId)) return null;
  const meeting = await getMeetingDetail(getDb(), meetingId);
  return meeting && meeting.condominiumId === id ? meeting : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id, meetingId } = await params;
  const m = await load(id, meetingId);
  const t = await getTranslations("condominium.meetings");
  return { title: m ? t("onDate", { kind: t(`kind.${m.kind}`).toLowerCase(), date: formatDate(m.meetingOn) }) : "Assemblea" };
}

const milli = (v: number | null) => (v === null ? "—" : formatMilli(v));
const milliInput = (v: number | null) => (v === null ? "" : formatMilli(v));

export default async function MeetingPage({ params }: Props) {
  await requireOwner();
  const { id, meetingId } = await params;
  const m = await load(id, meetingId);
  if (!m) notFound();
  const t = await getTranslations("condominium.meetings");
  const tm = await getTranslations("condominium.meeting");
  const db = getDb();
  const [condo, parties, documents] = await Promise.all([getCondominiumDetail(db, id), listParties(db), listDocumentOptions(db)]);
  const budgets = (condo?.years ?? []).flatMap((y) => y.budgets.map((b) => ({ value: b.id, label: `${y.label} – ${b.title}` })));
  const documentOptions = documents;
  const agendaOptions = m.agenda.map((a) => ({ value: a.id, label: a.title }));
  const heading = t("onDate", { kind: t(`kind.${m.kind}`).toLowerCase(), date: formatDate(m.meetingOn) });

  const resolutionFields: FieldSpec[] = [
    { kind: "text", name: "title", label: tm("resolutionTitle"), maxLength: 300 },
    { kind: "textarea", name: "text", label: tm("resolutionText"), maxLength: 3000 },
    { kind: "select", name: "agendaItemId", label: tm("resolutionAgenda"), options: agendaOptions, emptyLabel: tm("resolutionNoAgenda") },
    { kind: "select", name: "outcome", label: tm("resolutionOutcome"), options: RESOLUTION_OUTCOMES.map((o) => ({ value: o, label: tm(`outcome.${o}`) })) },
    { kind: "text", name: "votesFor", label: tm("votesFor"), inputMode: "decimal", maxLength: 12 },
    { kind: "text", name: "votesAgainst", label: tm("votesAgainst"), inputMode: "decimal", maxLength: 12 },
    { kind: "text", name: "votesAbstain", label: tm("votesAbstain"), inputMode: "decimal", maxLength: 12 },
    { kind: "text", name: "threshold", label: tm("threshold"), inputMode: "decimal", maxLength: 12 },
    { kind: "text", name: "thresholdNote", label: tm("thresholdNote"), maxLength: 300 },
  ];

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link href={`/condominio/${id}?sezione=assemblee`} className={buttonVariants({ variant: "ghost", size: "sm" }) + " w-fit print:hidden"}>
          <ArrowLeft aria-hidden /> {tm("back")}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={m.status === "convened" ? "secondary" : "outline"}>{t(`status.${m.status}`)}</Badge>
          <span className="text-muted-foreground">{[m.condominiumName, m.location, m.convenedOn ? `${t("convenedOn")} ${formatDate(m.convenedOn)}` : null].filter(Boolean).join(" · ")}</span>
        </div>
        <p className="flex flex-wrap gap-4 text-sm">
          {m.convocationDocumentId && m.convocationTitle ? (
            <Link href={`/documenti/${m.convocationDocumentId}`} className="underline underline-offset-2">
              {t("convocation")}: {m.convocationTitle}
            </Link>
          ) : null}
          {m.minutesDocumentId && m.minutesTitle ? (
            <Link href={`/documenti/${m.minutesDocumentId}`} className="underline underline-offset-2">
              {t("minutes")}: {m.minutesTitle}
            </Link>
          ) : null}
        </p>
        {m.notes ? <p className="whitespace-pre-wrap text-sm text-muted-foreground">{m.notes}</p> : null}
        <details className="print:hidden">
          <summary className="cursor-pointer text-sm font-medium">{tm("edit")}</summary>
          <InlineForm key={JSON.stringify(meetingValues(m))} idPrefix="meeting-edit" title={tm("editHeading")} fields={await meetingFields()} initial={meetingValues(m)} submitLabel={tm("edit")} onSubmit={updateMeetingAction.bind(null, id, meetingId)} />
        </details>
      </div>

      <Card data-testid="preparation">
        <CardHeader>
          <CardTitle>
            <h2>{tm("prepare")}</h2>
          </CardTitle>
          <p className="text-sm text-muted-foreground">{tm("prepareIntro")}</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <div>
            <h3 className="font-medium">{tm("toRead")}</h3>
            {m.preparation.documentsToRead.length === 0 ? <p className="text-muted-foreground">{tm("noToRead")}</p> : null}
            <ul className="mt-1 flex flex-col gap-1">
              {m.preparation.documentsToRead.map((d) => (
                <li key={`${d.agendaTitle}-${d.id}`}>
                  <Link href={`/documenti/${d.id}`} className="underline underline-offset-2">
                    {d.title}
                  </Link>{" "}
                  <span className="text-muted-foreground">({d.agendaTitle})</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-medium">{tm("questions")}</h3>
            {m.preparation.questions.length === 0 ? <p className="text-muted-foreground">{tm("noQuestions")}</p> : null}
            <ul className="mt-1 flex flex-col gap-1">
              {m.preparation.questions.map((q) => (
                <li key={q.agendaTitle}>
                  <span className="font-medium">{q.agendaTitle}:</span> <span className="whitespace-pre-wrap">{q.text}</span>
                </li>
              ))}
            </ul>
          </div>
          {m.preparation.itemsWithoutDocuments.length > 0 ? (
            <div>
              <h3 className="font-medium">{tm("withoutDocs")}</h3>
              <p className="text-muted-foreground">{m.preparation.itemsWithoutDocuments.join(" · ")}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{tm("agenda")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {m.agenda.length === 0 ? <p className="text-sm text-muted-foreground">{tm("noAgenda")}</p> : null}
          <ol className="flex flex-col gap-4" data-testid="agenda">
            {m.agenda.map((a, index) => {
              const linked = new Set(a.documents.map((d) => d.id));
              return (
                <li key={a.id} className="flex flex-col gap-2 rounded-lg border p-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {index + 1}. {a.title}
                    </span>
                    <ActionButton action={removeAgendaItemAction.bind(null, id, meetingId, a.id)} srLabel={a.title}>
                      {tm("itemRemove")}
                    </ActionButton>
                  </div>
                  {a.description ? <p className="whitespace-pre-wrap text-muted-foreground">{a.description}</p> : null}
                  {a.questions ? <p className="whitespace-pre-wrap">{a.questions}</p> : null}
                  <ul className="flex flex-col gap-1">
                    {a.documents.map((d) => (
                      <li key={d.id} className="flex flex-wrap items-center gap-2">
                        <Link href={`/documenti/${d.id}`} className="underline underline-offset-2">
                          {d.title}
                        </Link>
                        <ActionButton action={agendaDocumentAction.bind(null, id, meetingId, a.id, d.id, false)} srLabel={d.title}>
                          {tm("itemUnlink")}
                        </ActionButton>
                      </li>
                    ))}
                  </ul>
                  <InlineForm
                    idPrefix={`agenda-doc-${a.id}`}
                    title={tm("itemDocument")}
                    fields={[{ kind: "select", name: "documentId", label: tm("itemDocument"), options: documentOptions.filter((d) => !linked.has(d.value)), emptyLabel: "—" }]}
                    initial={{ documentId: "" }}
                    submitLabel={tm("itemDocumentButton")}
                    onSubmit={linkAgendaDocumentAction.bind(null, id, meetingId, a.id)}
                  />
                  <details className="print:hidden">
                    <summary className="cursor-pointer text-muted-foreground">
                      {tm("itemSave")}
                      <span className="sr-only">: {a.title}</span>
                    </summary>
                    <InlineForm
                      key={`${a.id}-${a.title}-${a.description}-${a.questions}`}
                      idPrefix={`agenda-edit-${a.id}`}
                      title={tm("itemSave")}
                      fields={[
                        { kind: "text", name: "title", label: tm("itemTitle"), maxLength: 300 },
                        { kind: "textarea", name: "description", label: tm("itemDescription"), maxLength: 1000 },
                        { kind: "textarea", name: "questions", label: tm("itemQuestions"), maxLength: 1500 },
                      ]}
                      initial={{ title: a.title, description: a.description ?? "", questions: a.questions ?? "" }}
                      submitLabel={tm("itemSave")}
                      onSubmit={updateAgendaItemAction.bind(null, id, meetingId, a.id)}
                    />
                  </details>
                </li>
              );
            })}
          </ol>
          <InlineForm
            idPrefix="agenda-add"
            title={tm("itemAdd")}
            fields={[
              { kind: "text", name: "title", label: tm("itemTitle"), maxLength: 300 },
              { kind: "textarea", name: "description", label: tm("itemDescription"), maxLength: 1000 },
              { kind: "textarea", name: "questions", label: tm("itemQuestions"), maxLength: 1500 },
            ]}
            initial={{ title: "", description: "", questions: "" }}
            submitLabel={tm("itemAdd")}
            onSubmit={addAgendaItemAction.bind(null, id, meetingId)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{tm("proxies")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {m.proxies.length === 0 ? <p className="text-sm text-muted-foreground">{tm("noProxies")}</p> : null}
          <ul className="flex flex-col gap-1 text-sm" data-testid="proxies">
            {m.proxies.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{p.delegateName}</span>
                {p.note ? <span className="text-muted-foreground">– {p.note}</span> : null}
                <ActionButton action={removeProxyAction.bind(null, id, meetingId, p.id)} srLabel={p.delegateName}>
                  {tm("proxyRemove")}
                </ActionButton>
              </li>
            ))}
          </ul>
          <InlineForm
            idPrefix="proxy"
            title={tm("proxyAdd")}
            fields={[
              { kind: "select", name: "delegatePartyId", label: tm("proxyDelegate"), options: parties.map((p) => ({ value: p.id, label: p.displayName })), emptyLabel: tm("proxyChoose") },
              { kind: "text", name: "note", label: tm("proxyNote"), maxLength: 500 },
            ]}
            initial={{ delegatePartyId: "", note: "" }}
            submitLabel={tm("proxyAdd")}
            onSubmit={addProxyAction.bind(null, id, meetingId)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{tm("resolutions")}</h2>
          </CardTitle>
          <p className="text-sm text-muted-foreground">{tm("resolutionsNote")}</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {m.resolutions.length === 0 ? <p className="text-sm text-muted-foreground">{tm("noResolutions")}</p> : null}
          <ul className="flex flex-col gap-4" data-testid="resolutions">
            {m.resolutions.map((r) => (
              <li key={r.id} className="flex flex-col gap-3 rounded-lg border p-4 text-sm" data-testid="resolution">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.title}</span>
                  <Badge variant={r.outcome === "not_recorded" ? "outline" : "secondary"}>{tm(`outcome.${r.outcome}`)}</Badge>
                  {r.agendaTitle ? <span className="text-muted-foreground">({r.agendaTitle})</span> : null}
                </div>
                {r.text ? <p className="whitespace-pre-wrap">{r.text}</p> : null}
                {r.votesFor !== null || r.votesAgainst !== null || r.votesAbstain !== null ? <p>{tm("recorded", { for: milli(r.votesFor), against: milli(r.votesAgainst), abstain: milli(r.votesAbstain) })}</p> : null}
                {r.threshold !== null ? (
                  <p>
                    {tm("thresholdLine", { threshold: milli(r.threshold) })}
                    {r.thresholdNote ? ` (${r.thresholdNote})` : ""}
                    {r.check.forReachesThreshold === null ? "" : ` – ${r.check.forReachesThreshold ? tm("reaches") : tm("below")}`}
                  </p>
                ) : null}
                {r.check.attention ? (
                  <Alert>
                    <AlertDescription>
                      <span className="font-medium">{tm("attention")}: </span>
                      {r.check.attention}
                    </AlertDescription>
                  </Alert>
                ) : null}

                <div className="flex flex-col gap-2 border-t pt-3">
                  <h3 className="font-medium">{tm("followUp")}</h3>
                  {!r.deadlineLinked && !r.budgetTitle ? <p className="text-muted-foreground">{tm("followUpNone")}</p> : null}
                  {r.deadlineLinked ? (
                    <p>
                      {tm("linkedDeadline")} –{" "}
                      <Link href="/scadenze" className="underline underline-offset-2">
                        {tm("followUpDeadline")}
                      </Link>
                    </p>
                  ) : (
                    <InlineForm
                      idPrefix={`res-deadline-${r.id}`}
                      title={tm("followUpAdd")}
                      fields={[
                        { kind: "text", name: "title", label: tm("followUpTitle"), maxLength: 200 },
                        { kind: "date", name: "dueOn", label: tm("followUpDue") },
                      ]}
                      initial={{ title: "", dueOn: "" }}
                      submitLabel={tm("followUpAdd")}
                      onSubmit={resolutionDeadlineAction.bind(null, id, meetingId, r.id)}
                    />
                  )}
                  {r.budgetTitle ? <p>{tm("linkedBudget", { title: r.budgetTitle })}</p> : null}
                  {budgets.length > 0 ? (
                    <InlineForm
                      key={`${r.id}-${r.budgetId ?? ""}`}
                      idPrefix={`res-budget-${r.id}`}
                      title={tm("followUpBudget")}
                      fields={[{ kind: "select", name: "budgetId", label: tm("followUpBudget"), options: budgets, emptyLabel: tm("followUpBudgetChoose") }]}
                      initial={{ budgetId: r.budgetId ?? "" }}
                      submitLabel={tm("followUpBudgetSave")}
                      onSubmit={resolutionBudgetAction.bind(null, id, meetingId, r.id)}
                    />
                  ) : null}
                </div>

                <details className="print:hidden">
                  <summary className="cursor-pointer text-muted-foreground">
                    {tm("outcomeUpdate")}
                    <span className="sr-only">: {r.title}</span>
                  </summary>
                  <InlineForm
                    key={`${r.id}-${r.outcome}-${r.votesFor}-${r.votesAgainst}-${r.votesAbstain}-${r.threshold}`}
                    idPrefix={`res-edit-${r.id}`}
                    title={tm("outcomeUpdate")}
                    fields={resolutionFields}
                    initial={{
                      title: r.title,
                      text: r.text ?? "",
                      agendaItemId: r.agendaItemId ?? "",
                      outcome: r.outcome,
                      votesFor: milliInput(r.votesFor),
                      votesAgainst: milliInput(r.votesAgainst),
                      votesAbstain: milliInput(r.votesAbstain),
                      threshold: milliInput(r.threshold),
                      thresholdNote: r.thresholdNote ?? "",
                    }}
                    submitLabel={tm("outcomeUpdate")}
                    onSubmit={updateResolutionAction.bind(null, id, meetingId, r.id)}
                  />
                </details>
              </li>
            ))}
          </ul>
          <InlineForm
            idPrefix="resolution-add"
            title={tm("resolutionAdd")}
            fields={resolutionFields}
            initial={{ title: "", text: "", agendaItemId: "", outcome: "not_recorded", votesFor: "", votesAgainst: "", votesAbstain: "", threshold: "", thresholdNote: "" }}
            submitLabel={tm("resolutionAdd")}
            onSubmit={addResolutionAction.bind(null, id, meetingId)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
