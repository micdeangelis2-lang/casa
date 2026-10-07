import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { PrintButton } from "@/components/print-button";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { todayInItaly } from "@/platform/clock";
import { listAssets } from "@/modules/assets";
import { CALENDAR_DAYS, getManagementCalendar } from "@/modules/management";
import { isUuid } from "@/lib/ids";
import { formatDate } from "@/lib/format";
import { GestoreTable } from "../_components/gestore-table";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("gestore.calendar");
  return { title: t("title") };
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function ManagementCalendarPage({ searchParams }: PageProps<"/locazioni/calendario">) {
  await requireOwner();
  const t = await getTranslations("gestore.calendar");
  const tc = await getTranslations("gestore.common");
  const params = await searchParams;
  const db = getDb();
  const assetId = isUuid(first(params.immobile)) ? first(params.immobile) : undefined;
  const today = todayInItaly();
  const [assets, calendar] = await Promise.all([listAssets(db), getManagementCalendar(db, { assetId, days: CALENDAR_DAYS }, today)]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <Alert>
        <AlertDescription>{t("intro")}</AlertDescription>
      </Alert>
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <form method="get" className="flex flex-wrap items-end gap-3" role="search">
          <div className="flex w-56 flex-col gap-2">
            <Label htmlFor="immobile">{tc("asset")}</Label>
            <NativeSelect id="immobile" name="immobile" defaultValue={assetId ?? ""}>
              <option value="">{tc("allAssets")}</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button type="submit" variant="secondary">
            {tc("apply")}
          </Button>
        </form>
        <PrintButton />
      </div>

      <section aria-labelledby="events-heading" className="flex flex-col gap-2">
        <h2 id="events-heading" className="text-lg font-medium">
          {t("eventsHeading")}
        </h2>
        {calendar.events.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("emptyEvents")}</p>
        ) : (
          <GestoreTable
            label={t("eventsHeading")}
            testId="calendar-events"
            headers={[t("date"), t("kind"), t("what"), tc("asset")]}
            rows={calendar.events.map((e, i) => ({
              key: `${e.kind}-${e.date}-${i}`,
              cells: [
                <span key="d">
                  {formatDate(e.date)} {e.overdue ? <Badge variant="destructive">{t("overdue")}</Badge> : null}
                </span>,
                t(`kinds.${e.kind}`),
                <Link key="l" href={e.href} className="underline underline-offset-2">
                  {e.title}
                </Link>,
                e.assetName ?? "",
              ],
            }))}
          />
        )}
      </section>

      <section aria-labelledby="occupations-heading" className="flex flex-col gap-2">
        <h2 id="occupations-heading" className="text-lg font-medium">
          {t("occupationsHeading")}
        </h2>
        {calendar.occupations.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("emptyOccupations")}</p>
        ) : (
          <GestoreTable
            label={t("occupationsHeading")}
            testId="calendar-occupations"
            headers={[t("occupation.title"), tc("asset"), t("occupation.type"), t("occupation.period")]}
            rows={calendar.occupations.map((o) => ({
              key: o.id,
              cells: [
                <Link key="l" href={`/locazioni/${o.id}`} className="underline underline-offset-2">
                  {o.title}
                </Link>,
                o.assetName,
                t(`types.${o.type as "residential"}`),
                [o.startsOn ? formatDate(o.startsOn) : t("occupation.noStart"), o.endsOn ? formatDate(o.endsOn) : t("occupation.open")].join(" – "),
              ],
            }))}
          />
        )}
      </section>
    </div>
  );
}
