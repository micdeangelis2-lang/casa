import { NextResponse, type NextRequest } from "next/server";
import { getOwnerForApi } from "@/platform/auth/owner";
import { rejectCrossSite } from "@/platform/auth/request-guard";
import { getDb } from "@/platform/db/client";
import { isUuid } from "@/lib/ids";
import { csvResponse } from "@/lib/csv-response";
import { loadNotaryCsv } from "@/lib/share-sheets";

/** Scheda per il notaio di un immobile in CSV (categorie dei documenti scelte con `categoria`). Serve la sessione del proprietario. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const crossSite = await rejectCrossSite();
  if (crossSite) return crossSite;
  const owner = await getOwnerForApi();
  if (!owner) return new NextResponse(null, { status: 401 });

  const { id } = await params;
  if (!isUuid(id)) return new NextResponse(null, { status: 404 });
  const focusCategoryIds = request.nextUrl.searchParams.getAll("categoria").filter(isUuid);
  const sheet = await loadNotaryCsv(getDb(), id, { focusCategoryIds });
  if (!sheet) return new NextResponse(null, { status: 404 });
  return csvResponse(sheet.csv, `scheda-notaio-${id.slice(0, 8)}.csv`);
}
