import { NextResponse, type NextRequest } from "next/server";
import { getOwnerForApi } from "@/platform/auth/owner";
import { rejectCrossSite } from "@/platform/auth/request-guard";
import { getDb } from "@/platform/db/client";
import { CONFIDENTIALITY_LEVELS } from "@/modules/sharing";
import type { Level } from "@/modules/agent";
import { isUuid } from "@/lib/ids";
import { csvResponse } from "@/lib/csv-response";
import { loadAgentCsv } from "@/lib/share-sheets";

/**
 * Scheda per l'agente immobiliare in CSV, con le stesse scelte della pagina: tetto di riservatezza (`livello`, predefinito
 * «ordinario»), categorie (`categoria`) e nomi dei titolari solo con `titolari=1`. I nomi degli inquilini non compaiono mai.
 * Serve la sessione del proprietario.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const crossSite = await rejectCrossSite();
  if (crossSite) return crossSite;
  const owner = await getOwnerForApi();
  if (!owner) return new NextResponse(null, { status: 401 });

  const { id } = await params;
  if (!isUuid(id)) return new NextResponse(null, { status: 404 });
  const query = request.nextUrl.searchParams;
  const level = query.get("livello") ?? "";
  const cap: Level = (CONFIDENTIALITY_LEVELS as readonly string[]).includes(level) ? (level as Level) : "ordinary";
  const sheet = await loadAgentCsv(getDb(), id, { cap, focusCategoryIds: query.getAll("categoria").filter(isUuid), includeRights: query.get("titolari") === "1" });
  if (!sheet) return new NextResponse(null, { status: 404 });
  return csvResponse(sheet.csv, `scheda-agente-${id.slice(0, 8)}.csv`);
}
