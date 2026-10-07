import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, Pencil } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { listDocumentOptions } from "@/modules/documents";
import { CLAIM_STATUSES, ENTRY_DIRECTIONS, getClaimDetail } from "@/modules/insurance";
import { ActionButton } from "@/components/action-button";
import { InlineForm } from "@/components/inline-form";
import { isUuid } from "@/lib/ids";
import { formatDate, formatEuro } from "@/lib/format";
import { addClaimEntryAction, removeClaimEntryAction, setClaimStatusAction } from "../../actions";

type Props = PageProps<"/assicurazioni/sinistri/[claimId]">;

async function load(id: string) {
  return isUuid(id) ? getClaimDetail(getDb(), id) : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: (await load((await params).claimId))?.title ?? "Sinistro" };
}

export default async function ClaimPage({ params }: Props) {
  await requireOwner();
  const { claimId } = await params;
  const c = await load(claimId);
  if (!c) notFound();
  const t = await getTranslations("insurance");
  const td = await getTranslations("insurance.claimDetail");
  const ts = await getTranslations("assicuratore.sheet");
  const documents = await listDocumentOptions(getDb());

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <Link href={`/assicurazioni/${c.policyId}`} className={buttonVariants({ variant: "ghost", size: "sm" }) + " w-fit print:hidden"}>
        <ArrowLeft aria-hidden /> {td("back", { policy: c.policyTitle })}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{c.title}</h1>
          <div className="flex flex-wrap gap-2">
            <Badge variant={c.open ? "secondary" : "outline"}>{t(`claimStatus.${c.status}`)}</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Link href={`/assicurazioni/sinistri/${c.id}/scheda`} className={buttonVariants({ variant: "outline" })}>
            {ts("open")}
          </Link>
          <Link href={`/assicurazioni/sinistri/${c.id}/modifica`} className={buttonVariants({ variant: "outline" })}>
            <Pencil aria-hidden /> {td("edit")}
          </Link>
        </div>
      </div>

      <Alert>
        <AlertDescription>{td("notice")}</AlertDescription>
      </Alert>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[12rem_1fr]">
            <dt className="text-muted-foreground">{td("policy")}</dt>
            <dd>
              <Link href={`/assicurazioni/${c.policyId}`} className="underline underline-offset-2">
                {c.policyTitle}
              </Link>
            </dd>
            <dt className="text-muted-foreground">{td("asset")}</dt>
            <dd>{c.assetId && c.assetName ? <Link href={`/immobili/${c.assetId}`} className="underline underline-offset-2">{c.assetName}</Link> : "—"}</dd>
            <dt className="text-muted-foreground">{td("claimNumber")}</dt>
            <dd>{c.claimNumber ?? "—"}</dd>
            <dt className="text-muted-foreground">{td("occurredOn")}</dt>
            <dd>{formatDate(c.occurredOn)}</dd>
            <dt className="text-muted-foreground">{td("reportedOn")}</dt>
            <dd>{c.reportedOn ? formatDate(c.reportedOn) : "—"}</dd>
            {c.closedOn ? (
              <>
                <dt className="text-muted-foreground">{td("closedOn")}</dt>
                <dd>{formatDate(c.closedOn)}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">{td("claimed")}</dt>
            <dd data-testid="claimed">{c.claimedCents !== null ? `${formatEuro(c.claimedCents)} €` : "—"}</dd>
            <dt className="text-muted-foreground">{td("received")}</dt>
            <dd data-testid="received">{c.receivedCents !== null ? `${formatEuro(c.receivedCents)} €` : "—"}</dd>
            <dt className="text-muted-foreground">{td("adjuster")}</dt>
            <dd>{c.adjusterName ?? "—"}</dd>
            <dt className="text-muted-foreground">{td("matter")}</dt>
            <dd>{c.matterId && c.matterTitle ? <Link href={`/pratiche/${c.matterId}`} className="underline underline-offset-2">{c.matterTitle}</Link> : "—"}</dd>
            {c.description ? (
              <>
                <dt className="text-muted-foreground">{td("description")}</dt>
                <dd className="whitespace-pre-wrap">{c.description}</dd>
              </>
            ) : null}
          </dl>
          <InlineForm
            key={`${c.id}-${c.status}`}
            idPrefix="status"
            title={td("updateStatus")}
            fields={[{ kind: "select", name: "status", label: td("statusLabel"), options: CLAIM_STATUSES.map((s) => ({ value: s, label: t(`claimStatus.${s}`) })) }]}
            initial={{ status: c.status }}
            submitLabel={td("updateStatus")}
            onSubmit={setClaimStatusAction.bind(null, c.id, c.policyId)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{td("entries")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {c.entries.length === 0 ? <p className="text-sm text-muted-foreground">{td("noEntries")}</p> : null}
          <ul className="flex flex-col divide-y" data-testid="entries">
            {c.entries.map((e) => (
              <li key={e.id} className="flex flex-col gap-1 py-3 text-sm first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{formatDate(e.entryOn)}</span>
                  <Badge variant="outline">{td(`direction.${e.direction}`)}</Badge>
                  <ActionButton action={removeClaimEntryAction.bind(null, c.id, e.id)} srLabel={formatDate(e.entryOn)}>
                    {td("remove")}
                  </ActionButton>
                </div>
                <p className="whitespace-pre-wrap">{e.summary}</p>
                {e.documentId && e.documentTitle ? (
                  <Link href={`/documenti/${e.documentId}`} className="underline underline-offset-2">
                    {e.documentTitle}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
          <InlineForm
            idPrefix="entry"
            title={td("entryAdd")}
            fields={[
              { kind: "date", name: "entryOn", label: td("entryDate") },
              { kind: "select", name: "direction", label: td("entryDirection"), options: ENTRY_DIRECTIONS.map((d) => ({ value: d, label: td(`direction.${d}`) })) },
              { kind: "textarea", name: "summary", label: td("entrySummary"), maxLength: 1000 },
              { kind: "select", name: "documentId", label: td("entryDocument"), options: documents, emptyLabel: "—" },
            ]}
            initial={{ entryOn: "", direction: "note", summary: "", documentId: "" }}
            submitLabel={td("entryAdd")}
            onSubmit={addClaimEntryAction.bind(null, c.id)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
