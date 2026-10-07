import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Download } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { RESOLUTION_OUTCOMES, filterResolutions, formatMilli, getOwnerReview, type OwnerReview, type ResolutionRegisterRow } from "@/modules/condominium";
import { PrintButton } from "@/components/print-button";
import { ScrollRegion } from "@/components/scroll-region";
import { isUuid } from "@/lib/ids";
import { cn } from "@/lib/utils";
import { formatDate, formatEuro } from "@/lib/format";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("condominioAdmin");
  return { title: t("title") };
}

const VIEWS = ["versamenti", "consegne", "delibere"] as const;
type View = (typeof VIEWS)[number];
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function CondominiumReviewPage({ searchParams }: PageProps<"/condominio/controllo">) {
  await requireOwner();
  const t = await getTranslations("condominioAdmin");
  const params = await searchParams;
  const view: View = (VIEWS as readonly string[]).includes(first(params.vista)) ? (first(params.vista) as View) : "versamenti";
  const condoParam = first(params.condominio);
  const condominiumId = isUuid(condoParam) ? condoParam : undefined;
  const outcome = (RESOLUTION_OUTCOMES as readonly string[]).includes(first(params.esito)) ? first(params.esito) : "";
  const year = /^\d{4}$/.test(first(params.anno)) ? Number(first(params.anno)) : undefined;
  const withoutFollowUp = first(params.senzaSeguito) === "1";

  const review = await getOwnerReview(getDb());
  const query = new URLSearchParams({ vista: view });
  if (condominiumId) query.set("condominio", condominiumId);
  if (view === "delibere") {
    if (outcome) query.set("esito", outcome);
    if (year) query.set("anno", String(year));
    if (withoutFollowUp) query.set("senzaSeguito", "1");
  }
  const money = (cents: number) => t("amount", { amount: formatEuro(cents) });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <Alert>
        <AlertDescription>{t("intro")}</AlertDescription>
      </Alert>

      <nav aria-label={t("viewsLabel")} className="print:hidden">
        <ul className="flex flex-wrap gap-2">
          {VIEWS.map((v) => (
            <li key={v}>
              <Link
                href={`/condominio/controllo?vista=${v}${condominiumId ? `&condominio=${condominiumId}` : ""}`}
                aria-current={v === view ? "page" : undefined}
                className={cn(buttonVariants({ variant: v === view ? "secondary" : "outline", size: "sm" }), v === view && "font-semibold")}
              >
                {t(`views.${v}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {review.condominiums.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noCondominiums")}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3 print:hidden">
            <form method="get" className="flex flex-wrap items-end gap-3" role="search">
              <input type="hidden" name="vista" value={view} />
              <div className="flex w-56 flex-col gap-2">
                <Label htmlFor="condominio">{t("filters.condominium")}</Label>
                <NativeSelect id="condominio" name="condominio" defaultValue={condominiumId ?? ""}>
                  <option value="">{t("filters.all")}</option>
                  {review.condominiums.map((c) => (
                    <option key={c.condominiumId} value={c.condominiumId}>
                      {c.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              {view === "delibere" ? (
                <>
                  <div className="flex w-48 flex-col gap-2">
                    <Label htmlFor="esito">{t("filters.outcome")}</Label>
                    <NativeSelect id="esito" name="esito" defaultValue={outcome}>
                      <option value="">{t("filters.anyOutcome")}</option>
                      {RESOLUTION_OUTCOMES.map((o) => (
                        <option key={o} value={o}>
                          {t(`outcomes.${o}`)}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="flex w-40 flex-col gap-2">
                    <Label htmlFor="anno">{t("filters.year")}</Label>
                    <NativeSelect id="anno" name="anno" defaultValue={year ? String(year) : ""}>
                      <option value="">{t("filters.anyYear")}</option>
                      {[...new Set(review.resolutions.map((r) => r.meetingOn.slice(0, 4)))]
                        .sort()
                        .reverse()
                        .map((y) => (
                          <option key={y} value={y}>
                            {y}
                          </option>
                        ))}
                    </NativeSelect>
                  </div>
                  <div className="flex items-center gap-2 pb-2">
                    <input id="senzaSeguito" name="senzaSeguito" type="checkbox" value="1" defaultChecked={withoutFollowUp} className="size-4" />
                    <Label htmlFor="senzaSeguito">{t("filters.withoutFollowUp")}</Label>
                  </div>
                </>
              ) : null}
              <Button type="submit" variant="secondary">
                {t("filters.apply")}
              </Button>
            </form>
            <PrintButton />
            <a href={`/api/condominio/controllo?${query.toString()}`} className={buttonVariants({ variant: "outline" })}>
              <Download aria-hidden /> {t("csv")}
            </a>
          </div>

          {view === "versamenti" ? <Statements review={review} condominiumId={condominiumId} money={money} /> : null}
          {view === "consegne" ? <Deliveries review={review} condominiumId={condominiumId} /> : null}
          {view === "delibere" ? <Register rows={filterResolutions(review.resolutions, { condominiumId, outcome: outcome || undefined, year, withoutFollowUp })} /> : null}
        </>
      )}
    </div>
  );
}

type Money = (cents: number) => string;

async function Statements({ review, condominiumId, money }: { review: OwnerReview; condominiumId: string | undefined; money: Money }) {
  const t = await getTranslations("condominioAdmin");
  const th = "py-2 pr-4 font-medium";
  const thr = "py-2 pr-4 text-right font-medium";
  return (
    <div className="flex flex-col gap-8" data-testid="review-statements">
      <p className="text-sm text-muted-foreground">{t("versamenti.intro")}</p>
      {review.condominiums
        .filter((c) => !condominiumId || c.condominiumId === condominiumId)
        .map((c) => (
          <section key={c.condominiumId} aria-labelledby={`condo-${c.condominiumId}`} className="flex flex-col gap-4">
            <h2 id={`condo-${c.condominiumId}`} className="text-lg font-semibold">
              <Link href={`/condominio/${c.condominiumId}?sezione=esercizi`} className="hover:underline">
                {c.name}
              </Link>
            </h2>
            <p className="text-sm" data-testid="overdue-total">
              {t("versamenti.overdueTotal", { amount: formatEuro(c.overdueCents) })}
            </p>
            {c.years.map((y) => (
              <div key={y.yearId} className="flex flex-col gap-3" data-testid="review-year">
                <h3 className="font-medium">
                  {t("versamenti.yearHeading", { label: y.label })} <span className="text-sm font-normal text-muted-foreground">{t("versamenti.period", { from: formatDate(y.startsOn), to: formatDate(y.endsOn) })}</span>
                </h3>
                {y.tablesNotThousand.length > 0 ? <p className="text-sm text-muted-foreground">{t("versamenti.notThousand", { tables: y.tablesNotThousand.join(", ") })}</p> : null}
                {y.lines.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("versamenti.empty")}</p>
                ) : (
                  <ScrollRegion label={t("versamenti.caption", { label: y.label })}>
                    <table className="w-full text-left text-sm">
                      <caption className="sr-only">{t("versamenti.caption", { label: y.label })}</caption>
                      <thead>
                        <tr className="border-b">
                          <th scope="col" className={th}>
                            {t("versamenti.cols.item")}
                          </th>
                          <th scope="col" className={th}>
                            {t("versamenti.cols.asset")}
                          </th>
                          <th scope="col" className={thr}>
                            {t("versamenti.cols.count")}
                          </th>
                          <th scope="col" className={thr}>
                            {t("versamenti.cols.amount")}
                          </th>
                          <th scope="col" className={thr}>
                            {t("versamenti.cols.paid")}
                          </th>
                          <th scope="col" className={thr}>
                            {t("versamenti.cols.residual")}
                          </th>
                          <th scope="col" className={thr}>
                            {t("versamenti.cols.overdue")}
                          </th>
                          <th scope="col" className="py-2 font-medium">
                            {t("versamenti.cols.next")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {y.lines.map((l) => (
                          <tr key={`${l.budgetId}-${l.assetId}`} className="border-b">
                            <th scope="row" className="py-2 pr-4 font-normal">
                              {l.budgetTitle}
                              <span className="block text-xs text-muted-foreground">{t(`kinds.${l.kind}`)}</span>
                            </th>
                            <td className="py-2 pr-4">{l.assetName}</td>
                            <td className="py-2 pr-4 text-right">{l.installments}</td>
                            <td className="py-2 pr-4 text-right">{money(l.amountCents)}</td>
                            <td className="py-2 pr-4 text-right">{money(l.paidCents)}</td>
                            <td className="py-2 pr-4 text-right">{money(l.residualCents)}</td>
                            <td className="py-2 pr-4 text-right">{money(l.overdueCents)}</td>
                            <td className="py-2">{l.nextDueOn ? formatDate(l.nextDueOn) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </ScrollRegion>
                )}
                <p className="text-sm font-medium">{t("versamenti.totals", { amount: formatEuro(y.amountCents), paid: formatEuro(y.paidCents), overdue: formatEuro(y.overdueCents) })}</p>
                {y.finalVsBudgetsCents !== null ? <p className="text-sm">{t("versamenti.budgetsVsFinal", { budgets: formatEuro(y.budgetsTotalCents), final: formatEuro(y.finalTotalCents), diff: formatEuro(y.finalVsBudgetsCents) })}</p> : null}
                {y.comparisons.length > 0 ? (
                  <div className="flex flex-col gap-2" data-testid="review-comparison">
                    <h4 className="text-sm font-medium">{t("versamenti.compareHeading")}</h4>
                    <p className="text-sm text-muted-foreground">{t("versamenti.compareIntro")}</p>
                    <ScrollRegion label={t("versamenti.compareCaption", { label: y.label })}>
                      <table className="w-full text-left text-sm">
                        <caption className="sr-only">{t("versamenti.compareCaption", { label: y.label })}</caption>
                        <thead>
                          <tr className="border-b">
                            <th scope="col" className={th}>
                              {t("versamenti.compareCols.final")}
                            </th>
                            <th scope="col" className={th}>
                              {t("versamenti.compareCols.asset")}
                            </th>
                            <th scope="col" className={thr}>
                              {t("versamenti.compareCols.quota")}
                            </th>
                            <th scope="col" className={thr}>
                              {t("versamenti.compareCols.paid")}
                            </th>
                            <th scope="col" className="py-2 text-right font-medium">
                              {t("versamenti.compareCols.diff")}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {y.comparisons.map((k) => (
                            <tr key={`${k.finalBudgetId}-${k.assetId}`} className="border-b">
                              <th scope="row" className="py-2 pr-4 font-normal">
                                {k.finalTitle}
                              </th>
                              <td className="py-2 pr-4">{k.assetName}</td>
                              <td className="py-2 pr-4 text-right">{money(k.quotaCents)}</td>
                              <td className="py-2 pr-4 text-right">{money(k.paidOnBudgetsCents)}</td>
                              <td className="py-2 text-right">{money(k.differenceCents)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </ScrollRegion>
                  </div>
                ) : null}
              </div>
            ))}
          </section>
        ))}
    </div>
  );
}

async function Deliveries({ review, condominiumId }: { review: OwnerReview; condominiumId: string | undefined }) {
  const t = await getTranslations("condominioAdmin");
  return (
    <div className="flex flex-col gap-8" data-testid="review-deliveries">
      <p className="text-sm text-muted-foreground">{t("consegne.intro")}</p>
      {review.condominiums
        .filter((c) => !condominiumId || c.condominiumId === condominiumId)
        .map((c) => (
          <section key={c.condominiumId} aria-labelledby={`facts-${c.condominiumId}`} className="flex flex-col gap-3">
            <h2 id={`facts-${c.condominiumId}`} className="text-lg font-semibold">
              {c.name}
            </h2>
            {c.facts.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("consegne.empty")}</p>
            ) : (
              <ul className="flex flex-col divide-y rounded-lg border">
                {c.facts.map((f, i) => (
                  <li key={`${f.kind}-${f.subject}-${i}`} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm" data-testid="delivery-fact">
                    <span>{t(`consegne.facts.${f.kind}`, { subject: f.subject, date: f.date ? formatDate(f.date) : "", days: f.daysSince ?? 0 })}</span>
                    <Link href={f.href} className="underline underline-offset-4 print:hidden">
                      {t("consegne.open")}
                      <span className="sr-only">: {t(`consegne.short.${f.kind}`)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
    </div>
  );
}

async function Register({ rows }: { rows: ResolutionRegisterRow[] }) {
  const t = await getTranslations("condominioAdmin");
  const th = "py-2 pr-4 font-medium";
  return (
    <div className="flex flex-col gap-3" data-testid="review-register">
      <p className="text-sm text-muted-foreground">{t("delibere.intro")}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("delibere.empty")}</p>
      ) : (
        <ScrollRegion label={t("delibere.caption")}>
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{t("delibere.caption")}</caption>
            <thead>
              <tr className="border-b">
                <th scope="col" className={th}>
                  {t("delibere.cols.date")}
                </th>
                <th scope="col" className={th}>
                  {t("delibere.cols.condominium")}
                </th>
                <th scope="col" className={th}>
                  {t("delibere.cols.title")}
                </th>
                <th scope="col" className={th}>
                  {t("delibere.cols.outcome")}
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">
                  {t("delibere.cols.votes")}
                </th>
                <th scope="col" className="py-2 font-medium">
                  {t("delibere.cols.followUp")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const follow = [r.hasDeadline ? t("delibere.followUp.deadline") : null, r.hasBudget ? t("delibere.followUp.budget") : null, r.workCount > 0 ? t("delibere.followUp.works", { count: r.workCount }) : null].filter(Boolean).join(", ");
                const dash = t("delibere.noValue");
                return (
                  <tr key={r.id} className="border-b align-top">
                    <td className="py-2 pr-4">
                      <Link href={`/condominio/${r.condominiumId}/assemblee/${r.meetingId}`} className="underline underline-offset-4">
                        {formatDate(r.meetingOn)}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">{r.condominiumName}</td>
                    <th scope="row" className="py-2 pr-4 font-normal">
                      {r.title}
                      {r.voteNote ? <span className="block text-xs text-muted-foreground">{r.voteNote}</span> : null}
                    </th>
                    <td className="py-2 pr-4">{t(`outcomes.${r.outcome as "approved"}`)}</td>
                    <td className="py-2 pr-4 text-right">{r.votesFor === null && r.threshold === null ? dash : t("delibere.votes", { votes: r.votesFor === null ? dash : formatMilli(r.votesFor), threshold: r.threshold === null ? dash : formatMilli(r.threshold) })}</td>
                    <td className="py-2">{follow === "" ? t("delibere.followUp.none") : follow}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollRegion>
      )}
    </div>
  );
}
