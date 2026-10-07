import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Download, ExternalLink, Pencil, Plus } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { INLINE_MIME_TYPES, getDocumentDetail } from "@/modules/documents";
import { documentSharingHistory } from "@/modules/sharing";
import { isUuid } from "@/lib/ids";
import { ArchiveButton } from "../_components/archive-button";

type Props = PageProps<"/documenti/[id]">;

async function load(id: string) {
  if (!isUuid(id)) return null;
  return getDocumentDetail(getDb(), id);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const detail = await load((await params).id);
  return { title: detail?.title ?? "Documento" };
}

const date = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("it-IT");
const megabytes = (bytes: number) => (bytes / (1024 * 1024)).toLocaleString("it-IT", { maximumFractionDigits: 1 });

export default async function DocumentPage({ params }: Props) {
  await requireOwner();
  const { id } = await params;
  const doc = await load(id);
  if (!doc) notFound();
  const t = await getTranslations("documents");
  const tc = await getTranslations("common");
  const current = doc.versions[0]!;
  const ts = await getTranslations("sharing");
  const sharing = await documentSharingHistory(getDb(), doc.id);

  const validity = [
    current.validFrom ? t("detail.validFromShort", { date: date(current.validFrom) }) : null,
    current.validTo ? t("detail.validToShort", { date: date(current.validTo) }) : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{doc.title}</h1>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{doc.categoryName}</Badge>
            <Badge variant="outline">{t(`status.${current.verificationStatus}`)}</Badge>
            {doc.confidentiality !== "ordinary" ? <Badge variant="outline">{t(`confidentiality.${doc.confidentiality}`)}</Badge> : null}
            {doc.archived ? <Badge variant="destructive">{t("archivedBadge")}</Badge> : null}
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/documenti/${doc.id}/modifica`} className={buttonVariants({ variant: "outline" })}>
            <Pencil aria-hidden /> {tc("edit")}
          </Link>
          <ArchiveButton documentId={doc.id} archived={doc.archived} />
        </div>
      </div>

      {doc.archived ? (
        <Alert>
          <AlertDescription>{t("detail.archivedNotice")}</AlertDescription>
        </Alert>
      ) : null}

      {doc.duplicates.length > 0 ? (
        <Alert data-testid="duplicates">
          <AlertTitle>{t("detail.duplicatesTitle")}</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-5">
              {doc.duplicates.map((d) => (
                <li key={d.documentId}>
                  <Link href={`/documenti/${d.documentId}`} className="underline underline-offset-2">
                    {d.title}
                  </Link>{" "}
                  {d.reason === "same_file" ? t("detail.duplicateSameFile") : t("detail.duplicateSameData")}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("detail.details")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted-foreground">{t("detail.assets")}</dt>
            <dd>
              {doc.assets.length === 0 ? (
                <span className="text-muted-foreground">{t("detail.noAssets")}</span>
              ) : (
                <ul className="flex flex-col gap-1" data-testid="document-assets">
                  {doc.assets.map((a) => (
                    <li key={a.id}>
                      <Link href={`/immobili/${a.id}`} className="underline underline-offset-2">
                        {a.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </dd>
            {current.issuerName ? (
              <>
                <dt className="text-muted-foreground">{t("detail.issuer")}</dt>
                <dd>{current.issuerName}</dd>
              </>
            ) : null}
            {current.issuedOn ? (
              <>
                <dt className="text-muted-foreground">{t("detail.issuedOn")}</dt>
                <dd>{date(current.issuedOn)}</dd>
              </>
            ) : null}
            {validity ? (
              <>
                <dt className="text-muted-foreground">{t("detail.validity")}</dt>
                <dd>{validity}</dd>
              </>
            ) : null}
            {doc.notes ? (
              <>
                <dt className="text-muted-foreground">{t("detail.notes")}</dt>
                <dd className="whitespace-pre-wrap">{doc.notes}</dd>
              </>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle>
            <h2>{t("detail.versionsTitle")}</h2>
          </CardTitle>
          <Link href={`/documenti/${doc.id}/nuova-versione`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            <Plus aria-hidden /> {t("detail.addVersion")}
          </Link>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col divide-y" data-testid="versions">
            {doc.versions.map((v, index) => {
              const canOpen = (INLINE_MIME_TYPES as readonly string[]).includes(v.mimeType);
              const href = `/api/documenti/${doc.id}/${v.id}`;
              return (
                <li key={v.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {t("detail.version", { number: v.versionNo })} – {v.originalFilename}
                    </span>
                    {index === 0 ? <Badge variant="secondary">{t("detail.current")}</Badge> : null}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {[
                      t("detail.size", { size: megabytes(v.sizeBytes) }),
                      v.issuedOn ? t("detail.issuedShort", { date: date(v.issuedOn) }) : null,
                      v.validTo ? t("validUntil", { date: date(v.validTo) }) : null,
                      v.hasText ? t("detail.hasText") : v.mimeType === "application/pdf" ? t("detail.noText") : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {v.note ? <p className="text-sm">{v.note}</p> : null}
                  <div className="flex gap-2">
                    {canOpen ? (
                      <a href={href} target="_blank" rel="noopener" className={buttonVariants({ variant: "outline", size: "sm" })}>
                        <ExternalLink aria-hidden /> {t("detail.open")}
                        <span className="sr-only"> {t("detail.version", { number: v.versionNo })}</span>
                      </a>
                    ) : null}
                    <a href={`${href}?scarica=1`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                      <Download aria-hidden /> {t("detail.download")}
                      <span className="sr-only"> {t("detail.version", { number: v.versionNo })}</span>
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{ts("forDocument.title")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {sharing.length === 0 ? (
            <p className="text-muted-foreground">{ts("forDocument.none")}</p>
          ) : (
            <ul className="flex flex-col gap-1" data-testid="document-sharing">
              {sharing.map((s) => (
                <li key={s.package.id}>
                  <Link href={`/condivisione/${s.package.id}`} className="underline underline-offset-2">
                    {ts("forDocument.line", { recipient: s.package.recipientName, type: ts(`recipient.${s.package.recipientType}`), date: s.package.createdAt.toLocaleDateString("it-IT") })}
                  </Link>
                  {s.override ? <Badge variant="destructive" className="ml-2">{ts("forDocument.aboveCap")}</Badge> : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
