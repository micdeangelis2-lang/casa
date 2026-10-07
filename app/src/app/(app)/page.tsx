import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Bell, Building2, CalendarClock, ClipboardCheck, Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOwner } from "@/platform/auth/owner";
import { AttentionList } from "./controlli/_components/attention-list";
import { getDb } from "@/platform/db/client";
import { listAssets } from "@/modules/assets";
import { countBySeverity, getAttention } from "@/modules/attention";
import { deadlineSummary, listOccurrences } from "@/modules/deadlines";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("title") };
}

const date = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "2-digit" });

export default async function DashboardPage() {
  await requireOwner();
  const t = await getTranslations("dashboard");
  const td = await getTranslations("deadlines");
  const tDisclaimer = await getTranslations("disclaimer");
  const tAttention = await getTranslations("attention");
  const db = getDb();
  const [assets, summary, overdue, upcoming, attention] = await Promise.all([
    listAssets(db),
    deadlineSummary(db),
    listOccurrences(db, "overdue", {}),
    listOccurrences(db, "upcoming", {}, undefined, { windowDays: 30 }),
    getAttention(db),
  ]);
  const attentionCounts = countBySeverity(attention);
  const focus = [...overdue, ...upcoming].slice(0, 6);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6" data-testid="dashboard">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>

      {assets.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="size-5 text-muted-foreground" aria-hidden />
              {t("emptyTitle")}
            </CardTitle>
            <CardDescription>{t("emptyBody")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/immobili/nuovo" className={buttonVariants({ variant: "outline" })}>
              {t("addFirst")}
            </Link>
          </CardContent>
        </Card>
      ) : null}

      {
        <>
          <section aria-labelledby="deadlines-heading" className="grid gap-4 sm:grid-cols-3" data-testid="dashboard-deadlines">
            <h2 id="deadlines-heading" className="sr-only">
              {td("title")}
            </h2>
            <Link href="/scadenze?vista=ritardo" className="rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2">
              <Card className={`transition-colors hover:bg-accent/40 ${summary.overdue > 0 ? "border-destructive" : ""}`}>
                <CardHeader>
                  <CardDescription>{td("views.overdue")}</CardDescription>
                  <CardTitle className="text-3xl">{summary.overdue}</CardTitle>
                </CardHeader>
              </Card>
            </Link>
            <Link href="/scadenze" className="rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2">
              <Card className="transition-colors hover:bg-accent/40">
                <CardHeader>
                  <CardDescription>{t("next7")}</CardDescription>
                  <CardTitle className="text-3xl">{summary.next7}</CardTitle>
                </CardHeader>
              </Card>
            </Link>
            <Link href="/avvisi" className="rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2">
              <Card className="transition-colors hover:bg-accent/40">
                <CardHeader>
                  <CardDescription>{t("unread")}</CardDescription>
                  <CardTitle className="flex items-center gap-2 text-3xl">
                    <Bell className="size-5 text-muted-foreground" aria-hidden />
                    {summary.unreadNotifications}
                  </CardTitle>
                </CardHeader>
              </Card>
            </Link>
          </section>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarClock className="size-5 text-muted-foreground" aria-hidden />
                <h2>{t("focus")}</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {focus.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("focusEmpty")}</p>
              ) : (
                <ul className="flex flex-col divide-y" data-testid="dashboard-focus">
                  {focus.map((o) => (
                    <li key={o.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                      <span className="w-24 shrink-0 text-muted-foreground">{date(o.dueOn)}</span>
                      <Link href={`/scadenze/${o.deadlineId}`} className="underline underline-offset-2">
                        {o.title}
                      </Link>
                      {o.assetName ? <span className="text-muted-foreground">· {o.assetName}</span> : null}
                      {o.overdue ? <Badge variant="destructive">{td("lateDays", { count: -o.daysLeft })}</Badge> : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card data-testid="dashboard-attention">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardCheck className="size-5 text-muted-foreground" aria-hidden />
                <h2>{tAttention("dashboard.heading")}</h2>
              </CardTitle>
              {attention.length > 0 ? <CardDescription>{tAttention("summary", attentionCounts)}</CardDescription> : null}
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {attention.length === 0 ? <p className="text-sm text-muted-foreground">{tAttention("dashboard.none")}</p> : <AttentionList findings={attention.slice(0, 5)} testId="dashboard-attention-list" />}
              {attention.length > 5 ? (
                <Link href="/controlli" className="w-fit text-sm underline underline-offset-2">
                  {tAttention("dashboard.all", { count: attention.length })}
                </Link>
              ) : null}
            </CardContent>
          </Card>
        </>
      }

      <Alert>
        <Info aria-hidden />
        <AlertTitle>{tDisclaimer("title")}</AlertTitle>
        <AlertDescription>
          {tDisclaimer("body")}{" "}
          <Link href="/limiti" className="underline underline-offset-2">
            {tDisclaimer("more")}
          </Link>
        </AlertDescription>
      </Alert>
    </div>
  );
}
