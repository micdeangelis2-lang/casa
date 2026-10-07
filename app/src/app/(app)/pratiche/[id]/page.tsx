import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { FileText, Pencil } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { listDocumentOptions } from "@/modules/documents";
import { listDeadlines } from "@/modules/deadlines";
import { listParties } from "@/modules/directory";
import { getMatterDetail } from "@/modules/matters";
import { isUuid } from "@/lib/ids";
import { AssignForm, EventForm, LinkDocumentForm, OpinionForm, RemoveEventButton, RequestForm, ResolveRequest, UnassignButton, UnlinkDocumentButton } from "../_components/matter-controls";

type Props = PageProps<"/pratiche/[id]">;

async function load(id: string) {
  if (!isUuid(id)) return null;
  return getMatterDetail(getDb(), id);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: (await load((await params).id))?.title ?? "Pratica" };
}

const date = (v: string) => new Date(`${v}T00:00:00`).toLocaleDateString("it-IT");

export default async function MatterPage({ params }: Props) {
  await requireOwner();
  const { id } = await params;
  const m = await load(id);
  if (!m) notFound();
  const t = await getTranslations("matters");
  const td = await getTranslations("matters.detail");
  const ta = await getTranslations("avvocato");
  const db = getDb();
  const [parties, documents, allDeadlines] = await Promise.all([listParties(db), listDocumentOptions(db), listDeadlines(db, {})]);
  const linkedDeadlines = allDeadlines.filter((d) => d.matterId === m.id);
  const partyOptions = parties.map((p) => ({ value: p.id, label: p.displayName }));
  const documentOptions = documents;
  const linked = new Set(m.documents.map((d) => d.id));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{m.title}</h1>
          <div className="flex flex-wrap gap-2">
            <Badge variant={m.status === "closed" ? "outline" : "secondary"}>{t(`status.${m.status}`)}</Badge>
            <Badge variant="outline">{t("openedOn", { date: date(m.openedOn) })}</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Link href={`/pratiche/${m.id}/fascicolo`} className={buttonVariants({ variant: "secondary" })}>
            <FileText aria-hidden /> {ta("link")}
          </Link>
          <Link href={`/pratiche/${m.id}/modifica`} className={buttonVariants({ variant: "outline" })}>
            <Pencil aria-hidden /> {td("edit")}
          </Link>
        </div>
      </div>

      {m.closedOn ? (
        <Alert>
          <AlertDescription>{td("closedNotice", { date: date(m.closedOn) })}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{td("details")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[8rem_1fr]">
            <dt className="text-muted-foreground">{td("asset")}</dt>
            <dd>{m.assetId && m.assetName ? <Link href={`/immobili/${m.assetId}`} className="underline underline-offset-2">{m.assetName}</Link> : "—"}</dd>
            <dt className="text-muted-foreground">{td("office")}</dt>
            <dd>{m.officePartyId && m.officeName ? <Link href={`/rubrica/${m.officePartyId}`} className="underline underline-offset-2">{m.officeName}</Link> : "—"}</dd>
            {m.protocolNumber ? (
              <>
                <dt className="text-muted-foreground">{td("protocol")}</dt>
                <dd data-testid="matter-protocol">{m.protocolNumber}</dd>
              </>
            ) : null}
            {m.submittedOn ? (
              <>
                <dt className="text-muted-foreground">{td("submittedOn")}</dt>
                <dd>{date(m.submittedOn)}</dd>
              </>
            ) : null}
            {m.responseDueOn ? (
              <>
                <dt className="text-muted-foreground">{td("responseDueOn")}</dt>
                <dd>{date(m.responseDueOn)}</dd>
              </>
            ) : null}
            {m.description ? (
              <>
                <dt className="text-muted-foreground">{t("form.description")}</dt>
                <dd className="whitespace-pre-wrap">{m.description}</dd>
              </>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{td("people")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {m.assignments.length === 0 ? <p className="text-sm text-muted-foreground">{td("noPeople")}</p> : null}
          <ul className="flex flex-col gap-1 text-sm" data-testid="assignments">
            {m.assignments.map((a) => (
              <li key={a.partyId} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{a.name}</span>
                {a.role ? <span className="text-muted-foreground">– {a.role}</span> : null}
                <UnassignButton matterId={m.id} partyId={a.partyId} name={a.name} />
              </li>
            ))}
          </ul>
          <AssignForm matterId={m.id} parties={partyOptions} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{td("requests")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {m.requests.length === 0 ? <p className="text-sm text-muted-foreground">{td("noRequests")}</p> : null}
          <ul className="flex flex-col divide-y" data-testid="requests">
            {m.requests.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{r.title}</span>
                  <Badge variant={r.status === "received" ? "secondary" : "outline"}>{td(`requestStatus.${r.status}`)}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {[td("requestedOn", { date: date(r.requestedOn) }), r.requestedFromName ? td("requestFromName", { name: r.requestedFromName }) : null, r.dueOn ? td("dueOn", { date: date(r.dueOn) }) : null, r.note].filter(Boolean).join(" · ")}
                </p>
                {r.documentId && r.documentTitle ? (
                  <p className="text-sm">
                    <Link href={`/documenti/${r.documentId}`} className="underline underline-offset-2">
                      {r.documentTitle}
                    </Link>
                  </p>
                ) : null}
                <ResolveRequest matterId={m.id} requestId={r.id} status={r.status} documents={documentOptions} title={r.title} />
              </li>
            ))}
          </ul>
          <RequestForm matterId={m.id} parties={partyOptions} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{td("opinions")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{td("opinionsNote")}</p>
          {m.opinions.length === 0 ? <p className="text-sm text-muted-foreground">{td("noOpinions")}</p> : null}
          <ul className="flex flex-col divide-y" data-testid="opinions">
            {m.opinions.map((o) => (
              <li key={o.id} className="flex flex-col gap-1 py-3 text-sm first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{o.partyName}</span>
                  <Badge variant={o.nature === "formally_validated" ? "secondary" : "outline"}>{td(`nature.${o.nature}`)}</Badge>
                  {o.issuedOn ? <span className="text-muted-foreground">{date(o.issuedOn)}</span> : null}
                </div>
                <p className="whitespace-pre-wrap">{o.summary}</p>
                {o.documentId && o.documentTitle ? (
                  <Link href={`/documenti/${o.documentId}`} className="underline underline-offset-2">
                    {o.documentTitle}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
          <OpinionForm matterId={m.id} parties={partyOptions} documents={documentOptions} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{td("events")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{td("eventsNote")}</p>
          {m.events.length === 0 ? <p className="text-sm text-muted-foreground">{td("noEvents")}</p> : null}
          <ul className="flex flex-col divide-y" data-testid="matter-events">
            {m.events.map((e) => (
              <li key={e.id} className="flex flex-col gap-1 py-3 text-sm first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{td(`eventKinds.${e.kind}`)}</Badge>
                  <span className="font-medium">{e.title}</span>
                  <span className="text-muted-foreground">{date(e.occurredOn)}</span>
                  {e.partyName ? <span className="text-muted-foreground">– {e.partyName}</span> : null}
                  <RemoveEventButton matterId={m.id} eventId={e.id} title={e.title} />
                </div>
                {e.note ? <p className="whitespace-pre-wrap">{e.note}</p> : null}
                {e.documentId && e.documentTitle ? (
                  <Link href={`/documenti/${e.documentId}`} className="underline underline-offset-2">
                    {e.documentTitle}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
          <EventForm matterId={m.id} parties={partyOptions} documents={documentOptions} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{td("deadlines")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {linkedDeadlines.length === 0 ? <p className="text-sm text-muted-foreground">{td("noDeadlines")}</p> : null}
          <ul className="flex flex-col gap-1 text-sm" data-testid="matter-deadlines">
            {linkedDeadlines.map((d) => (
              <li key={d.id}>
                <Link href={`/scadenze/${d.id}`} className="font-medium underline underline-offset-2">
                  {d.title}
                </Link>
              </li>
            ))}
          </ul>
          <div className="print:hidden">
            <Link href={`/scadenze/nuova?pratica=${m.id}${m.assetId ? `&immobile=${m.assetId}` : ""}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
              {td("newDeadline")}
            </Link>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{td("documents")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {m.documents.length === 0 ? <p className="text-sm text-muted-foreground">{td("noDocuments")}</p> : null}
          <ul className="flex flex-col gap-1 text-sm" data-testid="matter-documents">
            {m.documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2">
                <Link href={`/documenti/${d.id}`} className="underline underline-offset-2">
                  {d.title}
                </Link>
                <UnlinkDocumentButton matterId={m.id} documentId={d.id} title={d.title} />
              </li>
            ))}
          </ul>
          <LinkDocumentForm matterId={m.id} documents={documentOptions.filter((d) => !linked.has(d.value))} />
        </CardContent>
      </Card>
    </div>
  );
}
