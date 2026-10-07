import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Pencil, Plus } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { listDocumentOptions } from "@/modules/documents";
import { getPolicyDetail } from "@/modules/insurance";
import { ActionButton } from "@/components/action-button";
import { InlineForm } from "@/components/inline-form";
import { isUuid } from "@/lib/ids";
import { formatDate, formatEuro } from "@/lib/format";
import { addCoverageAction, addPremiumAction, archivePolicyAction, createPolicyDeadlineAction, removeCoverageAction, removePremiumAction, setPremiumPaidAction } from "../actions";

type Props = PageProps<"/assicurazioni/[id]">;

async function load(id: string) {
  return isUuid(id) ? getPolicyDetail(getDb(), id) : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: (await load((await params).id))?.title ?? "Polizza" };
}

export default async function PolicyPage({ params }: Props) {
  await requireOwner();
  const { id } = await params;
  const p = await load(id);
  if (!p) notFound();
  const t = await getTranslations("insurance");
  const td = await getTranslations("insurance.detail");
  const documents = await listDocumentOptions(getDb());

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{p.title}</h1>
          <div className="flex flex-wrap gap-2">
            <Badge variant={p.state === "expired" ? "outline" : p.state === "expiring" ? "destructive" : "secondary"}>{t(`state.${p.state}`)}</Badge>
            {p.archived ? <Badge variant="outline">{t("archivedBadge")}</Badge> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Link href={`/assicurazioni/${p.id}/modifica`} className={buttonVariants({ variant: "outline" })}>
            <Pencil aria-hidden /> {td("edit")}
          </Link>
          <ActionButton variant="outline" size="default" action={archivePolicyAction.bind(null, p.id, !p.archived)}>
            {p.archived ? td("restore") : td("archive")}
          </ActionButton>
        </div>
      </div>

      <Alert>
        <AlertDescription>{td("notice")}</AlertDescription>
      </Alert>

      <Card>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[12rem_1fr]">
            <dt className="text-muted-foreground">{td("insurer")}</dt>
            <dd>{p.insurerName ?? "—"}</dd>
            <dt className="text-muted-foreground">{td("agent")}</dt>
            <dd>{p.agentName ?? "—"}</dd>
            <dt className="text-muted-foreground">{td("number")}</dt>
            <dd>{p.policyNumber ?? "—"}</dd>
            <dt className="text-muted-foreground">{td("period")}</dt>
            <dd>{p.startsOn || p.endsOn ? `${p.startsOn ? formatDate(p.startsOn) : "…"} – ${p.endsOn ? formatDate(p.endsOn) : "…"}` : "—"}</dd>
            <dt className="text-muted-foreground">{td("premium")}</dt>
            <dd>{p.premiumCents !== null ? `${formatEuro(p.premiumCents)} €` : "—"}</dd>
            <dt className="text-muted-foreground">{td("assets")}</dt>
            <dd data-testid="policy-assets">
              {p.assets.length === 0
                ? "—"
                : p.assets.map((a, i) => (
                    <span key={a.id}>
                      {i > 0 ? ", " : ""}
                      <Link href={`/immobili/${a.id}`} className="underline underline-offset-2">
                        {a.name}
                      </Link>
                    </span>
                  ))}
            </dd>
            <dt className="text-muted-foreground">{td("document")}</dt>
            <dd>
              {p.documentId && p.documentTitle ? (
                <Link href={`/documenti/${p.documentId}`} className="underline underline-offset-2">
                  {p.documentTitle}
                </Link>
              ) : (
                "—"
              )}
            </dd>
            {p.note ? (
              <>
                <dt className="text-muted-foreground">{td("note")}</dt>
                <dd className="whitespace-pre-wrap">{p.note}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">{td("renewal")}</dt>
            <dd>
              {p.deadlineId ? (
                <Link href={`/scadenze/${p.deadlineId}`} className="underline underline-offset-2">
                  {td("openDeadline")}
                </Link>
              ) : p.endsOn ? (
                <ActionButton variant="outline" action={createPolicyDeadlineAction.bind(null, p.id)}>
                  {td("createDeadline")}
                </ActionButton>
              ) : (
                <span className="text-muted-foreground">{td("deadlineNeedsDate")}</span>
              )}
            </dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{td("coverages")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{td("coveragesNote")}</p>
          {p.coverages.length === 0 ? <p className="text-sm text-muted-foreground">{td("noCoverages")}</p> : null}
          <ul className="flex flex-col divide-y" data-testid="coverages">
            {p.coverages.map((c) => (
              <li key={c.id} className="flex flex-col gap-1 py-3 text-sm first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{c.title}</span>
                  {c.assetId ? <Badge variant="outline">{p.assets.find((a) => a.id === c.assetId)?.name ?? "—"}</Badge> : null}
                  <ActionButton action={removeCoverageAction.bind(null, p.id, c.id)} srLabel={c.title}>
                    {td("remove")}
                  </ActionButton>
                </div>
                <p className="text-muted-foreground">{[c.sumInsuredCents !== null ? td("sumInsured", { amount: formatEuro(c.sumInsuredCents) }) : null, c.deductibleCents !== null ? td("deductible", { amount: formatEuro(c.deductibleCents) }) : null, c.note].filter(Boolean).join(" · ")}</p>
              </li>
            ))}
          </ul>
          <InlineForm
            idPrefix="coverage"
            title={td("coverageAdd")}
            fields={[
              { kind: "text", name: "title", label: td("coverageTitle"), maxLength: 200 },
              ...(p.assets.length > 1 ? [{ kind: "select" as const, name: "assetId", label: td("coverageAsset"), options: p.assets.map((a) => ({ value: a.id, label: a.name })), emptyLabel: td("coverageAssetAll") }] : []),
              { kind: "text", name: "sumInsured", label: td("coverageSum"), inputMode: "decimal", maxLength: 14 },
              { kind: "text", name: "deductible", label: td("coverageDeductible"), inputMode: "decimal", maxLength: 14 },
              { kind: "text", name: "note", label: td("coverageNote"), maxLength: 500 },
            ]}
            initial={{ title: "", assetId: "", sumInsured: "", deductible: "", note: "" }}
            submitLabel={td("coverageAdd")}
            onSubmit={addCoverageAction.bind(null, p.id)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{td("premiums")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {p.premiums.length === 0 ? <p className="text-sm text-muted-foreground">{td("noPremiums")}</p> : null}
          <ul className="flex flex-col divide-y" data-testid="premiums">
            {p.premiums.map((x) => (
              <li key={x.id} className="flex flex-col gap-1 py-3 text-sm first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{td("premiumLine", { date: formatDate(x.dueOn), amount: formatEuro(x.amountCents) })}</span>
                  <Badge variant={x.paidOn ? "secondary" : x.overdue ? "destructive" : "outline"}>{x.paidOn ? td("paidOn", { date: formatDate(x.paidOn) }) : x.overdue ? td("overdue") : td("toPay")}</Badge>
                  {x.documentId && x.documentTitle ? (
                    <Link href={`/documenti/${x.documentId}`} className="underline underline-offset-2">
                      {x.documentTitle}
                    </Link>
                  ) : null}
                  <ActionButton action={removePremiumAction.bind(null, p.id, x.id)} srLabel={td("premiumLine", { date: formatDate(x.dueOn), amount: formatEuro(x.amountCents) })}>
                    {td("remove")}
                  </ActionButton>
                </div>
                {x.paidOn ? null : (
                  <details className="print:hidden">
                    <summary className="cursor-pointer text-muted-foreground">
                      {td("markPaid")}
                      <span className="sr-only">: {td("premiumLine", { date: formatDate(x.dueOn), amount: formatEuro(x.amountCents) })}</span>
                    </summary>
                    <InlineForm
                      idPrefix={`paid-${x.id}`}
                      title={td("markPaid")}
                      fields={[
                        { kind: "date", name: "paidOn", label: td("paidDate") },
                        { kind: "select", name: "documentId", label: td("receipt"), options: documents, emptyLabel: td("noReceipt") },
                      ]}
                      initial={{ paidOn: "", documentId: x.documentId ?? "" }}
                      submitLabel={td("markPaid")}
                      onSubmit={setPremiumPaidAction.bind(null, p.id, x.id)}
                    />
                  </details>
                )}
              </li>
            ))}
          </ul>
          <InlineForm
            idPrefix="premium"
            title={td("premiumAdd")}
            fields={[
              { kind: "date", name: "dueOn", label: td("premiumDue") },
              { kind: "text", name: "amount", label: td("premiumAmount"), inputMode: "decimal", maxLength: 14 },
              { kind: "date", name: "paidOn", label: td("premiumPaidOn") },
              { kind: "select", name: "documentId", label: td("receipt"), options: documents, emptyLabel: td("noReceipt") },
              { kind: "checkbox", name: "createDeadline", label: td("premiumDeadline") },
            ]}
            initial={{ dueOn: "", amount: "", paidOn: "", documentId: "", createDeadline: false }}
            submitLabel={td("premiumAdd")}
            onSubmit={addPremiumAction.bind(null, p.id)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>
              <h2>{td("claims")}</h2>
            </CardTitle>
            <Link href={`/assicurazioni/sinistri/nuovo?polizza=${p.id}`} className={buttonVariants({ variant: "outline", size: "sm" }) + " print:hidden"}>
              <Plus aria-hidden /> {t("addClaim")}
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {p.claims.length === 0 ? <p className="text-sm text-muted-foreground">{td("noClaims")}</p> : null}
          <ul className="flex flex-col gap-1 text-sm" data-testid="policy-claims">
            {p.claims.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2">
                <Link href={`/assicurazioni/sinistri/${c.id}`} className="font-medium underline underline-offset-2">
                  {c.title}
                </Link>
                <Badge variant={c.open ? "secondary" : "outline"}>{t(`claimStatus.${c.status}`)}</Badge>
                <span className="text-muted-foreground">{t("occurredOn", { date: formatDate(c.occurredOn) })}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
