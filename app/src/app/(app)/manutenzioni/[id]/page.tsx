import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { listParties } from "@/modules/directory";
import { listDocumentOptions } from "@/modules/documents";
import { QUOTE_STATUSES, WORK_STATUSES, getWorkDetail } from "@/modules/maintenance";
import { ActionButton } from "@/components/action-button";
import { InlineForm } from "@/components/inline-form";
import { isUuid } from "@/lib/ids";
import { formatDate, formatEuro } from "@/lib/format";
import { addInvoiceAction, addProgressAction, addQuoteAction, removeEntryAction, setInvoicePaidAction, setQuoteStatusAction, setWorkStatusAction, undoInvoicePaidAction } from "../actions";

type Props = PageProps<"/manutenzioni/[id]">;

async function load(id: string) {
  return isUuid(id) ? getWorkDetail(getDb(), id) : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: (await load((await params).id))?.title ?? "Intervento" };
}

export default async function WorkPage({ params }: Props) {
  await requireOwner();
  const { id } = await params;
  const w = await load(id);
  if (!w) notFound();
  const t = await getTranslations("maintenance");
  const td = await getTranslations("maintenance.detail");
  const db = getDb();
  const [parties, documents] = await Promise.all([listParties(db), listDocumentOptions(db)]);
  const partyOptions = parties.map((p) => ({ value: p.id, label: p.displayName }));
  const documentOptions = documents;
  const f = w.financials;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{w.title}</h1>
          <div className="flex flex-wrap gap-2">
            <Badge variant={w.status === "completed" || w.status === "cancelled" ? "outline" : "secondary"}>{t(`status.${w.status}`)}</Badge>
          </div>
        </div>
        <Link href={`/manutenzioni/${w.id}/modifica`} className={buttonVariants({ variant: "outline" }) + " print:hidden"}>
          <Pencil aria-hidden /> {td("edit")}
        </Link>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[12rem_1fr]">
            <dt className="text-muted-foreground">{td("asset")}</dt>
            <dd>
              <Link href={`/immobili/${w.assetId}`} className="underline underline-offset-2">
                {w.assetName}
              </Link>
            </dd>
            <dt className="text-muted-foreground">{td("supplier")}</dt>
            <dd>{w.supplierName ?? "—"}</dd>
            <dt className="text-muted-foreground">{td("dates")}</dt>
            <dd>{[w.scheduledOn ? td("scheduled", { date: formatDate(w.scheduledOn) }) : null, w.startedOn ? td("started", { date: formatDate(w.startedOn) }) : null, w.completedOn ? td("completed", { date: formatDate(w.completedOn) }) : null].filter(Boolean).join(" · ") || "—"}</dd>
            <dt className="text-muted-foreground">{td("budget")}</dt>
            <dd>{f.budgetCents !== null ? `${formatEuro(f.budgetCents)} €` : "—"}</dd>
            <dt className="text-muted-foreground">{td("acceptedQuotes")}</dt>
            <dd data-testid="accepted-total">{f.acceptedQuotesCents > 0 ? `${formatEuro(f.acceptedQuotesCents)} €` : "—"}</dd>
            <dt className="text-muted-foreground">{td("invoiced")}</dt>
            <dd data-testid="invoiced-total">{formatEuro(f.invoicedCents)} €</dd>
            <dt className="text-muted-foreground">{td("paid")}</dt>
            <dd data-testid="paid-total">
              {formatEuro(f.paidCents)} € {f.unpaidInvoicesCents > 0 ? <span className="text-muted-foreground">({td("unpaid", { amount: formatEuro(f.unpaidInvoicesCents) })})</span> : null}
            </dd>
            {w.description ? (
              <>
                <dt className="text-muted-foreground">{td("description")}</dt>
                <dd className="whitespace-pre-wrap">{w.description}</dd>
              </>
            ) : null}
            {w.note ? (
              <>
                <dt className="text-muted-foreground">{td("note")}</dt>
                <dd className="whitespace-pre-wrap">{w.note}</dd>
              </>
            ) : null}
            {w.deadlineId ? (
              <>
                <dt className="text-muted-foreground">{td("deadline")}</dt>
                <dd>
                  <Link href={`/scadenze/${w.deadlineId}`} className="underline underline-offset-2">
                    {td("openDeadline")}
                  </Link>
                </dd>
              </>
            ) : null}
          </dl>
          <p className="text-xs text-muted-foreground">{td("amountsNote")}</p>
          <InlineForm
            key={`${w.id}-${w.status}`}
            idPrefix="status"
            title={td("updateStatus")}
            fields={[{ kind: "select", name: "status", label: td("statusLabel"), options: WORK_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) })) }]}
            initial={{ status: w.status }}
            submitLabel={td("updateStatus")}
            onSubmit={setWorkStatusAction.bind(null, w.id)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{td("quotes")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{td("quotesNote")}</p>
          {w.quotes.length === 0 ? <p className="text-sm text-muted-foreground">{td("noQuotes")}</p> : null}
          <ul className="flex flex-col divide-y" data-testid="quotes">
            {w.quotes.map((q) => (
              <li key={q.id} className="flex flex-col gap-1 py-3 text-sm first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{formatEuro(q.amountCents)} €</span>
                  <Badge variant={q.status === "accepted" ? "secondary" : "outline"}>{td(`quoteStatus.${q.status}`)}</Badge>
                  {q.expired ? <Badge variant="outline">{td("quoteExpired")}</Badge> : null}
                  {q.supplierName ? <span className="text-muted-foreground">{q.supplierName}</span> : null}
                </div>
                <p className="text-muted-foreground">{[q.quotedOn ? td("quotedOn", { date: formatDate(q.quotedOn) }) : null, q.validUntil ? td("validUntil", { date: formatDate(q.validUntil) }) : null, q.note].filter(Boolean).join(" · ")}</p>
                {q.documentId && q.documentTitle ? (
                  <Link href={`/documenti/${q.documentId}`} className="underline underline-offset-2">
                    {q.documentTitle}
                  </Link>
                ) : null}
                <div className="flex flex-wrap gap-1">
                  {QUOTE_STATUSES.filter((s) => s !== q.status).map((s) => (
                    <ActionButton key={s} action={setQuoteStatusAction.bind(null, w.id, q.id, s)} srLabel={`${formatEuro(q.amountCents)} €`}>
                      {td(`quoteAction.${s}`)}
                    </ActionButton>
                  ))}
                  <ActionButton action={removeEntryAction.bind(null, w.id, "quote", q.id)} srLabel={`${formatEuro(q.amountCents)} €`}>
                    {td("remove")}
                  </ActionButton>
                </div>
              </li>
            ))}
          </ul>
          <InlineForm
            idPrefix="quote"
            title={td("quoteAdd")}
            fields={[
              { kind: "text", name: "amount", label: td("quoteAmount"), inputMode: "decimal", maxLength: 14 },
              { kind: "select", name: "supplierPartyId", label: td("quoteSupplier"), options: partyOptions, emptyLabel: "—" },
              { kind: "date", name: "quotedOn", label: td("quoteDate") },
              { kind: "date", name: "validUntil", label: td("quoteValid") },
              { kind: "select", name: "status", label: td("quoteStatusLabel"), options: QUOTE_STATUSES.map((s) => ({ value: s, label: td(`quoteStatus.${s}`) })) },
              { kind: "select", name: "documentId", label: td("quoteDocument"), options: documentOptions, emptyLabel: "—" },
              { kind: "text", name: "note", label: td("quoteNote"), maxLength: 500 },
            ]}
            initial={{ amount: "", supplierPartyId: "", quotedOn: "", validUntil: "", status: "received", documentId: "", note: "" }}
            submitLabel={td("quoteAdd")}
            onSubmit={addQuoteAction.bind(null, w.id)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{td("progress")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {w.progress.length === 0 ? <p className="text-sm text-muted-foreground">{td("noProgress")}</p> : null}
          <ul className="flex flex-col divide-y" data-testid="progress">
            {w.progress.map((p) => (
              <li key={p.id} className="flex flex-col gap-1 py-3 text-sm first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{formatDate(p.recordedOn)}</span>
                  {p.percent !== null ? <Badge variant="outline">{td("percent", { percent: p.percent })}</Badge> : null}
                  <ActionButton action={removeEntryAction.bind(null, w.id, "progress", p.id)} srLabel={formatDate(p.recordedOn)}>
                    {td("remove")}
                  </ActionButton>
                </div>
                <p className="whitespace-pre-wrap">{p.note}</p>
              </li>
            ))}
          </ul>
          <InlineForm
            idPrefix="progress"
            title={td("progressAdd")}
            fields={[
              { kind: "date", name: "recordedOn", label: td("progressDate") },
              { kind: "text", name: "percent", label: td("progressPercent"), hint: td("progressPercentHint"), inputMode: "numeric", maxLength: 3 },
              { kind: "textarea", name: "note", label: td("progressNote"), maxLength: 1000 },
            ]}
            initial={{ recordedOn: "", percent: "", note: "" }}
            submitLabel={td("progressAdd")}
            onSubmit={addProgressAction.bind(null, w.id)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{td("invoices")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {w.invoices.length === 0 ? <p className="text-sm text-muted-foreground">{td("noInvoices")}</p> : null}
          <ul className="flex flex-col divide-y" data-testid="invoices">
            {w.invoices.map((i) => (
              <li key={i.id} className="flex flex-col gap-1 py-3 text-sm first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{formatEuro(i.amountCents)} €</span>
                  {i.number ? <span>{td("invoiceNumber", { number: i.number })}</span> : null}
                  <span className="text-muted-foreground">{td("issuedOn", { date: formatDate(i.issuedOn) })}</span>
                  <Badge variant={i.paidOn ? "secondary" : "outline"}>{i.paidOn ? td("paidOn", { date: formatDate(i.paidOn) }) : td("toPay")}</Badge>
                </div>
                {i.documentId && i.documentTitle ? (
                  <Link href={`/documenti/${i.documentId}`} className="underline underline-offset-2">
                    {i.documentTitle}
                  </Link>
                ) : null}
                {i.note ? <p className="text-muted-foreground">{i.note}</p> : null}
                <div className="flex flex-wrap items-start gap-1">
                  {i.paidOn ? (
                    <ActionButton action={undoInvoicePaidAction.bind(null, w.id, i.id)} srLabel={`${formatEuro(i.amountCents)} €`}>
                      {td("markUnpaid")}
                    </ActionButton>
                  ) : (
                    <details className="print:hidden">
                      <summary className="cursor-pointer text-muted-foreground">
                        {td("markPaid")}
                        <span className="sr-only">: {formatEuro(i.amountCents)} €</span>
                      </summary>
                      <InlineForm idPrefix={`paid-${i.id}`} title={td("markPaid")} fields={[{ kind: "date", name: "paidOn", label: td("paidDate") }]} initial={{ paidOn: "" }} submitLabel={td("markPaid")} onSubmit={setInvoicePaidAction.bind(null, w.id, i.id, true)} />
                    </details>
                  )}
                  <ActionButton action={removeEntryAction.bind(null, w.id, "invoice", i.id)} srLabel={`${formatEuro(i.amountCents)} €`}>
                    {td("remove")}
                  </ActionButton>
                </div>
              </li>
            ))}
          </ul>
          <InlineForm
            idPrefix="invoice"
            title={td("invoiceAdd")}
            fields={[
              { kind: "text", name: "number", label: td("invoiceNumberLabel"), maxLength: 60 },
              { kind: "date", name: "issuedOn", label: td("invoiceDate") },
              { kind: "text", name: "amount", label: td("invoiceAmount"), inputMode: "decimal", maxLength: 14 },
              { kind: "date", name: "paidOn", label: td("invoicePaidOn") },
              { kind: "select", name: "documentId", label: td("invoiceDocument"), options: documentOptions, emptyLabel: "—" },
              { kind: "text", name: "note", label: td("invoiceNote"), maxLength: 500 },
            ]}
            initial={{ number: "", issuedOn: "", amount: "", paidOn: "", documentId: "", note: "" }}
            submitLabel={td("invoiceAdd")}
            onSubmit={addInvoiceAction.bind(null, w.id)}
          />
        </CardContent>
      </Card>

      {w.warranties.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{td("warranties")}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1 text-sm">
              {w.warranties.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{x.title}</span>
                  <Badge variant="outline">{t(`warranties.state.${x.state}`)}</Badge>
                  <span className="text-muted-foreground">{t("warranties.until", { date: formatDate(x.endsOn) })}</span>
                </li>
              ))}
            </ul>
            <Link href="/manutenzioni?sezione=warranties" className="mt-3 inline-block text-sm underline underline-offset-2">
              {td("allWarranties")}
            </Link>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
