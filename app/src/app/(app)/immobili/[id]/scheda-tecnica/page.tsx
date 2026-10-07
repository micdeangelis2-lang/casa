import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Download } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PrintButton } from "@/components/print-button";
import { ScrollRegion } from "@/components/scroll-region";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { getTechnicalBrief, workDate } from "@/modules/technical";
import { listEngagements } from "@/modules/engagements";
import { formatDate, formatEuro } from "@/lib/format";
import { isUuid } from "@/lib/ids";
import { EngagementSummary } from "../../../pratiche/incarichi/_components/engagement-summary";

type Props = PageProps<"/immobili/[id]/scheda-tecnica">;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("tecnico");
  return { title: t("title") };
}

export default async function TechnicalBriefPage({ params }: Props) {
  await requireOwner();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const brief = await getTechnicalBrief(getDb(), id);
  if (!brief) notFound();

  const t = await getTranslations("tecnico");
  const ta = await getTranslations("assets");
  const tc = await getTranslations("common");
  const tdoc = await getTranslations("documents");
  const tdos = await getTranslations("dossier");
  const tm = await getTranslations("maintenance");
  const tmatter = await getTranslations("matters");
  const te = await getTranslations("engagements");
  const engagements = await listEngagements(getDb(), { assetId: brief.asset.id });
  const a = brief.asset;
  const money = (cents: number | null) => (cents === null ? "" : t("works.amount", { amount: formatEuro(cents) }));
  const period = (from: string | null, to: string | null) =>
    [from ? t("cadastral.from", { date: formatDate(from) }) : null, to ? t("cadastral.to", { date: formatDate(to) }) : null].filter(Boolean).join(" ");
  const packageHref = `/condivisione/nuovo?immobile=${a.id}&${brief.documents.technicalCategoryIds.map((c) => `categoria=${c}`).join("&")}&destinatario=technician&scheda=technical&mostra=1`;
  const th = "pr-3 text-left font-medium text-muted-foreground";

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-lg">{a.name}</p>
          <p className="text-sm text-muted-foreground">{t("preparedOn", { date: formatDate(brief.today) })}</p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <PrintButton />
          <a href={`/api/immobili/${a.id}/scheda-tecnica`} className={buttonVariants({ variant: "outline" })}>
            <Download aria-hidden /> {t("csv")}
          </a>
          <Link href={`/immobili/${a.id}`} className={buttonVariants({ variant: "outline" })}>
            {t("back")}
          </Link>
        </div>
      </div>
      <Alert>
        <AlertDescription>{t("intro")}</AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("asset.heading")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted-foreground">{t("asset.kind")}</dt>
            <dd>{ta(`kind.${a.kind as "dwelling"}`)}</dd>
            {a.useType ? (
              <>
                <dt className="text-muted-foreground">{t("asset.use")}</dt>
                <dd>{ta(`use.${a.useType as "let"}`)}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">{t("asset.territory")}</dt>
            <dd>{a.territoryLabel}</dd>
            {a.locality ? (
              <>
                <dt className="text-muted-foreground">{t("asset.locality")}</dt>
                <dd>{a.locality}</dd>
              </>
            ) : null}
            {a.address || a.postalCode ? (
              <>
                <dt className="text-muted-foreground">{t("asset.address")}</dt>
                <dd>{[a.address, a.postalCode].filter(Boolean).join(" – ")}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">{t("asset.condominium")}</dt>
            <dd>{a.inCondominium ? tc("yes") : tc("no")}</dd>
            {a.notes ? (
              <>
                <dt className="text-muted-foreground">{t("asset.notes")}</dt>
                <dd className="whitespace-pre-wrap">{a.notes}</dd>
              </>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("attributes.heading")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {Object.keys(a.attributes).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("attributes.none")}</p>
          ) : (
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[14rem_1fr]" data-testid="brief-attributes">
              {Object.entries(a.attributes).map(([name, value]) => (
                <div key={name} className="contents">
                  <dt className="font-mono text-muted-foreground">{name}</dt>
                  <dd>{typeof value === "boolean" ? (value ? tc("yes") : tc("no")) : String(value)}</dd>
                </div>
              ))}
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("cadastral.heading")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {a.cadastral.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("cadastral.none")}</p>
          ) : (
            <ScrollRegion label={t("cadastral.table")}>
              <table className="w-full text-sm" data-testid="brief-cadastral">
                <thead>
                  <tr>
                    <th scope="col" className={th}>{t("cadastral.sheet")}</th>
                    <th scope="col" className={th}>{t("cadastral.parcel")}</th>
                    <th scope="col" className={th}>{t("cadastral.subunit")}</th>
                    <th scope="col" className={th}>{t("cadastral.category")}</th>
                    <th scope="col" className={th}>{t("cadastral.class")}</th>
                    <th scope="col" className={th}>{t("cadastral.consistency")}</th>
                    <th scope="col" className={th}>{t("cadastral.income")}</th>
                    <th scope="col" className={th}>{t("cadastral.validity")}</th>
                  </tr>
                </thead>
                <tbody>
                  {a.cadastral.map((c, i) => (
                    <tr key={i} className="border-t align-top">
                      <td className="pr-3">{c.sheet}</td>
                      <td className="pr-3">{c.parcel}</td>
                      <td className="pr-3">{c.subunit}</td>
                      <td className="pr-3">{c.cadastralCategory}</td>
                      <td className="pr-3">{c.cadastralClass}</td>
                      <td className="pr-3">{c.consistency}</td>
                      <td className="pr-3">{money(c.incomeCents)}</td>
                      <td>{period(c.validFrom, c.validTo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("rights.heading")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {a.rights.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("rights.none")}</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm" data-testid="brief-rights">
              {a.rights.map((r, i) => (
                <li key={i}>
                  <span className="font-medium">{r.holderName}</span> – {ta(`right.${r.rightType as "full"}`)}, {t("rights.quota", { numerator: r.quotaNumerator, denominator: r.quotaDenominator })}
                  {period(r.validFrom, r.validTo) ? <span className="text-muted-foreground"> ({period(r.validFrom, r.validTo)})</span> : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("documents.heading")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <p>{t("documents.summary", { count: brief.documents.groups.reduce((n, g) => n + g.documents.length, 0), expired: brief.documents.expiredCount })}</p>
          {brief.documents.groups
            .filter((g) => g.documents.length > 0)
            .map((g) => (
              <div key={g.category.id}>
                <h3 className="mb-1 font-medium">{g.category.name}</h3>
                <ul className="flex flex-col gap-1" data-testid="brief-documents">
                  {g.documents.map((d) => (
                    <li key={d.id}>
                      <Link href={`/documenti/${d.id}`} className="underline underline-offset-2">
                        {d.title}
                      </Link>
                      <span className="text-muted-foreground">
                        {d.issuedOn ? ` – ${t("documents.issued", { date: formatDate(d.issuedOn) })}` : ""}
                        {d.validTo ? ` – ${t("documents.validTo", { date: formatDate(d.validTo) })}` : ""}
                      </span>{" "}
                      <Badge variant="outline">{tdoc(`status.${d.verificationStatus as "draft"}`)}</Badge> {d.expired ? <Badge variant="secondary">{t("documents.expired")}</Badge> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          {brief.documents.emptyCategories.length > 0 ? (
            <div data-testid="brief-empty-categories">
              <h3 className="mb-1 font-medium">{t("documents.emptyHeading")}</h3>
              <p className="text-muted-foreground">{t("documents.emptyBody")}</p>
              <ul className="mt-1 list-disc pl-5">
                {brief.documents.emptyCategories.map((c) => (
                  <li key={c.id}>{c.name}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {brief.documents.otherCount > 0 ? <p className="text-muted-foreground">{t("documents.others", { count: brief.documents.otherCount })}</p> : null}
          <div className="print:hidden">
            <Link href={packageHref} className={buttonVariants({ variant: "outline" })} aria-describedby="package-hint">
              {t("package")}
            </Link>
            <p id="package-hint" className="mt-1 text-muted-foreground">
              {t("packageHint")}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle>
            <h2>{t("dossier.heading")}</h2>
          </CardTitle>
          <Link href={`/immobili/${a.id}/dossier`} className={buttonVariants({ variant: "outline", size: "sm" }) + " print:hidden"}>
            {t("dossier.open")}
          </Link>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <p className="text-muted-foreground">{t("dossier.summary", { total: brief.dossier.total })}</p>
          {brief.dossier.toCollect.length === 0 ? (
            <p>{t("dossier.none")}</p>
          ) : (
            <ul className="flex flex-col gap-1" data-testid="brief-dossier">
              {brief.dossier.toCollect.map((i) => (
                <li key={i.id}>
                  <span className="text-muted-foreground">{i.categoryName}: </span>
                  {i.title} <Badge variant="outline">{tdos(`status.${i.status as "missing"}`)}</Badge> {i.stale ? <Badge variant="secondary">{t("dossier.stale")}</Badge> : null}{" "}
                  <span className="text-muted-foreground">({t("dossier.documents", { count: i.documentCount })})</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("works.heading")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {brief.works.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("works.none")}</p>
          ) : (
            <ScrollRegion label={t("works.table")}>
              <table className="w-full text-sm" data-testid="brief-works">
                <thead>
                  <tr>
                    <th scope="col" className={th}>{t("works.date")}</th>
                    <th scope="col" className={th}>{t("works.title")}</th>
                    <th scope="col" className={th}>{t("works.status")}</th>
                    <th scope="col" className={th}>{t("works.supplier")}</th>
                    <th scope="col" className={th}>{t("works.budget")}</th>
                    <th scope="col" className={th}>{t("works.accepted")}</th>
                    <th scope="col" className={th}>{t("works.invoiced")}</th>
                    <th scope="col" className={th}>{t("works.paid")}</th>
                    <th scope="col" className={th}>{t("works.progress")}</th>
                  </tr>
                </thead>
                <tbody>
                  {brief.works.rows.map((w) => (
                    <tr key={w.id} className="border-t align-top">
                      <td className="pr-3">{workDate(w) ? formatDate(workDate(w)!) : t("works.noDate")}</td>
                      <td className="pr-3">
                        <Link href={`/manutenzioni/${w.id}`} className="underline underline-offset-2">
                          {w.title}
                        </Link>
                      </td>
                      <td className="pr-3">{tm(`status.${w.status as "planned"}`)}</td>
                      <td className="pr-3">{w.supplierName}</td>
                      <td className="pr-3">{money(w.budgetCents)}</td>
                      <td className="pr-3">{money(w.acceptedQuotesCents)}</td>
                      <td className="pr-3">{money(w.invoicedCents)}</td>
                      <td className="pr-3">{money(w.paidCents)}</td>
                      <td>{w.lastPercent !== null ? `${w.lastPercent}%` : ""}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t font-medium">
                    <th scope="row" colSpan={5} className="pr-3 text-left">
                      {t("works.totals")}
                    </th>
                    <td className="pr-3" data-testid="brief-total-accepted">{money(brief.works.totals.acceptedQuotesCents)}</td>
                    <td className="pr-3" data-testid="brief-total-invoiced">{money(brief.works.totals.invoicedCents)}</td>
                    <td className="pr-3" data-testid="brief-total-paid">{money(brief.works.totals.paidCents)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </ScrollRegion>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("warranties.heading")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {brief.warranties.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("warranties.none")}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm" data-testid="brief-warranties">
              {brief.warranties.map((w) => (
                <li key={w.id}>
                  {w.title} – {w.startsOn ? t("warranties.line", { from: formatDate(w.startsOn), to: formatDate(w.endsOn) }) : t("warranties.untilOnly", { to: formatDate(w.endsOn) })}{" "}
                  <Badge variant="outline">{tm(`warranties.state.${w.state as "active"}`)}</Badge>
                  {w.workTitle ? <span className="text-muted-foreground"> – {t("warranties.work", { title: w.workTitle })}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("plans.heading")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {brief.plans.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("plans.none")}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm" data-testid="brief-plans">
              {brief.plans.map((p) => (
                <li key={p.id}>
                  {p.title} – {t("plans.every", { months: p.intervalMonths })}
                  {p.nextDueOn ? `, ${t("plans.next", { date: formatDate(p.nextDueOn) })}` : ""}
                  {p.lastDoneOn ? `, ${t("plans.last", { date: formatDate(p.lastDoneOn) })}` : ""}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("deadlines.heading")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {brief.deadlines.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("deadlines.none")}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm" data-testid="brief-deadlines">
              {brief.deadlines.map((d) => (
                <li key={d.id}>
                  {formatDate(d.dueOn)} – {d.title} {d.overdue ? <Badge variant="secondary">{t("deadlines.overdue")}</Badge> : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("matters.heading")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {brief.matters.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("matters.none")}</p>
          ) : (
            <ul className="flex flex-col gap-3 text-sm" data-testid="brief-matters">
              {brief.matters.map((m) => (
                <li key={m.id}>
                  <Link href={`/pratiche/${m.id}`} className="underline underline-offset-2">
                    {m.title}
                  </Link>{" "}
                  <Badge variant="outline">{tmatter(`status.${m.status as "open"}`)}</Badge>{" "}
                  <span className="text-muted-foreground">
                    {t("matters.opened", { date: formatDate(m.openedOn) })}
                    {m.assignees.length > 0 ? ` – ${m.assignees.join(", ")}` : ""}
                  </span>
                  {m.openRequests.length > 0 ? (
                    <div>
                      <span className="text-muted-foreground">{t("matters.requests")}: </span>
                      {m.openRequests.map((r) => (r.dueOn ? `${r.title} (${t("matters.requestDue", { date: formatDate(r.dueOn) })})` : r.title)).join("; ")}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{te("summary.heading")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <EngagementSummary items={engagements} testId="brief-engagements" />
          <Link href="/pratiche/incarichi" className="w-fit text-sm underline underline-offset-2 print:hidden">
            {te("summary.all")}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
