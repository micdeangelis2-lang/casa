import type { Metadata } from "next";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { CalendarClock, ChevronLeft, ChevronRight, Download, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { listAssets } from "@/modules/assets";
import { DEADLINE_CATEGORIES, listOccurrences, todayInItaly, type DeadlineCategory, type DeadlineView, type OccurrenceListItem } from "@/modules/deadlines";
import { addMonths, clampedDate, daysInMonth, weekday } from "@/shared/dates";
import { isUuid } from "@/lib/ids";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("deadlines");
  return { title: t("title") };
}

const VIEWS = ["prossime", "ritardo", "calendario", "completate", "tutte"] as const;
type ViewParam = (typeof VIEWS)[number];
const VIEW_KEY: Record<ViewParam, "upcoming" | "overdue" | "calendar" | "done" | "all"> = { prossime: "upcoming", ritardo: "overdue", calendario: "calendar", completate: "done", tutte: "all" };
const date = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });

export default async function DeadlinesPage({ searchParams }: PageProps<"/scadenze">) {
  await requireOwner();
  const t = await getTranslations("deadlines");
  const params = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const today = todayInItaly();

  const vista = (VIEWS as readonly string[]).includes(first(params.vista)) ? (first(params.vista) as ViewParam) : "prossime";
  const assetId = isUuid(first(params.immobile)) ? first(params.immobile) : undefined;
  const category = (DEADLINE_CATEGORIES as readonly string[]).includes(first(params.categoria)) ? (first(params.categoria) as DeadlineCategory) : undefined;
  const periodo = ["30", "90", "365"].includes(first(params.periodo)) ? Number(first(params.periodo)) : 90;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(first(params.mese)) ? first(params.mese) : today.slice(0, 7);

  const db = getDb();
  const assets = await listAssets(db);
  const filter = { assetId, category };
  const calendar = vista === "calendario";
  const items = calendar
    ? await listOccurrences(db, "all", { ...filter, from: `${month}-01`, to: `${month}-${String(daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)))).padStart(2, "0")}` }, today)
    : await listOccurrences(db, VIEW_KEY[vista] as DeadlineView, filter, today, { windowDays: periodo });
  const visible = calendar ? items.filter((i) => i.status !== "cancelled") : items.filter((i) => vista === "tutte" || i.status !== "cancelled");

  const query = (extra: Record<string, string>) => {
    const q = new URLSearchParams();
    if (vista !== "prossime") q.set("vista", vista);
    if (assetId) q.set("immobile", assetId);
    if (category) q.set("categoria", category);
    for (const [k, v] of Object.entries(extra)) q.set(k, v);
    const s = q.toString();
    return s ? `?${s}` : "";
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <div className="flex flex-wrap gap-2">
          <a href="/api/calendario" aria-describedby="calendar-export-hint" className={buttonVariants({ variant: "outline" })}>
            <Download aria-hidden /> {t("calendarExport.button")}
          </a>
          <Link href="/scadenze/nuova" className={buttonVariants()}>
            <Plus aria-hidden /> {t("add")}
          </Link>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
      <p id="calendar-export-hint" className="text-xs text-muted-foreground">
        {t("calendarExport.hint")}
      </p>

      <nav aria-label={t("title")} className="flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <Link
            key={v}
            href={`/scadenze${v === "prossime" ? "" : `?vista=${v}`}${assetId ? `${v === "prossime" ? "?" : "&"}immobile=${assetId}` : ""}`}
            aria-current={v === vista ? "page" : undefined}
            className={buttonVariants({ variant: v === vista ? "secondary" : "ghost", size: "sm" })}
          >
            {t(`views.${VIEW_KEY[v]}`)}
          </Link>
        ))}
      </nav>

      <form method="get" className="flex flex-wrap items-end gap-3" role="search">
        <input type="hidden" name="vista" value={vista} />
        {calendar ? <input type="hidden" name="mese" value={month} /> : null}
        <div className="flex w-56 flex-col gap-2">
          <Label htmlFor="immobile">{t("filters.asset")}</Label>
          <NativeSelect id="immobile" name="immobile" defaultValue={assetId ?? ""}>
            <option value="">{t("filters.allAssets")}</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex w-52 flex-col gap-2">
          <Label htmlFor="categoria">{t("filters.category")}</Label>
          <NativeSelect id="categoria" name="categoria" defaultValue={category ?? ""}>
            <option value="">{t("filters.allCategories")}</option>
            {DEADLINE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`category.${c}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        {vista === "prossime" ? (
          <div className="flex w-48 flex-col gap-2">
            <Label htmlFor="periodo">{t("filters.range")}</Label>
            <NativeSelect id="periodo" name="periodo" defaultValue={String(periodo)}>
              <option value="30">{t("filters.next30")}</option>
              <option value="90">{t("filters.next90")}</option>
              <option value="365">{t("filters.next365")}</option>
            </NativeSelect>
          </div>
        ) : null}
        <Button type="submit" variant="secondary">
          {t("filters.apply")}
        </Button>
      </form>

      {calendar ? (
        <MonthGrid month={month} items={visible} today={today} prev={`/scadenze${query({ vista: "calendario", mese: addMonths(`${month}-01`, -1).slice(0, 7) })}`} next={`/scadenze${query({ vista: "calendario", mese: addMonths(`${month}-01`, 1).slice(0, 7) })}`} />
      ) : null}

      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
          <CalendarClock className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">{calendar ? t("calendar.none") : vista === "prossime" && !assetId && !category ? t("emptyTitle") : t("noResults")}</p>
          {vista === "prossime" && !assetId && !category && !calendar ? <p className="max-w-md text-sm text-muted-foreground">{t("emptyBody")}</p> : null}
        </div>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border" data-testid="deadline-list">
          {visible.map((o) => (
            <li key={o.id}>
              <OccurrenceRow o={o} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OccurrenceRow({ o }: { o: OccurrenceListItem }) {
  const t = useTranslations("deadlines");
  return (
    <Link href={`/scadenze/${o.deadlineId}`} className="flex flex-col gap-1 p-4 hover:bg-accent/50 focus-visible:bg-accent/50">
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{o.title}</span>
        <Badge variant="secondary">{t(`category.${o.category}`)}</Badge>
        {o.priority === "high" || o.priority === "urgent" ? <Badge variant="outline">{t(`priority.${o.priority}`)}</Badge> : null}
        {o.overdue ? <Badge variant="destructive">{t("lateDays", { count: -o.daysLeft })}</Badge> : null}
        {o.status === "done" ? <Badge variant="outline">{t("status.done")}</Badge> : null}
        {o.status === "cancelled" ? <Badge variant="outline">{t("status.cancelled")}</Badge> : null}
        {o.snoozedUntil && o.status === "open" ? <Badge variant="outline">{t("status.snoozed", { date: o.snoozedUntil.split("-").reverse().join("/") })}</Badge> : null}
        {o.stale ? <Badge variant="outline">{t("badges.stale")}</Badge> : null}
      </span>
      <span className="text-sm text-muted-foreground">
        {[date(o.dueOn), o.status === "open" && !o.overdue ? t("inDays", { count: o.daysLeft }) : null, o.assetName].filter(Boolean).join(" · ")}
      </span>
    </Link>
  );
}

function MonthGrid({ month, items, today, prev, next }: { month: string; items: OccurrenceListItem[]; today: string; prev: string; next: string }) {
  const t = useTranslations("deadlines.calendar");
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const lead = (weekday(`${month}-01`) + 6) % 7; // lunedi' = 0
  const days = daysInMonth(year, m);
  const cells = Array.from({ length: Math.ceil((lead + days) / 7) * 7 }, (_, i) => i - lead + 1);
  const byDay = new Map<string, OccurrenceListItem[]>();
  for (const i of items) byDay.set(i.dueOn, [...(byDay.get(i.dueOn) ?? []), i]);
  const title = new Date(`${month}-01T00:00:00`).toLocaleDateString("it-IT", { month: "long", year: "numeric" });

  return (
    <section aria-label={title} className="flex flex-col gap-3" data-testid="calendar">
      <div className="flex items-center justify-between">
        <Link href={prev} className={buttonVariants({ variant: "outline", size: "sm" })}>
          <ChevronLeft aria-hidden /> {t("previous")}
        </Link>
        <h2 className="text-lg font-medium capitalize">{title}</h2>
        <Link href={next} className={buttonVariants({ variant: "outline", size: "sm" })}>
          {t("next")} <ChevronRight aria-hidden />
        </Link>
      </div>
      <table className="w-full table-fixed border-collapse text-sm">
        <thead>
          <tr>
            {[1, 2, 3, 4, 5, 6, 0].map((d) => (
              <th key={d} scope="col" className="border-b p-1 text-left font-medium text-muted-foreground">
                {t(`weekdays.${d as 0}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: cells.length / 7 }, (_, row) => (
            <tr key={row}>
              {cells.slice(row * 7, row * 7 + 7).map((day, col) => {
                const key = day >= 1 && day <= days ? clampedDate(year, m, day) : null;
                const list = key ? (byDay.get(key) ?? []) : [];
                return (
                  <td key={col} className={`h-20 border align-top p-1 ${key === today ? "bg-accent/40" : ""}`}>
                    {key ? (
                      <>
                        <span className="text-xs text-muted-foreground">{day}</span>
                        <ul className="flex flex-col gap-0.5">
                          {list.slice(0, 3).map((o) => (
                            <li key={o.id} className="truncate">
                              <Link href={`/scadenze/${o.deadlineId}`} className={`underline-offset-2 hover:underline ${o.overdue ? "font-medium text-destructive" : ""}`}>
                                {o.title}
                              </Link>
                            </li>
                          ))}
                          {list.length > 3 ? <li className="text-xs text-muted-foreground">+{list.length - 3}</li> : null}
                        </ul>
                      </>
                    ) : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-sm text-muted-foreground">{t("items", { count: items.length })}</p>
    </section>
  );
}
