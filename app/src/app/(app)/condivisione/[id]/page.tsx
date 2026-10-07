import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Download } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { SHEET_PATH, getPackageDetail } from "@/modules/sharing";
import { isUuid } from "@/lib/ids";
import { RevokeButton } from "../_components/revoke-button";

type Props = PageProps<"/condivisione/[id]">;

async function load(id: string) {
  if (!isUuid(id)) return null;
  return getPackageDetail(getDb(), id);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const d = await load((await params).id);
  return { title: d ? d.package.recipientName : "Pacchetto" };
}

export default async function PackagePage({ params }: Props) {
  await requireOwner();
  const { id } = await params;
  const detail = await load(id);
  if (!detail) notFound();
  const t = await getTranslations("sharing");
  const td = await getTranslations("sharing.detail");
  const { package: pkg, items, log } = detail;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{pkg.recipientName}</h1>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{t(`recipient.${pkg.recipientType}`)}</Badge>
            <Badge variant="outline">{t(`confidentiality.${pkg.confidentialityCap}`)}</Badge>
            <Badge variant={pkg.revoked ? "destructive" : "outline"}>{pkg.revoked ? t("list.revoked") : t("list.active")}</Badge>
          </div>
        </div>
        {pkg.revoked ? null : (
          <div className="flex flex-wrap gap-2 print:hidden">
            <a href={`/api/condivisione/${pkg.id}`} className={buttonVariants()}>
              <Download aria-hidden /> {td("download")}
            </a>
            <RevokeButton packageId={pkg.id} label={td("revoke")} />
          </div>
        )}
      </div>

      {pkg.revoked ? (
        <Alert>
          <AlertDescription>{td("revokedNotice")}</AlertDescription>
        </Alert>
      ) : (
        <p className="text-sm text-muted-foreground">{td("downloadHelp")}</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{td("contents")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {pkg.note ? (
            <p className="text-sm">
              <span className="text-muted-foreground">{td("note")}: </span>
              {pkg.note}
            </p>
          ) : null}
          {pkg.snapshot.sheet ? (
            <p className="text-sm" data-testid="package-sheet">
              <span className="text-muted-foreground">{td("sheet")}: </span>
              {td("sheetLine", { title: pkg.snapshot.sheet.title, path: SHEET_PATH, sha: pkg.snapshot.sheet.sha256.slice(0, 16) })}
            </p>
          ) : null}
          <ul className="flex flex-col divide-y text-sm" data-testid="package-items">
            {items.map((i) => (
              <li key={i.id} className="flex flex-col gap-1 py-2 first:pt-0 last:pb-0">
                <span className="flex flex-wrap items-center gap-2">
                  <Link href={`/documenti/${i.documentId}`} className="font-medium underline underline-offset-2">
                    {i.title}
                  </Link>
                  <Badge variant="outline">{t(`confidentiality.${i.confidentiality}`)}</Badge>
                  {i.overrideAboveCap ? <Badge variant="destructive">{td("aboveCap")}</Badge> : null}
                </span>
                <span className="break-all font-mono text-xs text-muted-foreground">{i.path} · {i.sha256}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">{td("total", { size: (pkg.totalBytes / (1024 * 1024)).toLocaleString("it-IT", { maximumFractionDigits: 1 }) })}</p>
          <p className="break-all font-mono text-xs text-muted-foreground">
            {td("manifest")}: {pkg.manifestSha256}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{td("log")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-1 text-sm" data-testid="package-log">
            {log.map((l) => (
              <li key={l.id}>
                {td(`events.${l.event}`)} · {l.at.toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
