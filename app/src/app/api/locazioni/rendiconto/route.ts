import { NextResponse, type NextRequest } from "next/server";
import { getOwnerForApi } from "@/platform/auth/owner";
import { rejectCrossSite } from "@/platform/auth/request-guard";
import { getDb } from "@/platform/db/client";
import { todayInItaly } from "@/platform/clock";
import { statementParams } from "@/lib/gestore-params";
import { csvResponse } from "@/lib/csv-response";
import { loadStatementCsv } from "@/lib/share-sheets";

/** Rendiconto di gestione di un immobile e di un periodo in CSV. Serve la sessione del proprietario. */
export async function GET(request: NextRequest) {
  const crossSite = await rejectCrossSite();
  if (crossSite) return crossSite;
  const owner = await getOwnerForApi();
  if (!owner) return new NextResponse(null, { status: 401 });

  const params = request.nextUrl.searchParams;
  const { assetId, from, to } = statementParams((k) => params.get(k) ?? "", todayInItaly());
  if (!assetId) return new NextResponse("Immobile non valido", { status: 400 });

  const sheet = await loadStatementCsv(getDb(), { assetId, from, to });
  if (!sheet) return new NextResponse("Immobile non trovato", { status: 404 });
  return csvResponse(sheet.csv, `rendiconto-gestione-${from}-${to}.csv`);
}
