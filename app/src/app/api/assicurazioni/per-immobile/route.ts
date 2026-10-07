import { NextResponse } from "next/server";
import { getOwnerForApi } from "@/platform/auth/owner";
import { rejectCrossSite } from "@/platform/auth/request-guard";
import { getDb } from "@/platform/db/client";
import { todayInItaly } from "@/platform/clock";
import { csvResponse } from "@/lib/csv-response";
import { loadPoliciesCsv } from "@/lib/share-sheets";

/** Polizze registrate per immobile in CSV (anche gli immobili senza polizza, e le polizze senza immobile). Serve la sessione del proprietario. */
export async function GET() {
  const crossSite = await rejectCrossSite();
  if (crossSite) return crossSite;
  const owner = await getOwnerForApi();
  if (!owner) return new NextResponse(null, { status: 401 });

  const sheet = await loadPoliciesCsv(getDb());
  return csvResponse(sheet.csv, `polizze-per-immobile-${todayInItaly()}.csv`);
}
