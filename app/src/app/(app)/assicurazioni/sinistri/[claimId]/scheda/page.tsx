import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PrintButton } from "@/components/print-button";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { todayInItaly } from "@/platform/clock";
import { getClaimSheet } from "@/modules/insurance";
import { formatDate, formatEuro } from "@/lib/format";
import { isUuid } from "@/lib/ids";

type Props = PageProps<"/assicurazioni/sinistri/[claimId]/scheda">;

async function load(id: string) {
  return isUuid(id) ? getClaimSheet(getDb(), id) : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations("assicuratore.sheet");
  const sheet = await load((await params).claimId);
  return { title: sheet ? `${t("title")} – ${sheet.claim.title}` : t("title") };
}

export default async function ClaimSheetPage({ params }: Props) {
  await requireOwner();
  const { claimId } = await params;
  const sheet = await load(claimId);
  if (!sheet) notFound();
  const t = await getTranslations("assicuratore.sheet");
  const ti = await getTranslations("insurance");
  const ta = await getTranslations("assets");
  const tm = await getTranslations("maintenance");
  const { claim: c, policy: p, assets, otherClaims, checks } = sheet;
  const money = (cents: number | null) => (cents === null ? t("notIndicated") : `${formatEuro(cents)} €`);
  const date = (d: string | null) => (d ? formatDate(d) : t("notIndicated"));
  const value = (v: string | number | boolean) => (typeof v === "boolean" ? (v ? t("yes") : t("no")) : String(v));
  const packageAssetId = c.assetId ?? (assets.length === 1 ? assets[0]!.id : null);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <Link href={`/assicurazioni/sinistri/${c.id}`} className={buttonVariants({ variant: "ghost", size: "sm" }) + " w-fit print:hidden"}>
        <ArrowLeft aria-hidden /> {t("back")}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-lg">{c.title}</p>
          <p className="text-sm text-muted-foreground">{t("printedOn", { date: formatDate(todayInItaly()) })}</p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <PrintButton />
          {packageAssetId ? (
            <Link href={`/condivisione/nuovo?immobile=${packageAssetId}&destinatario=insurer&scheda=insurer`} className={buttonVariants({ variant: "outline" })}>
              {t("package")}
            </Link>
          ) : null}
        </div>
      </div>
      <Alert>
        <AlertDescription>{t("notice")}</AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("claimTitle")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[12rem_1fr]">
            <dt className="text-muted-foreground">{t("status")}</dt>
            <dd>
              <Badge variant="outline">{ti(`claimStatus.${c.status}`)}</Badge>
            </dd>
            <dt className="text-muted-foreground">{t("claimNumber")}</dt>
            <dd>{c.claimNumber ?? t("notIndicated")}</dd>
            <dt className="text-muted-foreground">{t("occurredOn")}</dt>
            <dd>{formatDate(c.occurredOn)}</dd>
            <dt className="text-muted-foreground">{t("reportedOn")}</dt>
            <dd>{date(c.reportedOn)}</dd>
            <dt className="text-muted-foreground">{t("claimed")}</dt>
            <dd data-testid="sheet-claimed">{money(c.claimedCents)}</dd>
            <dt className="text-muted-foreground">{t("received")}</dt>
            <dd data-testid="sheet-received">{money(c.receivedCents)}</dd>
            <dt className="text-muted-foreground">{t("adjuster")}</dt>
            <dd>{c.adjusterName ?? t("notIndicated")}</dd>
            <dt className="text-muted-foreground">{t("description")}</dt>
            <dd className="whitespace-pre-wrap">{c.description ?? t("notIndicated")}</dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("policy")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[12rem_1fr]">
            <dt className="text-muted-foreground">{t("policyTitle")}</dt>
            <dd>{p.title}</dd>
            <dt className="text-muted-foreground">{t("insurer")}</dt>
            <dd>{p.insurerName ?? t("notIndicated")}</dd>
            <dt className="text-muted-foreground">{t("agent")}</dt>
            <dd>{p.agentName ?? t("notIndicated")}</dd>
            <dt className="text-muted-foreground">{t("number")}</dt>
            <dd>{p.policyNumber ?? t("notIndicated")}</dd>
            <dt className="text-muted-foreground">{t("period")}</dt>
            <dd>{p.startsOn || p.endsOn ? `${date(p.startsOn)} – ${date(p.endsOn)}` : t("notIndicated")}</dd>
            <dt className="text-muted-foreground">{t("premium")}</dt>
            <dd>{money(p.premiumCents)}</dd>
          </dl>
          <h3 className="text-sm font-medium">{t("coverages")}</h3>
          {p.coverages.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noCoverages")}</p>
          ) : (
            <ul className="list-disc pl-5 text-sm" data-testid="sheet-coverages">
              {p.coverages.map((g) => (
                <li key={g.id}>{t("coverageLine", { title: g.title, sum: money(g.sumInsuredCents), deductible: money(g.deductibleCents) })}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">{t("assetsTitle")}</h2>
        {assets.length === 0 ? <p className="text-sm text-muted-foreground">{t("noAssets")}</p> : null}
        {assets.map((a) => (
          <Card key={a.id} data-testid="sheet-asset">
            <CardHeader>
              <CardTitle>
                <h3>
                  <Link href={`/immobili/${a.id}`} className="underline underline-offset-2">
                    {a.name}
                  </Link>
                </h3>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-sm">
              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[12rem_1fr]">
                <dt className="text-muted-foreground">{t("kind")}</dt>
                <dd>{ta(`kind.${a.kindKey as "dwelling"}`)}</dd>
                <dt className="text-muted-foreground">{t("address")}</dt>
                <dd>{[a.address, a.postalCode, a.locality, a.territoryLabel].filter(Boolean).join(", ") || t("notIndicated")}</dd>
                <dt className="text-muted-foreground">{t("declaredValue")}</dt>
                <dd data-testid="sheet-declared-value">{a.declaredValueCents === null ? t("notIndicated") : `${formatEuro(a.declaredValueCents)} €`}</dd>
                <dt className="text-muted-foreground">{t("use")}</dt>
                <dd>{a.useKey ? ta(`use.${a.useKey as "other"}`) : t("notIndicated")}</dd>
                <dt className="text-muted-foreground">{t("holders")}</dt>
                <dd>{a.holders.length > 0 ? a.holders.map((h) => `${h.name} (${ta(`right.${h.rightKey as "full"}`)} ${h.quota})`).join("; ") : t("notIndicated")}</dd>
                <dt className="text-muted-foreground">{t("cadastral")}</dt>
                <dd>
                  {a.cadastral.length > 0
                    ? a.cadastral.map((k, i) => <span key={i} className="block">{t("cadastralLine", { sheet: k.sheet ?? "—", parcel: k.parcel ?? "—", subunit: k.subunit ?? "—", category: k.category ?? "—", consistency: k.consistency ?? "—" })}</span>)
                    : t("notIndicated")}
                </dd>
                <dt className="text-muted-foreground">{t("attributes")}</dt>
                <dd>{a.attributes.length > 0 ? a.attributes.map((x) => `${x.key}: ${value(x.value)}`).join("; ") : t("notIndicated")}</dd>
              </dl>

              <div className="flex flex-col gap-1">
                <h4 className="font-medium">{t("works")}</h4>
                {a.works.length === 0 ? <p className="text-muted-foreground">{t("noWorks")}</p> : null}
                <ul className="list-disc pl-5">
                  {a.works.map((w) => (
                    <li key={w.id}>
                      {t("workLine", { title: w.title, status: tm(`status.${w.status as "planned"}`), supplier: w.supplierName ? ` — ${w.supplierName}` : "" })}
                      {w.completedOn ? `, ${formatDate(w.completedOn)}` : ""}
                      <span className="block text-muted-foreground">{t("workMoney", { quotes: formatEuro(w.acceptedQuotesCents), invoiced: formatEuro(w.invoicedCents), paid: formatEuro(w.paidCents) })}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex flex-col gap-1">
                <h4 className="font-medium">{t("documents")}</h4>
                {a.documents.length === 0 ? <p className="text-muted-foreground">{t("noDocuments")}</p> : null}
                <ul className="list-disc pl-5" data-testid="sheet-documents">
                  {a.documents.map((d) => (
                    <li key={d.id}>
                      <Link href={`/documenti/${d.id}`} className="underline underline-offset-2">
                        {d.title}
                      </Link>
                      {` — ${d.categoryName}${d.issuedOn ? `, ${formatDate(d.issuedOn)}` : ""}`}
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("claimDocuments")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {c.documents.length === 0 ? <p className="text-sm text-muted-foreground">{t("noClaimDocuments")}</p> : null}
          <ul className="list-disc pl-5 text-sm" data-testid="sheet-claim-documents">
            {c.documents.map((d) => (
              <li key={d.documentId} data-role={d.role}>
                <Link href={`/documenti/${d.documentId}`} className="underline underline-offset-2">
                  {d.title}
                </Link>
                {` — ${t(`role.${d.role}`)}`}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("otherClaims")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {otherClaims.length === 0 ? <p className="text-sm text-muted-foreground">{t("noOtherClaims")}</p> : null}
          <ul className="list-disc pl-5 text-sm" data-testid="sheet-other-claims">
            {otherClaims.map((o) => (
              <li key={o.id}>{t("otherLine", { title: o.title, date: formatDate(o.occurredOn), claimed: money(o.claimedCents), received: money(o.receivedCents) })}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("entries")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {c.entries.length === 0 ? <p className="text-sm text-muted-foreground">{t("noEntries")}</p> : null}
          <ul className="flex flex-col divide-y text-sm" data-testid="sheet-entries">
            {c.entries.map((e) => (
              <li key={e.id} className="flex flex-col gap-1 py-2 first:pt-0 last:pb-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{formatDate(e.entryOn)}</span>
                  <Badge variant="outline">{t(`direction.${e.direction}`)}</Badge>
                </span>
                <span className="whitespace-pre-wrap">{e.summary}</span>
                {e.documentTitle ? <span className="text-muted-foreground">{t("attachment", { title: e.documentTitle })}</span> : null}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("checks")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">{t("checksHint")}</p>
          <ul className="flex flex-col gap-1 text-sm" data-testid="sheet-checks">
            {checks.map((k) => (
              <li key={k.key} data-present={k.present ? "yes" : "no"}>
                {t(`check.${k.key}`)}: {k.present ? t("present") : t("missing")}
                {k.present && k.count !== undefined ? ` (${k.count})` : ""}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
