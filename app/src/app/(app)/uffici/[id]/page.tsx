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
import { getOfficeDetail } from "@/modules/offices";
import { isUuid } from "@/lib/ids";

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
