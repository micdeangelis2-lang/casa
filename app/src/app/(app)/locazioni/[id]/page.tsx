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
import { listParties } from "@/modules/directory";
import { listDocumentOptions } from "@/modules/documents";
import { LETTING_PARTY_ROLES, LETTING_STATUSES, REPORT_KINDS, getLettingDetail, isContractType } from "@/modules/lettings";
import { ActionButton } from "@/components/action-button";
import { InlineForm } from "@/components/inline-form";
import { isUuid } from "@/lib/ids";
import { formatDate, formatEuro } from "@/lib/format";
import {
  addCodeAction,
  addPartyAction,
  addRentAction,
  addReportAction,
  generateScheduleAction,
  markReportDoneAction,
  addRentReceiptAction,
  removeCodeAction,
  removePartyAction,
  removeRentAction,
  removeRentReceiptAction,
  removeReportAction,
  reopenReportAction,
  setLettingStatusAction,
} from "../actions";

type Props = PageProps<"/locazioni/[id]">;

async function load(id: string) {
  return isUuid(id) ? getLettingDetail(getDb(), id) : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: (await load((await params).id))?.title ?? "Locazione" };
}

export default async function LettingPage({ params }: Props) {
  await requireOwner();
  const { id } = await params;
  const l = await load(id);
  if (!l) notFound();
  const t = await getTranslations("lettings");
  const td = await getTranslations("lettings.detail");
  const db = getDb();
  const [parties, documents] = await Promise.all([listParties(db), listDocumentOptions(db)]);
  const documentOptions = documents;
  const contract = isContractType(l.type);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{l.title}</h1>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{t(`types.${l.type}`)}</Badge>
            <Badge variant={l.status === "ended" ? "outline" : "secondary"}>{t(`status.${l.status}`)}</Badge>
          </div>
        </div>
        <Link href={`/locazioni/${l.id}/modifica`} className={buttonVariants({ variant: "outline" }) + " print:hidden"}>
          <Pencil aria-hidden /> {td("edit")}
        </Link>
      </div>

      <Alert>
        <AlertDescription className="flex flex-col gap-2">
          <span>{td("notice")}</span>
          <span className="flex flex-wrap gap-4 print:hidden">
            <Link href="/regole" className="underline underline-offset-2">
              {td("rulesLink")}
            </Link>
            <Link href={`/immobili/${l.assetId}/dossier`} className="underline underline-offset-2">
              {td("dossierLink")}
            </Link>
          </span>
        </AlertDescription>
      </Alert>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[12rem_1fr]">
            <dt className="text-muted-foreground">{td("asset")}</dt>
            <dd>
              <Link href={`/immobili/${l.assetId}`} className="underline underline-offset-2">
                {l.assetName}
              </Link>
            </dd>
            <dt className="text-muted-foreground">{td("period")}</dt>
            <dd>{l.startsOn || l.endsOn ? `${l.startsOn ? formatDate(l.startsOn) : "…"} – ${l.endsOn ? formatDate(l.endsOn) : "…"}` : "—"}</dd>
            <dt className="text-muted-foreground">{td("manager")}</dt>
            <dd>{l.managerName ?? "—"}</dd>
            {contract ? (
              <>
                <dt className="text-muted-foreground">{td("monthlyRent")}</dt>
                <dd>{l.monthlyRentCents !== null ? `${formatEuro(l.monthlyRentCents)} €` : "—"}</dd>
                <dt className="text-muted-foreground">{td("deposit")}</dt>
                <dd>
                  {l.depositCents !== null ? `${formatEuro(l.depositCents)} €` : "—"}
                  {l.depositReceivedOn ? ` · ${td("depositReceived", { date: formatDate(l.depositReceivedOn) })}` : ""}
                  {l.depositReturnedOn ? ` · ${td("depositLine", { received: l.depositReceivedOn ? formatDate(l.depositReceivedOn) : "—", returned: formatDate(l.depositReturnedOn), amount: formatEuro(l.depositReturnedCents ?? 0) })}` : ""}
                </dd>
                <dt className="text-muted-foreground">{td("registration")}</dt>
                <dd>{[l.registrationNumber, l.registrationOffice, l.registeredOn ? formatDate(l.registeredOn) : null].filter(Boolean).join(" · ") || "—"}</dd>
                <dt className="text-muted-foreground">{td("contractDocument")}</dt>
                <dd>
                  {l.contractDocumentId && l.contractDocumentTitle ? (
                    <Link href={`/documenti/${l.contractDocumentId}`} className="underline underline-offset-2">
                      {l.contractDocumentTitle}
                    </Link>
                  ) : (
                    "—"
                  )}
                </dd>
              </>
            ) : null}
            {l.note ? (
              <>
                <dt className="text-muted-foreground">{td("note")}</dt>
                <dd className="whitespace-pre-wrap">{l.note}</dd>
              </>
            ) : null}
            {l.deadlineId ? (
              <>
                <dt className="text-muted-foreground">{td("deadline")}</dt>
                <dd>
                  <Link href={`/scadenze/${l.deadlineId}`} className="underline underline-offset-2">
                    {td("openDeadline")}
                  </Link>
                </dd>
              </>
            ) : null}
          </dl>
          <InlineForm
            key={`${l.id}-${l.status}`}
            idPrefix="status"
            title={td("updateStatus")}
            fields={[{ kind: "select", name: "status", label: td("statusLabel"), options: LETTING_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) })) }]}
            initial={{ status: l.status }}
            submitLabel={td("updateStatus")}
            onSubmit={setLettingStatusAction.bind(null, l.id)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{td("people")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{td("peopleNote")}</p>
          {l.people.length === 0 ? <p className="text-sm text-muted-foreground">{td("noPeople")}</p> : null}
          <ul className="flex flex-col gap-1 text-sm" data-testid="people">
            {l.people.map((p) => (
              <li key={p.partyId} className="flex flex-wrap items-center gap-2">
                <Link href={`/rubrica/${p.partyId}`} className="font-medium underline underline-offset-2">
                  {p.name}
                </Link>
                <Badge variant="outline">{td(`role.${p.role}`)}</Badge>
                <ActionButton action={removePartyAction.bind(null, l.id, p.partyId)} srLabel={p.name}>
                  {td("remove")}
                </ActionButton>
              </li>
            ))}
          </ul>
          <InlineForm
            idPrefix="person"
            title={td("personAdd")}
            fields={[
              { kind: "select", name: "partyId", label: td("personParty"), options: parties.map((p) => ({ value: p.id, label: p.displayName })), emptyLabel: td("personChoose") },
              { kind: "select", name: "role", label: td("personRole"), options: LETTING_PARTY_ROLES.map((r) => ({ value: r, label: td(`role.${r}`) })) },
            ]}
            initial={{ partyId: "", role: "tenant" }}
            submitLabel={td("personAdd")}
            onSubmit={addPartyAction.bind(null, l.id)}
          />
        </CardContent>
      </Card>

      {contract ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{td("rents")}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{td("rentsNote")}</p>
            {l.rents.length === 0 ? <p className="text-sm text-muted-foreground">{td("noRents")}</p> : <p className="text-sm font-medium" data-testid="rent-totals">{td("rentTotals", { due: formatEuro(l.rentTotals.dueCents), paid: formatEuro(l.rentTotals.paidCents), overdue: formatEuro(l.rentTotals.overdueCents) })}</p>}
            <ul className="flex flex-col divide-y" data-testid="rents">
              {l.rents.map((r) => (
                <li key={r.id} className="flex flex-col gap-1 py-3 text-sm first:pt-0 last:pb-0" data-testid="rent">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{td("rentLine", { date: formatDate(r.dueOn), amount: formatEuro(r.amountCents) })}</span>
                    <Badge variant={r.state === "paid" ? "secondary" : r.state === "overdue" ? "destructive" : "outline"}>{td(`rentState.${r.state}`)}</Badge>
                    {r.paidCents > 0 && r.state !== "paid" ? <span className="text-muted-foreground">{td("paidLine", { paid: formatEuro(r.paidCents) })}</span> : null}
                    {r.documentId && r.documentTitle ? (
                      <Link href={`/documenti/${r.documentId}`} className="underline underline-offset-2">
                        {r.documentTitle}
                      </Link>
                    ) : null}
                    <ActionButton action={removeRentAction.bind(null, l.id, r.id)} srLabel={formatDate(r.dueOn)}>
                      {td("remove")}
                    </ActionButton>
                  </div>
                  {r.receipts.length > 0 ? (
                    <ul className="flex flex-col gap-1 pl-4" data-testid="rent-receipts">
                      {r.receipts.map((x) => (
                        <li key={x.id} className="flex flex-wrap items-center gap-2">
                          <span>{td("receiptLine", { date: formatDate(x.paidOn), amount: formatEuro(x.amountCents) })}</span>
                          {x.method ? <span className="text-muted-foreground">{x.method}</span> : null}
                          {x.documentId && x.documentTitle ? (
                            <Link href={`/documenti/${x.documentId}`} className="underline underline-offset-2">
                              {x.documentTitle}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">{td("receiptNoProof")}</span>
                          )}
                          <ActionButton action={removeRentReceiptAction.bind(null, l.id, x.id)} srLabel={`${formatDate(x.paidOn)} ${formatEuro(x.amountCents)}`}>
                            {td("receiptRemove")}
                          </ActionButton>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <details className="print:hidden">
                    <summary className="cursor-pointer text-muted-foreground">
                      {td("markPaid")}
                      <span className="sr-only">: {formatDate(r.dueOn)}</span>
                    </summary>
                    <InlineForm
                      idPrefix={`rent-${r.id}`}
                      title={td("markPaid")}
                      fields={[
                        { kind: "text", name: "amount", label: td("paidAmount"), inputMode: "decimal", maxLength: 14 },
                        { kind: "date", name: "paidOn", label: td("paidDate") },
                        { kind: "text", name: "method", label: td("paidMethod"), maxLength: 80 },
                        { kind: "select", name: "documentId", label: td("paidReceipt"), options: documentOptions, emptyLabel: td("noReceipt") },
                      ]}
                      initial={{ amount: "", paidOn: "", method: "", documentId: "" }}
                      submitLabel={td("markPaid")}
                      onSubmit={addRentReceiptAction.bind(null, l.id, r.id)}
                    />
                  </details>
                </li>
              ))}
            </ul>
            <p className="text-sm text-muted-foreground">{td("scheduleIntro")}</p>
            <InlineForm
              idPrefix="schedule"
              title={td("scheduleHeading")}
              fields={[
                { kind: "date", name: "firstDueOn", label: td("scheduleFirst") },
                { kind: "text", name: "months", label: td("scheduleMonths"), inputMode: "numeric", maxLength: 3 },
                { kind: "text", name: "amount", label: td("scheduleAmount"), inputMode: "decimal", maxLength: 14 },
                { kind: "checkbox", name: "createDeadlines", label: td("scheduleDeadlines") },
              ]}
              initial={{ firstDueOn: l.startsOn ?? "", months: "12", amount: l.monthlyRentCents !== null ? formatEuro(l.monthlyRentCents) : "", createDeadlines: false }}
              submitLabel={td("scheduleButton")}
              onSubmit={generateScheduleAction.bind(null, l.id)}
            />
            <InlineForm
              idPrefix="rent-add"
              title={td("rentAdd")}
              fields={[
                { kind: "date", name: "dueOn", label: td("rentDue") },
                { kind: "text", name: "amount", label: td("rentAmount"), inputMode: "decimal", maxLength: 14 },
              ]}
              initial={{ dueOn: "", amount: "" }}
              submitLabel={td("rentAddButton")}
              onSubmit={addRentAction.bind(null, l.id)}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{td("codes")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{td("codesNote")}</p>
          {l.codes.length === 0 ? <p className="text-sm text-muted-foreground">{td("noCodes")}</p> : null}
          <ul className="flex flex-col divide-y" data-testid="codes">
            {l.codes.map((c) => (
              <li key={c.id} className="flex flex-col gap-1 py-3 text-sm first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{td("codeLine", { label: c.label, value: c.value })}</span>
                  <Badge variant={c.state === "expired" ? "destructive" : "outline"}>{td(`codeState.${c.state}`)}</Badge>
                  <ActionButton action={removeCodeAction.bind(null, l.id, c.id)} srLabel={c.label}>
                    {td("remove")}
                  </ActionButton>
                </div>
                <p className="text-muted-foreground">{[c.issuer ? td("codeIssuer", { issuer: c.issuer }) : null, c.validUntil ? td("codeValid", { date: formatDate(c.validUntil) }) : null, c.note].filter(Boolean).join(" · ")}</p>
              </li>
            ))}
          </ul>
          <InlineForm
            idPrefix="code"
            title={td("codeAdd")}
            fields={[
              { kind: "text", name: "label", label: td("codeLabel"), maxLength: 120 },
              { kind: "text", name: "value", label: td("codeValue"), maxLength: 120 },
              { kind: "text", name: "issuer", label: td("codeIssuerLabel"), maxLength: 160 },
              { kind: "date", name: "issuedOn", label: td("codeIssuedOn") },
              { kind: "date", name: "validUntil", label: td("codeValidUntil") },
              { kind: "text", name: "note", label: td("codeNote"), maxLength: 300 },
            ]}
            initial={{ label: "", value: "", issuer: "", issuedOn: "", validUntil: "", note: "" }}
            submitLabel={td("codeAdd")}
            onSubmit={addCodeAction.bind(null, l.id)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{td("reports")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{td("reportsNote")}</p>
          {l.reports.length === 0 ? <p className="text-sm text-muted-foreground">{td("noReports")}</p> : null}
          <ul className="flex flex-col divide-y" data-testid="reports">
            {l.reports.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 py-3 text-sm first:pt-0 last:pb-0" data-testid="report">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{td(`reportKind.${r.kind}`)}</Badge>
                  <span className="font-medium">{r.title}</span>
                  <Badge variant={r.state === "done" ? "secondary" : r.state === "overdue" ? "destructive" : "outline"}>{td(`reportState.${r.state}`)}</Badge>
                  <ActionButton action={removeReportAction.bind(null, l.id, r.id)} srLabel={r.title}>
                    {td("remove")}
                  </ActionButton>
                </div>
                <p className="text-muted-foreground">{[r.period, r.dueOn ? td("reportDue", { date: formatDate(r.dueOn) }) : null, r.doneOn ? td("reportDone", { date: formatDate(r.doneOn) }) : null, r.amountCents !== null ? td("reportAmount", { amount: formatEuro(r.amountCents) }) : null, r.note].filter(Boolean).join(" · ")}</p>
                {r.documentId && r.documentTitle ? (
                  <Link href={`/documenti/${r.documentId}`} className="underline underline-offset-2">
                    {r.documentTitle}
                  </Link>
                ) : null}
                {r.state === "done" ? (
                  <div>
                    <ActionButton action={reopenReportAction.bind(null, l.id, r.id)} srLabel={r.title}>
                      {td("reportReopen")}
                    </ActionButton>
                  </div>
                ) : (
                  <details className="print:hidden">
                    <summary className="cursor-pointer text-muted-foreground">
                      {td("reportMarkDone")}
                      <span className="sr-only">: {r.title}</span>
                    </summary>
                    <InlineForm
                      idPrefix={`report-${r.id}`}
                      title={td("reportMarkDone")}
                      fields={[
                        { kind: "date", name: "doneOn", label: td("reportDoneOn") },
                        { kind: "text", name: "amount", label: td("reportAmountLabel"), inputMode: "decimal", maxLength: 14 },
                        { kind: "select", name: "documentId", label: td("reportDocument"), options: documentOptions, emptyLabel: td("noReceipt") },
                      ]}
                      initial={{ doneOn: "", amount: r.amountCents !== null ? formatEuro(r.amountCents) : "", documentId: r.documentId ?? "" }}
                      submitLabel={td("reportMarkDone")}
                      onSubmit={markReportDoneAction.bind(null, l.id, r.id)}
                    />
                  </details>
                )}
              </li>
            ))}
          </ul>
          <InlineForm
            idPrefix="report-add"
            title={td("reportAdd")}
            fields={[
              { kind: "select", name: "kind", label: td("reportKindLabel"), options: REPORT_KINDS.map((k) => ({ value: k, label: td(`reportKind.${k}`) })) },
              { kind: "text", name: "title", label: td("reportTitle"), maxLength: 200 },
              { kind: "text", name: "period", label: td("reportPeriod"), maxLength: 60 },
              { kind: "date", name: "dueOn", label: td("reportDueLabel") },
              { kind: "text", name: "amount", label: td("reportAmountLabel"), inputMode: "decimal", maxLength: 14 },
              { kind: "date", name: "doneOn", label: td("reportDoneOn") },
              { kind: "select", name: "documentId", label: td("reportDocument"), options: documentOptions, emptyLabel: td("noReceipt") },
              { kind: "text", name: "note", label: td("reportNote"), maxLength: 500 },
              { kind: "checkbox", name: "createDeadline", label: td("reportDeadline") },
            ]}
            initial={{ kind: "communication", title: "", period: "", dueOn: "", amount: "", doneOn: "", documentId: "", note: "", createDeadline: false }}
            submitLabel={td("reportAddButton")}
            onSubmit={addReportAction.bind(null, l.id)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
