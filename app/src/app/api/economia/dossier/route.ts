import { NextResponse, type NextRequest } from "next/server";
import { getOwnerForApi } from "@/platform/auth/owner";
import { rejectCrossSite } from "@/platform/auth/request-guard";
import { getDb } from "@/platform/db/client";
import { dossierCsv, getDossier } from "@/modules/economy";

/** Dossier annuale per il commercialista in CSV (dati registrati e dati mancanti, senza calcoli). Serve la sessione del proprietario. */
export async function GET(request: NextRequest) {
  const crossSite = await rejectCrossSite();
  if (crossSite) return crossSite;
  const owner = await getOwnerForApi();
  if (!owner) return new NextResponse(null, { status: 401 });

  const asked = request.nextUrl.searchParams.get("anno") ?? "";
  if (!/^\d{4}$/.test(asked)) return new NextResponse("Anno non valido", { status: 400 });

  const csv = dossierCsv(await getDossier(getDb(), Number(asked)));
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="dossier-commercialista-${asked}.csv"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
