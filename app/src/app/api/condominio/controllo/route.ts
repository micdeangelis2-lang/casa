import { NextResponse, type NextRequest } from "next/server";
import { getOwnerForApi } from "@/platform/auth/owner";
import { rejectCrossSite } from "@/platform/auth/request-guard";
import { getDb } from "@/platform/db/client";
import { deliveriesCsv, filterResolutions, getOwnerReview, resolutionsCsv, statementCsv } from "@/modules/condominium";
import { condominiumReviewLabels } from "@/lib/condominio-review-labels";
import { isUuid } from "@/lib/ids";

const VIEWS = ["versamenti", "consegne", "delibere"] as const;

/** Le viste di controllo del condominio in CSV. Serve la sessione del proprietario. */
export async function GET(request: NextRequest) {
  const crossSite = await rejectCrossSite();
  if (crossSite) return crossSite;
  const owner = await getOwnerForApi();
  if (!owner) return new NextResponse(null, { status: 401 });

  const params = request.nextUrl.searchParams;
  const view = params.get("vista") ?? "";
  if (!(VIEWS as readonly string[]).includes(view)) return new NextResponse("Vista non valida", { status: 400 });
  const condo = params.get("condominio") ?? "";
  const condominiumId = isUuid(condo) ? condo : undefined;
  const year = /^\d{4}$/.test(params.get("anno") ?? "") ? Number(params.get("anno")) : undefined;

  const [review, labels] = await Promise.all([getOwnerReview(getDb()), condominiumReviewLabels()]);
  const csv =
    view === "versamenti"
      ? statementCsv(review, condominiumId, labels)
      : view === "consegne"
        ? deliveriesCsv(review, condominiumId, labels)
        : resolutionsCsv(filterResolutions(review.resolutions, { condominiumId, outcome: params.get("esito") || undefined, year, withoutFollowUp: params.get("senzaSeguito") === "1" }), labels);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="condominio-${view}.csv"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
