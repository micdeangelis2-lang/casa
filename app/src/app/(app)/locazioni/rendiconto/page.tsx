import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Download } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { PrintButton } from "@/components/print-button";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { todayInItaly } from "@/platform/clock";
import { listAssets } from "@/modules/assets";
import { compareDeclared, getManagementStatement } from "@/modules/management";
import { parseEuroToCents } from "@/shared/money";
import { statementParams } from "@/lib/gestore-params";
import { formatDate, formatEuro } from "@/lib/format";
import { GestoreTable } from "../_components/gestore-table";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("gestore.statement");
  return { title: t("title") };
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function StatementPage({ searchParams }: PageProps<"/locazioni/rendiconto">) {
  await requireOwner();
  const t = await getTranslations("gestore.statement");
  const tc = await getTranslations("gestore.common");
  const tl = await getTranslations("lettings");
  const params = await searchParams;
  const db = getDb();
  const today = todayInItaly();
  const assets = await listAssets(db);
  const { assetId: asked, from, to } = statementParams((k) => first(params[k]), today);
  const assetId = asked && assets.some((a) => a.id === asked) ? asked : (assets[0]?.id ?? null);
  const money = (cents: number) => tc("amount", { amount: formatEuro(cents) });

  const head = (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <Alert>
        <AlertDescription>{t("intro")}</AlertDescription>
      </Alert>
    </>
  );
  if (!assetId) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        {head}
        <p className="text-sm text-muted-foreground">{tc("noAssets")}</p>
      </div>
    );
  }

  const s = await getManagementStatement(db, { assetId, from, to }, today);
  const declaredIncomeRaw = first(params.incassi).trim();
  const declaredCostsRaw = first(params.spese).trim();
  const declaredIncome = declaredIncomeRaw ? parseEuroToCents(declaredIncomeRaw) : null;
  const declaredCosts = declaredCostsRaw ? parseEuroToCents(declaredCostsRaw) : null;
  const invalidDeclared = (declaredIncomeRaw !== "" && declaredIncome === null) || (declaredCostsRaw !== "" && declaredCosts === null);
  const compare = (declared: number, registered: number) => {
    const c = compareDeclared(declared, registered);
    return { declared: formatEuro(c.declaredCents), registered: formatEuro(c.registeredCents), difference: formatEuro(c.differenceCents) };
  };
  const csvHref = `/api/locazioni/rendiconto?immobile=${assetId}&dal=${from}&al=${to}`;
  const date = (d: string | null) => (d ? formatDate(d) : "");
  const period = (a: string | null, b: string | null) => (a || b ? [date(a), date(b)].join(" – ") : t("contracts.noPeriod"));
  const none = <p className="text-sm text-muted-foreground">{tc("none")}</p>;
  const section = (id: string, heading: string, body: React.ReactNode) => (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-2">
      <h3 id={`${id}-heading`} className="text-lg font-medium">
        {heading}
      </h3>
      {body}
    </section>
  );
  const ledgerBlock = (key: "receipts" | "payments", rows: typeof s.receipts, total: number, totalKey: "totalReceipts" | "totalPayments") => (
    <GestoreTable
      label={t(`ledger.${key}`)}
      testId={`statement-${key}`}
      headers={[t("ledger.date"), t("ledger.area"), t("ledger.description"), t("ledger.amount")]}
      rows={rows.map((e, i) => ({ key: `${e.date}-${i}`, cells: [date(e.date), t(`areas.${e.area as "taxes"}`), e.label, money(e.amountCents)] }))}
      footer={
        <tr className="font-semibold">
          <th scope="row" colSpan={3} className="py-2 pr-4 text-left">
            {t(`ledger.${totalKey}`)}
          </th>
          <td className="py-2 pr-4" data-testid={`total-${key}`}>
            {money(total)}
          </td>
        </tr>
      }
    />
  );

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      {head}

      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <form method="get" className="flex flex-wrap items-end gap-3" role="search">
          <div className="flex w-56 flex-col gap-2">
            <Label htmlFor="immobile">{tc("asset")}</Label>
            <NativeSelect id="immobile" name="immobile" defaultValue={assetId}>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex w-40 flex-col gap-2">
            <Label htmlFor="dal">{t("filters.from")}</Label>
            <Input id="dal" name="dal" type="date" defaultValue={from} />
          </div>
          <div className="flex w-40 flex-col gap-2">
            <Label htmlFor="al">{t("filters.to")}</Label>
            <Input id="al" name="al" type="date" defaultValue={to} />
          </div>
          <div className="flex w-48 flex-col gap-2">
            <Label htmlFor="incassi">{t("filters.declaredIncome")}</Label>
            <Input id="incassi" name="incassi" inputMode="decimal" defaultValue={declaredIncomeRaw} aria-describedby="declared-hint" />
          </div>
          <div className="flex w-48 flex-col gap-2">
            <Label htmlFor="spese">{t("filters.declaredCosts")}</Label>
            <Input id="spese" name="spese" inputMode="decimal" defaultValue={declaredCostsRaw} aria-describedby="declared-hint" />
          </div>
          <Button type="submit" variant="secondary">
            {tc("apply")}
          </Button>
        </form>
        <PrintButton />
        <a href={csvHref} className={buttonVariants({ variant: "outline" })}>
          <Download aria-hidden /> {t("csv")}
        </a>
      </div>
      <p id="declared-hint" className="text-xs text-muted-foreground print:hidden">
        {t("filters.declaredHint")}
      </p>

      <h2 className="text-lg font-medium" data-testid="statement-heading">
        {t("heading", { asset: s.assetName ?? "", from: formatDate(from), to: formatDate(to) })}
      </h2>

      {declaredIncomeRaw || declaredCostsRaw ? (
        <div className="flex flex-col gap-2 rounded-lg border p-4" data-testid="statement-compare">
          <h3 className="font-medium">{t("compare.heading")}</h3>
          {invalidDeclared ? <p className="text-sm">{t("compare.invalid")}</p> : null}
          {declaredIncome !== null ? <p className="text-sm">{t("compare.income", compare(declaredIncome, s.totals.receiptsCents))}</p> : null}
          {declaredCosts !== null ? <p className="text-sm">{t("compare.costs", compare(declaredCosts, s.totals.paymentsCents))}</p> : null}
          <p className="text-xs text-muted-foreground">{t("compare.hint")}</p>
        </div>
      ) : null}

      {section(
        "checks",
        t("checks.heading"),
        s.checks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("checks.none")}</p>
        ) : (
          <ul className="list-disc pl-5 text-sm" data-testid="statement-checks">
            {s.checks.map((c) => (
              <li key={c.key}>{t(`checks.${c.key}`, { count: c.count, amount: formatEuro(c.cents ?? 0) })}</li>
            ))}
          </ul>
        ),
      )}

      {section(
        "contracts",
        t("contracts.heading"),
        s.contracts.length === 0 ? (
          none
        ) : (
          <GestoreTable
            label={t("contracts.heading")}
            testId="statement-contracts"
            headers={[t("contracts.title"), t("contracts.type"), t("contracts.status"), t("contracts.period"), t("contracts.rent"), t("contracts.manager"), t("contracts.registered")]}
            rows={s.contracts.map((c) => ({
              key: c.id,
              cells: [
                <Link key="l" href={`/locazioni/${c.id}`} className="underline underline-offset-2">
                  {c.title}
                </Link>,
                tl(`types.${c.type as "residential"}`),
                tl(`status.${c.status as "active"}`),
                period(c.startsOn, c.endsOn),
                c.monthlyRentCents !== null ? money(c.monthlyRentCents) : "",
                c.managerName ?? "",
                c.registered ? tc("yes") : tc("no"),
              ],
            }))}
          />
        ),
      )}

      {section(
        "rents",
        t("rents.heading"),
        s.rents.length === 0 ? (
          none
        ) : (
          <GestoreTable
            label={t("rents.heading")}
            testId="statement-rents"
            headers={[t("rents.due"), t("rents.letting"), t("rents.amount"), t("rents.paid"), t("rents.paidOn"), t("rents.state"), t("rents.proof")]}
            rows={s.rents.map((r, i) => ({
              key: `${r.lettingId}-${r.dueOn}-${i}`,
              cells: [date(r.dueOn), r.lettingTitle, money(r.amountCents), money(r.paidCents), date(r.paidOn), <Badge key="b" variant={r.state === "overdue" ? "destructive" : "secondary"}>{t(`rents.states.${r.state}`)}</Badge>, r.paidCents > 0 ? (r.hasProof ? tc("yes") : tc("no")) : ""],
            }))}
            footer={
              <tr className="font-semibold">
                <th scope="row" colSpan={2} className="py-2 pr-4 text-left">
                  {t("rents.total")}
                </th>
                <td className="py-2 pr-4" data-testid="rents-due">
                  {money(s.rentTotals.dueCents)}
                </td>
                <td className="py-2 pr-4" data-testid="rents-paid">
                  {money(s.rentTotals.paidCents)}
                </td>
                <td colSpan={3} className="py-2 pr-4 font-normal">
                  {t("rents.overdue")}: {money(s.rentTotals.overdueCents)}
                </td>
              </tr>
            }
          />
        ),
      )}

      {section(
        "ledger",
        t("ledger.heading"),
        <>
          {ledgerBlock("receipts", s.receipts, s.totals.receiptsCents, "totalReceipts")}
          {ledgerBlock("payments", s.payments, s.totals.paymentsCents, "totalPayments")}
          <p className="text-sm font-medium" data-testid="total-difference">
            {t("ledger.difference")}: {money(s.totals.differenceCents)}
          </p>
          <p className="text-xs text-muted-foreground">{t("ledger.note")}</p>
        </>,
      )}

      {section(
        "works",
        t("works.heading"),
        s.works.length === 0 ? (
          none
        ) : (
          <GestoreTable
            label={t("works.heading")}
            testId="statement-works"
            headers={[t("works.title"), t("works.stage"), t("works.supplier"), t("works.quoted"), t("works.invoiced"), t("works.paid"), t("works.dates")]}
            rows={s.works.map((w) => ({
              key: w.id,
              cells: [
                <Link key="l" href={`/manutenzioni/${w.id}`} className="underline underline-offset-2">
                  {w.title}
                </Link>,
                t(`works.stages.${w.stage}`),
                w.supplierName ?? "",
                money(w.acceptedQuotesCents),
                money(w.invoicedCents),
                money(w.paidCents),
                [w.scheduledOn, w.startedOn, w.completedOn].filter((d): d is string => Boolean(d)).map(formatDate).join(" · "),
              ],
            }))}
          />
        ),
      )}

      {section(
        "codes",
        t("codes.heading"),
        s.codes.length === 0 ? (
          none
        ) : (
          <GestoreTable
            label={t("codes.heading")}
            testId="statement-codes"
            headers={[t("codes.letting"), t("codes.label"), t("codes.value"), t("codes.validUntil")]}
            rows={s.codes.map((c, i) => ({
              key: String(i),
              cells: [c.lettingTitle, c.label, c.value, <span key="v">{date(c.validUntil)} <Badge variant={c.state === "expired" ? "destructive" : "secondary"}>{t(`codes.states.${c.state}`)}</Badge></span>],
            }))}
          />
        ),
      )}

      {section(
        "reports",
        t("reports.heading"),
        s.reports.length === 0 ? (
          none
        ) : (
          <GestoreTable
            label={t("reports.heading")}
            testId="statement-reports"
            headers={[t("reports.letting"), t("reports.title"), t("reports.period"), t("reports.due"), t("reports.done")]}
            rows={s.reports.map((r, i) => ({
              key: String(i),
              cells: [r.lettingTitle, r.title, r.period ?? "", date(r.dueOn), r.done ? date(r.doneOn) : r.overdue ? t("reports.overdue") : t("reports.open")],
            }))}
          />
        ),
      )}

      {section(
        "mandates",
        t("mandates.heading"),
        <>
          {s.mandates.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("mandates.empty")}</p>
          ) : (
            <ul className="list-disc pl-5 text-sm" data-testid="statement-mandates">
              {s.mandates.map((m) => (
                <li key={m.id}>{[m.managerName, m.endsOn ? formatDate(m.endsOn) : null, m.compensation].filter(Boolean).join(" · ")}</li>
              ))}
            </ul>
          )}
          <Link href="/locazioni/mandati" className="text-sm underline underline-offset-2 print:hidden">
            {t("mandates.manage")}
          </Link>
        </>,
      )}
    </div>
  );
}
