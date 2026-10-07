import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BUDGET_KINDS, BUDGET_SCOPES, type CondominiumDetail } from "@/modules/condominium";
import Link from "next/link";
import { getDb } from "@/platform/db/client";
import { listDocumentOptions } from "@/modules/documents";
import { InlineForm } from "@/components/inline-form";
import { formatDate, formatEuro } from "@/lib/format";
import { createBudgetAction, createYearAction, generateInstallmentsAction, recordPaymentAction } from "../actions";

export async function EserciziSection({ condo }: { condo: CondominiumDetail }) {
  const t = await getTranslations("condominium.years");
  const tableOptions = condo.tables.map((x) => ({ value: x.id, label: x.name }));
  const documentOptions = await listDocumentOptions(getDb());

  return (
    <div className="flex flex-col gap-6">
      {condo.years.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
      {condo.years.map((year) => (
        <Card key={year.id} data-testid="fiscal-year">
          <CardHeader>
            <CardTitle>
              <h2>{year.label}</h2>
            </CardTitle>
            <p className="text-sm text-muted-foreground">{t("period", { from: formatDate(year.startsOn), to: formatDate(year.endsOn) })}</p>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <h3 className="text-sm font-medium">{t("budgets")}</h3>
            {year.budgets.length === 0 ? <p className="text-sm text-muted-foreground">{t("noBudgets")}</p> : null}
            {year.budgets.map((b) => (
              <section key={b.id} aria-labelledby={`budget-${b.id}`} className="flex flex-col gap-3 rounded-lg border p-4" data-testid="budget">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 id={`budget-${b.id}`} className="font-medium">
                    {b.title}
                  </h4>
                  <Badge variant="secondary">{t(`kind.${b.kind}`)}</Badge>
                  <span className="text-sm">{t("total", { amount: formatEuro(b.totalCents) })}</span>
                  {b.scope === "building" ? <Badge variant="outline">{t("scopeBuilding")}</Badge> : null}
                </div>
                {b.tableName ? <p className="text-sm text-muted-foreground">{t("table", { name: b.tableName })}</p> : null}
                {b.note ? <p className="text-sm text-muted-foreground">{b.note}</p> : null}
                {b.installments.length > 0 ? <p className="text-sm font-medium">{t("progress", { paid: formatEuro(b.paidCents), due: formatEuro(b.dueCents) })}</p> : null}

                <details className="text-sm">
                  <summary className="cursor-pointer font-medium">{t("installments")}</summary>
                  {b.installments.length === 0 ? <p className="mt-2 text-muted-foreground">{t("noInstallments")}</p> : null}
                  <ul className="mt-2 flex flex-col divide-y">
                    {b.installments.map((i) => (
                      <li key={i.id} className="flex flex-col gap-2 py-2" data-testid="installment">
                        <div className="flex flex-wrap items-center gap-2">
                          <span>{t("installmentLine", { number: i.number, asset: i.assetName, date: formatDate(i.dueOn), amount: formatEuro(i.amountCents) })}</span>
                          <Badge variant={i.paid ? "secondary" : "outline"}>{i.paid ? t("paid") : i.paidCents > 0 ? t("partial", { paid: formatEuro(i.paidCents) }) : t("unpaid")}</Badge>
                          {i.documentId && i.documentTitle ? (
                            <Link href={`/documenti/${i.documentId}`} className="underline underline-offset-2">
                              {i.documentTitle}
                            </Link>
                          ) : i.paidCents > 0 ? (
                            <span className="text-muted-foreground">{t("payNoProof")}</span>
                          ) : null}
                        </div>
                        <details className="print:hidden">
                          <summary className="cursor-pointer text-muted-foreground">
                            {t("payButton")}
                            <span className="sr-only">: {t("installmentLine", { number: i.number, asset: i.assetName, date: formatDate(i.dueOn), amount: formatEuro(i.amountCents) })}</span>
                          </summary>
                          <InlineForm
                            idPrefix={`pay-${i.id}`}
                            title={t("payButton")}
                            fields={[
                              { kind: "text", name: "paid", label: t("payAmount"), inputMode: "decimal", maxLength: 14 },
                              { kind: "date", name: "paidOn", label: t("payDate") },
                              { kind: "select", name: "documentId", label: t("payProof"), options: documentOptions, emptyLabel: t("payNoDocument") },
                            ]}
                            initial={{ paid: i.paidCents > 0 ? formatEuro(i.paidCents) : "", paidOn: i.paidOn ?? "", documentId: i.documentId ?? "" }}
                            submitLabel={t("payButton")}
                            onSubmit={recordPaymentAction.bind(null, condo.id, i.id)}
                          />
                        </details>
                      </li>
                    ))}
                  </ul>
                </details>

                {b.millesimalTableId ? (
                  <>
                    <p className="text-sm text-muted-foreground">{t("planIntro")}</p>
                    <InlineForm
                      idPrefix={`plan-${b.id}`}
                      title={t("planHeading")}
                      fields={[
                        { kind: "text", name: "count", label: t("planCount"), inputMode: "numeric", maxLength: 3 },
                        { kind: "date", name: "firstDueOn", label: t("planFirst") },
                        { kind: "text", name: "everyMonths", label: t("planEvery"), inputMode: "numeric", maxLength: 2 },
                        { kind: "checkbox", name: "createDeadlines", label: t("planDeadlines") },
                      ]}
                      initial={{ count: "4", firstDueOn: "", everyMonths: "3", createDeadlines: false }}
                      submitLabel={t("planButton")}
                      onSubmit={generateInstallmentsAction.bind(null, condo.id, b.id)}
                    />
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("planNeedsTable")}</p>
                )}
              </section>
            ))}

            <InlineForm
              idPrefix={`budget-form-${year.id}`}
              title={t("budgetAdd")}
              fields={[
                { kind: "select", name: "kind", label: t("budgetKind"), options: BUDGET_KINDS.map((k) => ({ value: k, label: t(`kind.${k}`) })) },
                { kind: "text", name: "title", label: t("budgetTitle"), maxLength: 200 },
                { kind: "text", name: "total", label: t("budgetTotal"), inputMode: "decimal", maxLength: 14 },
                { kind: "select", name: "millesimalTableId", label: t("budgetTable"), options: tableOptions, emptyLabel: t("budgetNoTable") },
                { kind: "select", name: "scope", label: t("budgetScope"), options: BUDGET_SCOPES.map((s) => ({ value: s, label: t(`scope.${s}`) })) },
                { kind: "text", name: "note", label: t("budgetNote"), maxLength: 500 },
              ]}
              initial={{ kind: "ordinary", title: "", total: "", millesimalTableId: "", scope: "owner_only", note: "" }}
              submitLabel={t("budgetAdd")}
              onSubmit={createBudgetAction.bind(null, condo.id, year.id)}
            />
          </CardContent>
        </Card>
      ))}

      <InlineForm
        idPrefix="year"
        title={t("addHeading")}
        fields={[
          { kind: "text", name: "label", label: t("label"), hint: t("labelHint"), maxLength: 60 },
          { kind: "date", name: "startsOn", label: t("startsOn") },
          { kind: "date", name: "endsOn", label: t("endsOn") },
        ]}
        initial={{ label: "", startsOn: "", endsOn: "" }}
        submitLabel={t("add")}
        onSubmit={createYearAction.bind(null, condo.id)}
      />
    </div>
  );
}
