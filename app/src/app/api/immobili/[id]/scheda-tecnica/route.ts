import { NextResponse } from "next/server";
import { getOwnerForApi } from "@/platform/auth/owner";
import { rejectCrossSite } from "@/platform/auth/request-guard";
import { getDb } from "@/platform/db/client";
import { isUuid } from "@/lib/ids";
import { csvResponse } from "@/lib/csv-response";
import { loadTechnicalCsv } from "@/lib/share-sheets";

/** Scheda per il tecnico di un immobile in CSV, da aprire in un foglio di calcolo. Serve la sessione del proprietario. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const crossSite = await rejectCrossSite();
  if (crossSite) return crossSite;
  const owner = await getOwnerForApi();
  if (!owner) return new NextResponse(null, { status: 401 });

  const { id } = await params;
  if (!isUuid(id)) return new NextResponse(null, { status: 404 });
  const sheet = await loadTechnicalCsv(getDb(), id);
  if (!sheet) return new NextResponse(null, { status: 404 });
  return csvResponse(sheet.csv, `scheda-tecnica-${sheet.today}.csv`);
}
