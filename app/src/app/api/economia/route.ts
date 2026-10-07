import { NextResponse, type NextRequest } from "next/server";
import { getOwnerForApi } from "@/platform/auth/owner";
import { rejectCrossSite } from "@/platform/auth/request-guard";
import { getDb } from "@/platform/db/client";
import { economyCsv, getEconomy } from "@/modules/economy";
import { isUuid } from "@/lib/ids";

/** Quadro economico di un anno in CSV, da aprire in un foglio di calcolo. Serve la sessione del proprietario. */
export async function GET(request: NextRequest) {
  const crossSite = await rejectCrossSite();
  if (crossSite) return crossSite;
  const owner = await getOwnerForApi();
  if (!owner) return new NextResponse(null, { status: 401 });

  const params = request.nextUrl.searchParams;
  const asked = params.get("anno") ?? "";
  if (!/^\d{4}$/.test(asked)) return new NextResponse("Anno non valido", { status: 400 });
  const assetParam = params.get("immobile") ?? "";
  const assetId = isUuid(assetParam) ? assetParam : undefined;

  const csv = economyCsv(await getEconomy(getDb(), Number(asked), assetId), "Non ripartito");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="quadro-economico-${asked}.csv"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
