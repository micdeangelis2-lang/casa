import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Download } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollRegion } from "@/components/scroll-region";
import { requireOwner } from "@/platform/auth/owner";
import { getBackupEnv } from "@/platform/config/env";
import { getDb } from "@/platform/db/client";
import { currentAuditHead, listBackupRuns } from "@/modules/backup";
import { RunBackupButton } from "./_components/run-backup-button";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("backup");
  return { title: t("title") };
}

const dateTime = (d: Date) => d.toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
const megabytes = (bytes: number) => (bytes / (1024 * 1024)).toLocaleString("it-IT", { maximumFractionDigits: 1 });
const DAY_MS = 24 * 60 * 60 * 1000;
const isStale = (last: { finishedAt: Date | null; startedAt: Date } | undefined) =>
  !last || Date.now() - (last.finishedAt ?? last.startedAt).getTime() > DAY_MS;

export default async function BackupPage() {
  await requireOwner();
  const t = await getTranslations("backup");
  const db = getDb();
  const [runs, head] = await Promise.all([listBackupRuns(db), currentAuditHead(db)]);
  const keyConfigured = Boolean(getBackupEnv().BACKUP_PUBLIC_KEY);
  const lastGood = runs.find((r) => r.status === "completed" || r.status === "warning");
  const stale = isStale(lastGood);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("status.heading")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[13rem_1fr]" data-testid="backup-status">
            <dt className="text-muted-foreground">{t("status.key")}</dt>
            <dd>{keyConfigured ? t("status.keyOk") : t("status.keyMissing")}</dd>
            <dt className="text-muted-foreground">{t("status.destination")}</dt>
            <dd>{t("status.destinationValue")}</dd>
            <dt className="text-muted-foreground">{t("status.lastGood")}</dt>
            <dd>{lastGood ? dateTime(lastGood.finishedAt ?? lastGood.startedAt) : t("status.none")}</dd>
            <dt className="text-muted-foreground">{t("status.head")}</dt>
            <dd className="break-all font-mono text-xs">{head ? `#${head.seq} ${head.hash}` : "—"}</dd>
          </dl>
          <p className="text-sm text-muted-foreground">{t("status.headHint")}</p>
          {!keyConfigured ? (
            <Alert variant="destructive">
              <AlertDescription>{t("status.keyHowTo")}</AlertDescription>
            </Alert>
          ) : stale ? (
            <Alert>
              <AlertDescription>{lastGood ? t("status.stale") : t("status.neverRun")}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("run.heading")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{t("run.body")}</p>
          <RunBackupButton disabled={!keyConfigured} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("list.heading")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("list.empty")}</p>
          ) : (
            <ScrollRegion label={t("list.heading")}>
              <table className="w-full text-left text-sm" data-testid="backup-list">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">{t("list.date")}</th>
                    <th className="py-2 pr-4 font-medium">{t("list.kind")}</th>
                    <th className="py-2 pr-4 font-medium">{t("list.state")}</th>
                    <th className="py-2 pr-4 font-medium">{t("list.size")}</th>
                    <th className="py-2 pr-4 font-medium">{t("list.files")}</th>
                    <th className="py-2 pr-4 font-medium">{t("list.head")}</th>
                    <th className="py-2 font-medium">
                      <span className="sr-only">{t("list.download")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className="border-b last:border-0 align-top">
                      <td className="py-2 pr-4">{dateTime(r.startedAt)}</td>
                      <td className="py-2 pr-4">{t(`list.${r.trigger}`)}</td>
                      <td className="py-2 pr-4">
                        <Badge variant={r.status === "failed" ? "destructive" : "secondary"}>{t(`list.${r.status}`)}</Badge>
                        {r.message ? <p className="mt-1 max-w-xs text-xs text-muted-foreground">{r.message}</p> : null}
                      </td>
                      <td className="py-2 pr-4">{r.sizeBytes !== null ? t("list.sizeValue", { size: megabytes(r.sizeBytes) }) : "—"}</td>
                      <td className="py-2 pr-4">{r.fileCount ?? "—"}</td>
                      <td className="py-2 pr-4 font-mono text-xs">{r.auditHash ? `#${r.auditSeq} ${r.auditHash.slice(0, 12)}…` : "—"}</td>
                      <td className="py-2">
                        {r.destinationKey && (r.status === "completed" || r.status === "warning") ? (
                          <a href={`/api/backup/${r.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                            <Download aria-hidden /> {t("list.download")}
                            <span className="sr-only"> {dateTime(r.startedAt)}</span>
                          </a>
                        ) : null}
                      </td>
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
            <h2>{t("export.heading")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{t("export.body")}</p>
          <Alert>
            <AlertDescription>{t("export.warning")}</AlertDescription>
          </Alert>
          <div>
            <a href="/api/esportazione" className={buttonVariants({ variant: "outline" })}>
              <Download aria-hidden /> {t("export.button")}
            </a>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("restore.heading")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p className="text-muted-foreground">{t("restore.body")}</p>
          <pre tabIndex={0} aria-label={t("restore.commandLabel")} className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">{`pnpm db:migrate
pnpm backup:restore --archive <file.gibk> --key <chiave-privata.pem>`}</pre>
        </CardContent>
      </Card>
    </div>
  );
}
