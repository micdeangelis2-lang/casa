import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { getOwnerForApi } from "@/platform/auth/owner";
import { rejectCrossSite } from "@/platform/auth/request-guard";
import { getDb } from "@/platform/db/client";
import { timelineCsv } from "@/modules/matters";
import { isUuid } from "@/lib/ids";
import { csvLabels, loadMatterDossier } from "@/lib/matter-dossier";

/** Cronologia dei fatti registrati di una pratica in CSV, da consegnare al professionista. Serve la sessione del proprietario. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const crossSite = await rejectCrossSite();
  if (crossSite) return crossSite;
  const owner = await getOwnerForApi();
  if (!owner) return new NextResponse(null, { status: 401 });
  const { id } = await params;
  if (!isUuid(id)) return new NextResponse(null, { status: 404 });

  const t = await getTranslations({ locale: "it", namespace: "avvocato" });
  const tr = (key: string, values?: Record<string, string | number>) => t(key as never, values as never);
  const dossier = await loadMatterDossier(getDb(), id, tr);
  if (!dossier) return new NextResponse(null, { status: 404 });

  return new NextResponse(timelineCsv(dossier.timeline, csvLabels(tr)), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="cronologia-pratica-${id.slice(0, 8)}.csv"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
