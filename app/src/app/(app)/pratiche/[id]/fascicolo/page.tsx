import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Download, Printer } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollRegion } from "@/components/scroll-region";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { isUuid } from "@/lib/ids";
import { formatDate, formatEuro } from "@/lib/format";
import { loadMatterDossier } from "@/lib/matter-dossier";
import { PrintButton } from "./print-button";

type Props = PageProps<"/pratiche/[id]/fascicolo">;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("avvocato");
  return { title: t("title") };
}

const th = "py-2 pr-4 font-medium";
const td = "py-2 pr-4 align-top";

export default async function MatterDossierPage({ params }: Props) {
  await requireOwner();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const t = await getTranslations("avvocato");
  const dossier = await loadMatterDossier(getDb(), id, (key, values) => t(key as never, values as never));
  if (!dossier) notFound();
  const { matter: m, timeline, checklist, parties, documents, rents, claimTotals } = dossier;
  const rows = [...timeline.dated, ...timeline.undated];
  const lawyer = parties.find((p) => p.roles.includes("lawyer"));

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">{t("title")}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{m.title}</h1>
          <p className="text-sm text-muted-foreground">{t("generatedOn", { date: formatDate(dossier.today) })}</p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Link href={`/pratiche/${m.id}`} className={buttonVariants({ variant: "outline" })}>
            {t("back")}
          </Link>
          <a href={`/api/pratiche/${m.id}/cronologia`} className={buttonVariants({ variant: "outline" })}>
            <Download aria-hidden /> {t("csv")}
          </a>
          <PrintButton label={t("print")} icon={<Printer aria-hidden />} />
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{t("intro")}</p>

      <Card className="print:hidden">
        <CardHeader>
          <CardTitle>
            <h2>{t("checklist")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p className="text-muted-foreground">{t("checklistHint")}</p>
          {checklist.length === 0 ? <p data-testid="checklist-empty">{t("checklistEmpty")}</p> : null}
          <ul className="flex list-disc flex-col gap-1 pl-5" data-testid="checklist">
            {checklist.map((c) => (
              <li key={c.code}>{t(`check.${c.code}`, { names: c.names.join(", ") })}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Link href={`/condivisione/nuovo?pratica=${m.id}&mostra=1&destinatario=lawyer${lawyer ? `&contatto=${lawyer.id}` : ""}`} className={buttonVariants({ variant: "secondary" })}>
              {t("package")}
            </Link>
            <Link href={`/scadenze/nuova?${[m.assetId ? `immobile=${m.assetId}` : null, lawyer ? `professionista=${lawyer.id}` : null].filter(Boolean).join("&")}`} className={buttonVariants({ variant: "secondary" })}>
              {t("newDeadline")}
            </Link>
          </div>
          <p className="text-muted-foreground">{t("newDeadlineHint")}</p>
        </CardContent>
      </Card>

      <section aria-labelledby="h-matter" className="flex flex-col gap-2">
        <h2 id="h-matter" className="text-lg font-medium">
          {t("matterData")}
        </h2>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-muted-foreground">{t("status")}</dt>
          <dd>{t(`matterStatus.${m.status}`)}</dd>
          <dt className="text-muted-foreground">{t("openedOn")}</dt>
          <dd>{formatDate(m.openedOn)}</dd>
          {m.closedOn ? (
            <>
              <dt className="text-muted-foreground">{t("closedOn")}</dt>
              <dd>{formatDate(m.closedOn)}</dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">{t("asset")}</dt>
          <dd>{m.assetName ?? "—"}</dd>
          {m.officeName || m.protocolNumber || m.submittedOn || m.responseDueOn ? (
            <>
              <dt className="text-muted-foreground">{t("office")}</dt>
              <dd>{m.officeName ?? "—"}</dd>
              {m.protocolNumber ? (
                <>
                  <dt className="text-muted-foreground">{t("protocol")}</dt>
                  <dd data-testid="dossier-protocol">{m.protocolNumber}</dd>
                </>
              ) : null}
              {m.submittedOn ? (
                <>
                  <dt className="text-muted-foreground">{t("submittedOn")}</dt>
                  <dd>{formatDate(m.submittedOn)}</dd>
                </>
              ) : null}
              {m.responseDueOn ? (
                <>
                  <dt className="text-muted-foreground">{t("responseDueOn")}</dt>
                  <dd>{formatDate(m.responseDueOn)}</dd>
                </>
              ) : null}
            </>
          ) : null}
          {m.description ? (
            <>
              <dt className="text-muted-foreground">{t("description")}</dt>
              <dd className="whitespace-pre-wrap">{m.description}</dd>
            </>
          ) : null}
        </dl>
      </section>

      <section aria-labelledby="h-parties" className="flex flex-col gap-2">
        <h2 id="h-parties" className="text-lg font-medium">
          {t("parties")}
        </h2>
        {parties.length === 0 ? <p className="text-sm text-muted-foreground">{t("noParties")}</p> : null}
        <ul className="flex flex-col gap-2 text-sm" data-testid="dossier-parties">
          {parties.map((p) => (
            <li key={p.id}>
              <span className="font-medium">{p.displayName}</span>
              {p.role ? <span> – {p.role}</span> : null}
              <span className="block text-muted-foreground">{[p.taxCode ? `${t("fiscalCode")}: ${p.taxCode}` : null, p.email, p.pec, p.phone, p.address].filter(Boolean).join(" · ")}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="h-timeline" className="flex flex-col gap-2">
        <h2 id="h-timeline" className="text-lg font-medium">
          {t("timeline")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("timelineHint")}</p>
        {rows.length === 0 ? <p className="text-sm text-muted-foreground">{t("noTimeline")}</p> : null}
        <ScrollRegion label={t("timeline")}>
          <table className="w-full text-left text-sm" data-testid="timeline">
            <caption className="sr-only">{t("timeline")}</caption>
            <thead>
              <tr className="border-b">
                <th scope="col" className={th}>{t("colDate")}</th>
                <th scope="col" className={th}>{t("colSource")}</th>
                <th scope="col" className={th}>{t("colFact")}</th>
                <th scope="col" className={th}>{t("colDetail")}</th>
                <th scope="col" className={`${th} text-right`}>{t("colAmount")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e, i) => (
                <tr key={i} className="border-b">
                  <td className={`${td} whitespace-nowrap`}>{e.date ? formatDate(e.date) : t("undated")}</td>
                  <td className={td}>{t(`kind.${e.kind}`)}</td>
                  <td className={td}>
                    {e.href ? (
                      <Link href={e.href} className="underline underline-offset-2">
                        {e.title}
                      </Link>
                    ) : (
                      e.title
                    )}
                  </td>
                  <td className={`${td} whitespace-pre-wrap`}>{e.detail}</td>
                  <td className={`${td} text-right tabular-nums`}>{e.amountCents === null ? "" : formatEuro(e.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      </section>

      <section aria-labelledby="h-docs" className="flex flex-col gap-2">
        <h2 id="h-docs" className="text-lg font-medium">
          {t("documents")}
        </h2>
        {documents.length === 0 ? <p className="text-sm text-muted-foreground">{t("noDocuments")}</p> : null}
        {documents.length > 0 ? (
          <ScrollRegion label={t("documents")}>
            <table className="w-full text-left text-sm" data-testid="dossier-documents">
              <caption className="sr-only">{t("documents")}</caption>
              <thead>
                <tr className="border-b">
                  <th scope="col" className={th}>{t("colTitle")}</th>
                  <th scope="col" className={th}>{t("colCategory")}</th>
                  <th scope="col" className={th}>{t("colIssued")}</th>
                  <th scope="col" className={th}>{t("colIssuer")}</th>
                  <th scope="col" className={th}>{t("colValidTo")}</th>
                  <th scope="col" className={th}>{t("colConfidentiality")}</th>
                  <th scope="col" className={th}>{t("colVerification")}</th>
                  <th scope="col" className={th}>{t("colHash")}</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((d) => (
                  <tr key={d.id} className="border-b">
                    <td className={td}>
                      <Link href={`/documenti/${d.id}`} className="underline underline-offset-2">
                        {d.title}
                      </Link>
                    </td>
                    <td className={td}>{d.categoryName}</td>
                    <td className={`${td} whitespace-nowrap`}>{d.issuedOn ? formatDate(d.issuedOn) : "—"}</td>
                    <td className={td}>{d.issuerName ?? "—"}</td>
                    <td className={`${td} whitespace-nowrap`}>{d.validTo ? formatDate(d.validTo) : "—"}</td>
                    <td className={td}>{t(`confidentiality.${d.confidentiality as "ordinary"}`)}</td>
                    <td className={td}>{t(`verification.${d.verificationStatus as "draft"}`)}</td>
                    <td className={`${td} break-all font-mono text-xs`}>{d.sha256}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        ) : null}
      </section>

      <section aria-labelledby="h-amounts" className="flex flex-col gap-2">
        <h2 id="h-amounts" className="text-lg font-medium">
          {t("amounts")}
        </h2>
        {!claimTotals && rents.length === 0 ? <p className="text-sm text-muted-foreground">{t("noAmounts")}</p> : null}
        {claimTotals ? <p className="text-sm">{t("claimTotals", { claimed: formatEuro(claimTotals.claimedCents), received: formatEuro(claimTotals.receivedCents) })}</p> : null}
        {rents.length > 0 ? (
          <>
            <h3 className="text-sm font-medium">{t("rents")}</h3>
            <p className="text-sm text-muted-foreground">{t("rentsHint")}</p>
            <ScrollRegion label={t("rents")}>
              <table className="w-full text-left text-sm" data-testid="dossier-rents">
                <caption className="sr-only">{t("rents")}</caption>
                <thead>
                  <tr className="border-b">
                    <th scope="col" className={th}>{t("colContract")}</th>
                    <th scope="col" className={th}>{t("colDue")}</th>
                    <th scope="col" className={`${th} text-right`}>{t("colAmount")}</th>
                    <th scope="col" className={`${th} text-right`}>{t("colPaid")}</th>
                    <th scope="col" className={`${th} text-right`}>{t("colResidual")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rents.map((r, i) => (
                    <tr key={i} className="border-b">
                      <td className={td}>{r.lettingTitle}</td>
                      <td className={`${td} whitespace-nowrap`}>{formatDate(r.dueOn)}</td>
                      <td className={`${td} text-right tabular-nums`}>{formatEuro(r.amountCents)}</td>
                      <td className={`${td} text-right tabular-nums`}>{formatEuro(r.paidCents)}</td>
                      <td className={`${td} text-right tabular-nums`}>{formatEuro(r.residualCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          </>
        ) : null}
      </section>
    </div>
  );
}
