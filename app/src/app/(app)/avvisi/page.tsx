import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Bell } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { listNotifications } from "@/modules/deadlines";
import { MarkReadButton } from "./_components/mark-read";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notifications");
  return { title: t("title") };
}

export default async function NotificationsPage({ searchParams }: PageProps<"/avvisi">) {
  await requireOwner();
  const t = await getTranslations("notifications");
  const params = await searchParams;
  const showAll = (Array.isArray(params.tutti) ? params.tutti[0] : params.tutti) === "1";
  const all = await listNotifications(getDb(), { unreadOnly: false });
  const list = showAll ? all : all.filter((n) => n.readAt === null);
  const unread = all.filter((n) => n.readAt === null).length;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        {unread > 0 ? <MarkReadButton id={null} label={t("markAllRead")} /> : null}
      </div>
      <p className="text-sm text-muted-foreground">
        {t("intro")} {t("unread", { count: unread })}.
      </p>
      <Link href={showAll ? "/avvisi" : "/avvisi?tutti=1"} className={buttonVariants({ variant: "ghost", size: "sm" }) + " self-start"}>
        {showAll ? t("unread", { count: unread }) : t("showAll")}
      </Link>

      {list.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
          <Bell className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">{t("empty")}</p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border" data-testid="notification-list">
          {list.map((n) => (
            <li key={n.id} className="flex flex-col gap-1 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className={n.readAt ? "text-muted-foreground" : "font-medium"}>{n.title}</span>
                {n.leadDays < 0 ? <Badge variant="destructive">{n.dueOn.split("-").reverse().join("/")}</Badge> : null}
                {n.emailSentAt ? <Badge variant="outline">{t("emailSent")}</Badge> : null}
                {n.emailError ? <Badge variant="outline">{t("emailFailed")}</Badge> : null}
              </div>
              <p className="text-sm text-muted-foreground">{n.body}</p>
              <div className="flex flex-wrap gap-2">
                <Link href={`/scadenze/${n.deadlineId}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                  {t("open")}
                  <span className="sr-only">: {n.title}</span>
                </Link>
                {n.readAt === null ? <MarkReadButton id={n.id} label={t("markRead")} srLabel={n.title} /> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
