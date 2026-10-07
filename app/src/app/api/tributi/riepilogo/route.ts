import { NextResponse, type NextRequest } from "next/server";
import { getOwnerForApi } from "@/platform/auth/owner";
import { rejectCrossSite } from "@/platform/auth/request-guard";
import { getDb } from "@/platform/db/client";
import { adviserSummary, summaryCsv } from "@/modules/taxes";

/** Riepilogo dell'anno in CSV, da aprire in un foglio di calcolo o consegnare al consulente. Serve la sessione del proprietario. */
export async function GET(request: NextRequest) {
  const crossSite = await rejectCrossSite();
  if (crossSite) return crossSite;
  const owner = await getOwnerForApi();
  if (!owner) return new NextResponse(null, { status: 401 });

  const asked = request.nextUrl.searchParams.get("anno") ?? "";
  if (!/^\d{4}$/.test(asked)) return new NextResponse("Anno non valido", { status: 400 });
  const year = Number(asked);

  const csv = summaryCsv(await adviserSummary(getDb(), year));
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="riepilogo-tributi-${year}.csv"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
