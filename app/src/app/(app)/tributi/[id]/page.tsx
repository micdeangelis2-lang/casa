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
import { listParties } from "@/modules/directory";
import { PAYMENT_KINDS, PAYMENT_METHODS, getObligationDetail } from "@/modules/taxes";
import { ActionButton } from "@/components/action-button";
import { InlineForm } from "@/components/inline-form";
import { isUuid } from "@/lib/ids";
import { formatDate, formatEuro } from "@/lib/format";
import { closeObligationAction, createObligationDeadlineAction, recordPaymentAction, removePaymentAction, reopenObligationAction } from "../actions";
import { ObligationBadges } from "../_components/state-badges";

type Props = PageProps<"/tributi/[id]">;

async function load(id: string) {
  return isUuid(id) ? getObligationDetail(getDb(), id) : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const o = await load((await params).id);
  return { title: o ? `${o.typeName} ${o.year}` : "Voce" };
}

export default async function ObligationPage({ params }: Props) {
  await requireOwner();
  const { id } = await params;
  const o = await load(id);
  if (!o) notFound();
  const t = await getTranslations("taxes");
  const td = await getTranslations("taxes.detail");
  const db = getDb();
  const [documents, parties] = await Promise.all([listDocumentOptions(db), listParties(db)]);
  const advisers = parties.filter((p) => p.roles.includes("accountant")).map((p) => p.displayName);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {o.typeName} {o.year}
            {o.label ? ` – ${o.label}` : ""}
          </h1>
          <div className="flex flex-wrap gap-2">
            <ObligationBadges item={o} />
          </div>
        </div>
        <Link href={`/tributi/${o.id}/modifica`} className={buttonVariants({ variant: "outline" }) + " print:hidden"}>
          <Pencil aria-hidden /> {td("edit")}
        </Link>
      </div>

      <Card>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[14rem_1fr]">
            <dt className="text-muted-foreground">{td("asset")}</dt>
            <dd>
              <Link href={`/immobili/${o.assetId}`} className="underline underline-offset-2">
                {o.assetName}
              </Link>
            </dd>
            <dt className="text-muted-foreground">{td("due")}</dt>
            <dd>{o.dueOn ? formatDate(o.dueOn) : "—"}</dd>
            <dt className="text-muted-foreground">{td("expected")}</dt>
            <dd>{o.expectedCents !== null ? `${formatEuro(o.expectedCents)} €` : td("notIndicated")}</dd>
            <dt className="text-muted-foreground">{td("paid")}</dt>
            <dd data-testid="paid-total">{formatEuro(o.paidCents)} €</dd>
            {o.remainingCents !== null ? (
              <>
                <dt className="text-muted-foreground">{td("difference")}</dt>
                <dd>
                  {formatEuro(o.remainingCents)} € <span className="text-muted-foreground">({td("differenceNote")})</span>
                </dd>
              </>
            ) : null}
            {o.note ? (
              <>
                <dt className="text-muted-foreground">{td("note")}</dt>
                <dd className="whitespace-pre-wrap">{o.note}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">{td("deadline")}</dt>
            <dd className="flex flex-wrap items-center gap-2">
              {o.deadlineId ? (
                <Link href={`/scadenze/${o.deadlineId}`} className="underline underline-offset-2">
                  {td("deadlineOpen")}
                </Link>
              ) : o.dueOn ? (
                <ActionButton variant="outline" action={createObligationDeadlineAction.bind(null, o.id)}>
                  {td("deadlineCreate")}
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
            <h2>{td("payments")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {o.paymentList.length === 0 ? <p className="text-sm text-muted-foreground">{td("noPayments")}</p> : null}
          <ul className="flex flex-col divide-y" data-testid="payments">
            {o.paymentList.map((p) => (
              <li key={p.id} className="flex flex-col gap-1 py-3 text-sm first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{td("paymentLine", { date: formatDate(p.paidOn), amount: formatEuro(p.amountCents), method: t(`methods.${p.method}`) })}</span>
                  {p.documentId && p.documentTitle ? (
                    <Link href={`/documenti/${p.documentId}`} className="underline underline-offset-2">
                      {p.documentTitle}
                    </Link>
                  ) : (
                    <Badge variant="outline">{td("noProof")}</Badge>
                  )}
                  <ActionButton action={removePaymentAction.bind(null, o.id, p.id)} srLabel={td("paymentLine", { date: formatDate(p.paidOn), amount: formatEuro(p.amountCents), method: t(`methods.${p.method}`) })}>
                    {td("remove")}
                  </ActionButton>
                </div>
                {p.kind !== "ordinary" || p.penaltyCents !== null || p.interestCents !== null ? (
                  <p className="text-muted-foreground" data-testid="payment-extras">
                    {[p.kind !== "ordinary" ? t(`paymentKinds.${p.kind}`) : null, p.penaltyCents !== null ? td("penaltyLine", { amount: formatEuro(p.penaltyCents) }) : null, p.interestCents !== null ? td("interestLine", { amount: formatEuro(p.interestCents) }) : null].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
                {p.reference ? <p className="text-muted-foreground">{td("reference", { reference: p.reference })}</p> : null}
                {p.note ? <p className="text-muted-foreground">{p.note}</p> : null}
              </li>
            ))}
          </ul>
          {o.status === "open" ? (
            <InlineForm
              idPrefix="payment"
              title={td("paymentAdd")}
              fields={[
                { kind: "date", name: "paidOn", label: td("paymentDate") },
                { kind: "text", name: "amount", label: td("paymentAmount"), inputMode: "decimal", maxLength: 14 },
                { kind: "select", name: "method", label: td("paymentMethod"), options: PAYMENT_METHODS.map((m) => ({ value: m, label: t(`methods.${m}`) })) },
                { kind: "select", name: "kind", label: td("paymentKind"), options: PAYMENT_KINDS.map((k) => ({ value: k, label: t(`paymentKinds.${k}`) })) },
                { kind: "text", name: "penalty", label: td("paymentPenalty"), hint: td("paymentExtrasHint"), inputMode: "decimal", maxLength: 14 },
                { kind: "text", name: "interest", label: td("paymentInterest"), inputMode: "decimal", maxLength: 14 },
                { kind: "text", name: "reference", label: td("paymentReference"), maxLength: 120 },
                { kind: "select", name: "documentId", label: td("paymentProof"), options: documents, emptyLabel: td("paymentNoProof") },
                { kind: "text", name: "note", label: td("paymentNote"), maxLength: 500 },
              ]}
              initial={{ paidOn: "", amount: "", method: "bank_transfer", kind: "ordinary", penalty: "", interest: "", reference: "", documentId: "", note: "" }}
              submitLabel={td("paymentButton")}
              onSubmit={recordPaymentAction.bind(null, o.id)}
            />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{td("closeHeading")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {o.status === "closed" ? (
            <>
              <Alert>
                <AlertDescription>{td("closedInfo", { date: o.closedOn ? formatDate(o.closedOn) : "—", reason: o.closedNote ?? "" })}</AlertDescription>
              </Alert>
              <div>
                <ActionButton variant="outline" size="default" action={reopenObligationAction.bind(null, o.id)}>
                  {td("reopen")}
                </ActionButton>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">{td("closeIntro")}</p>
              <InlineForm
                idPrefix="close"
                title={td("closeButton")}
                fields={[
                  { kind: "text", name: "reason", label: td("closeReason"), maxLength: 500 },
                  { kind: "date", name: "closedOn", label: td("closeDate") },
                ]}
                initial={{ reason: "", closedOn: "" }}
                submitLabel={td("closeButton")}
                onSubmit={closeObligationAction.bind(null, o.id)}
              />
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{td("handoff")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p>{td("handoffBody")}</p>
          <p className="text-muted-foreground">{advisers.length > 0 ? td("handoffAdvisers", { names: advisers.join(", ") }) : td("handoffNoAdvisers")}</p>
          <div>
            <Link href={`/tributi/riepilogo?anno=${o.year}`} className={buttonVariants({ variant: "outline" }) + " print:hidden"}>
              {td("handoffSummary", { year: o.year })}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
