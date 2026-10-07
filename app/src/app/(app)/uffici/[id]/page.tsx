import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { PrintButton } from "@/components/print-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { ActionButton } from "@/components/action-button";
import { EditInline } from "@/components/edit-inline";
import { InlineForm } from "@/components/inline-form";
import type { FieldSpec } from "@/components/simple-form";
import { RULE_VERIFICATION } from "@/modules/rules";
import { getOfficeDetail, listFormTemplates } from "@/modules/offices";
import { isUuid } from "@/lib/ids";
import { archiveFormTemplateAction, createFormTemplateAction, updateFormTemplateAction } from "./actions";

type Props = PageProps<"/uffici/[id]">;

async function load(id: string) {
  if (!isUuid(id)) return null;
  return getOfficeDetail(getDb(), id);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: (await load((await params).id))?.party.displayName ?? "Ufficio" };
}

const date = (v: string) => new Date(`${v}T00:00:00`).toLocaleDateString("it-IT");

export default async function OfficePage({ params }: Props) {
  await requireOwner();
  const { id } = await params;
  const office = await load(id);
  if (!office) notFound();
  const t = await getTranslations("offices");
  const td = await getTranslations("offices.detail");
  const tm = await getTranslations("matters");
  const tr = await getTranslations("matters.detail");
  const { party, view } = office;
  const tf = await getTranslations("officeForms");
  const tv = await getTranslations("rules.verification");
  const templates = await listFormTemplates(getDb(), { officePartyId: party.id });
  const formFields: FieldSpec[] = [
    { kind: "text", name: "name", label: tf("form.name"), maxLength: 200 },
    { kind: "textarea", name: "checklist", label: tf("form.checklist"), rows: 5, maxLength: 8000 },
    { kind: "text", name: "source", label: tf("form.source"), maxLength: 300 },
    { kind: "date", name: "verifiedOn", label: tf("form.verifiedOn") },
    { kind: "select", name: "verificationStatus", label: tf("form.status"), options: RULE_VERIFICATION.map((s) => ({ value: s, label: tv(s) })) },
    { kind: "text", name: "note", label: tf("form.note"), maxLength: 500 },
  ];
  const contact = [
    [td("address"), party.address],
    [td("phone"), party.phone],
    [td("email"), party.email],
    [td("pec"), party.pec],
    [td("notes"), party.notes],
  ].filter((row): row is [string, string] => Boolean(row[1]));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Link href="/uffici" className="text-sm underline underline-offset-2 print:hidden">
            {td("back")}
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{party.displayName}</h1>
          <p className="text-sm text-muted-foreground">
            {[
              `${t("counts.matters")}: ${view.counts.openMatters}`,
              `${t("counts.requests")}: ${view.counts.openRequests}`,
              `${t("counts.deadlines")}: ${view.counts.openDeadlines}`,
              `${t("counts.overdue")}: ${view.counts.overdue}`,
            ].join(" · ")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Link href={`/rubrica/${party.id}/modifica`} className={buttonVariants({ variant: "outline" })}>
            <Pencil aria-hidden /> {td("editContact")}
          </Link>
          <PrintButton />
        </div>
      </div>

      {contact.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{td("contact")}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[8rem_1fr]">
              {contact.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="whitespace-pre-wrap">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{td("matters")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {view.matters.length === 0 ? <p className="text-sm text-muted-foreground">{td("noMatters")}</p> : null}
          <ul className="flex flex-col divide-y" data-testid="office-matters">
            {view.matters.map((m) => (
              <li key={m.id} className="flex flex-col gap-2 py-3">
                <span className="flex flex-wrap items-center gap-2">
                  <Link href={`/pratiche/${m.id}`} className="font-medium underline underline-offset-2">
                    {m.title}
                  </Link>
                  <Badge variant={m.status === "closed" ? "outline" : "secondary"}>{tm(`status.${m.status}`)}</Badge>
                </span>
                {m.isRecipient ? (
                  <span className="text-sm" data-testid="office-submission">
                    {[td("recipient"), m.protocolNumber ? td("protocol", { number: m.protocolNumber }) : null, m.submittedOn ? td("submittedOn", { date: date(m.submittedOn) }) : null, m.responseDueOn ? td("responseDueOn", { date: date(m.responseDueOn) }) : null].filter(Boolean).join(" · ")}
                  </span>
                ) : null}
                <span className="text-sm text-muted-foreground">
                  {[m.assetName, m.role ? td("role", { role: m.role }) : null, td("openedOn", { date: date(m.openedOn) }), m.closedOn ? td("closedOn", { date: date(m.closedOn) }) : null].filter(Boolean).join(" · ")}
                </span>
                {m.requests.length > 0 ? (
                  <div>
                    <h3 className="text-sm font-medium">{td("requests")}</h3>
                    <ul className="text-sm">
                      {m.requests.map((r) => (
                        <li key={r.id}>
                          {[td("requestLine", { title: r.title, date: date(r.requestedOn) }), tr(`requestStatus.${r.status}`), r.dueOn ? td("requestDue", { date: date(r.dueOn) }) : null, r.documentTitle].filter(Boolean).join(" · ")}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {m.opinions.length > 0 ? (
                  <div>
                    <h3 className="text-sm font-medium">{td("opinions")}</h3>
                    <ul className="text-sm">
                      {m.opinions.map((o) => (
                        <li key={o.id}>
                          {[td("opinionLine", { nature: tr(`nature.${o.nature}`), summary: o.summary }), o.issuedOn ? td("issuedOn", { date: date(o.issuedOn) }) : null, o.documentTitle].filter(Boolean).join(" · ")}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">{td("protocolNote")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{tf("title")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{tf("intro")}</p>
          {templates.length === 0 ? <p className="text-sm text-muted-foreground">{tf("empty")}</p> : null}
          <ul className="flex flex-col gap-4" data-testid="office-forms">
            {templates.map((f) => (
              <li key={f.id} className="flex flex-col gap-2 rounded-lg border p-4 text-sm" data-state={f.state}>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{f.name}</span>
                  <Badge variant="outline">{tv(f.verificationStatus)}</Badge>
                  <Badge variant={f.state === "recent" ? "secondary" : "outline"}>{tf(`state.${f.state}`)}</Badge>
                </span>
                <span className="text-muted-foreground">
                  {[f.source ? tf("source", { source: f.source }) : tf("noSource"), f.verifiedOn ? tf("verifiedOn", { date: date(f.verifiedOn) }) : tf("noVerifiedOn")].join(" · ")}
                </span>
                <span className="font-medium">{tf("checklist")}</span>
                {f.checklist.length === 0 ? (
                  <span className="text-muted-foreground">{tf("noChecklist")}</span>
                ) : (
                  <ul className="list-disc pl-5" data-testid="office-form-checklist">
                    {f.checklist.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                )}
                {f.note ? <span className="whitespace-pre-wrap">{f.note}</span> : null}
                <div className="flex flex-wrap items-start gap-3">
                  <EditInline
                    idPrefix={`form-edit-${f.id}`}
                    title={tf("edit.title", { name: f.name })}
                    openLabel={tf("edit.open")}
                    cancelLabel={tf("edit.cancel")}
                    srLabel={f.name}
                    submitLabel={tf("edit.save")}
                    fields={formFields}
                    initial={{ name: f.name, checklist: f.checklist.join("\n"), source: f.source ?? "", verifiedOn: f.verifiedOn ?? "", verificationStatus: f.verificationStatus, note: f.note ?? "" }}
                    onSubmit={updateFormTemplateAction.bind(null, party.id, f.id)}
                  />
                  <ActionButton action={archiveFormTemplateAction.bind(null, party.id, f.id)} srLabel={f.name}>
                    {tf("archive")}
                  </ActionButton>
                </div>
              </li>
            ))}
          </ul>
          <InlineForm
            idPrefix="office-form"
            title={tf("form.title")}
            fields={formFields}
            initial={{ name: "", checklist: "", source: "", verifiedOn: "", verificationStatus: "to_verify", note: "" }}
            submitLabel={tf("form.submit")}
            onSubmit={createFormTemplateAction.bind(null, party.id)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{td("deadlines")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {view.deadlines.length === 0 ? <p className="text-sm text-muted-foreground">{td("noDeadlines")}</p> : null}
          <ul className="flex flex-col gap-1 text-sm" data-testid="office-deadlines">
            {view.deadlines.map((d) => (
              <li key={d.occurrenceId} className="flex flex-wrap items-center gap-2">
                <Link href={`/scadenze/${d.deadlineId}`} className="font-medium underline underline-offset-2">
                  {d.title}
                </Link>
                <span className="text-muted-foreground">{[date(d.dueOn), d.assetName].filter(Boolean).join(" · ")}</span>
                {d.overdue ? <Badge variant="destructive">{td("overdue")}</Badge> : null}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
