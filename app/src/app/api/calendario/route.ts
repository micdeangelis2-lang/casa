import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { getAuthEnv } from "@/platform/config/env";
import { getOwnerForApi } from "@/platform/auth/owner";
import { rejectCrossSite } from "@/platform/auth/request-guard";
import { getDb } from "@/platform/db/client";
import { DEADLINE_CATEGORIES, PRIORITIES, deadlinesCalendar, type CalendarLabels } from "@/modules/deadlines";

/** Le scadenze aperte come calendario .ics, da importare nel proprio programma di calendario. Serve la sessione del proprietario. */
export async function GET() {
  const crossSite = await rejectCrossSite();
  if (crossSite) return crossSite;
  const owner = await getOwnerForApi();
  if (!owner) return new NextResponse(null, { status: 401 });

  const t = await getTranslations({ locale: "it", namespace: "deadlines" });
  const labels: CalendarLabels = {
    name: t("calendarExport.name"),
    category: Object.fromEntries(DEADLINE_CATEGORIES.map((c) => [c, t(`category.${c}`)])) as CalendarLabels["category"],
    priority: Object.fromEntries(PRIORITIES.map((p) => [p, t(`priority.${p}`)])) as CalendarLabels["priority"],
    fields: {
      category: t("calendarExport.fields.category"),
      asset: t("calendarExport.fields.asset"),
      priority: t("calendarExport.fields.priority"),
      proofRequired: t("calendarExport.fields.proofRequired"),
    },
    alarm: (title) => t("calendarExport.alarm", { title }),
  };

  const ics = await deadlinesCalendar(getDb(), labels, { baseUrl: getAuthEnv().BETTER_AUTH_URL });
  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="scadenze-immobili.ics"',
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
