import { NextResponse } from "next/server";
import { rejectCrossSite } from "@/platform/auth/request-guard";
import { getOwnerForApi } from "@/platform/auth/owner";
import { getAuthEnv } from "@/platform/config/env";
import { getDb } from "@/platform/db/client";
import { getTerritory } from "@/modules/territory";
import { isUuid } from "@/lib/ids";
import { searchPlaces } from "@/lib/place-search";

const headers = { "Cache-Control": "private, no-store" };
/** Cortesia verso il servizio pubblico (come la policy di Nominatim): al massimo una richiesta al secondo. Limite semplice, in memoria, per processo. */
const MIN_INTERVAL_MS = 1000;
let lastCallAt = 0;

/**
 * Suggerimenti di frazioni/localita' del Comune scelto: GET /api/localita?comune=<uuid>&q=<testo>.
 * Il server chiama Photon (OpenStreetMap) (il browser non lo fa mai) e inoltra solo testo digitato e nome del Comune.
 */
export async function GET(request: Request) {
  const crossSite = await rejectCrossSite();
  if (crossSite) return crossSite;
  const owner = await getOwnerForApi();
  if (!owner) return new NextResponse(null, { status: 401 });

  const url = new URL(request.url);
  const comuneId = url.searchParams.get("comune") ?? "";
  const text = (url.searchParams.get("q") ?? "").trim();
  if (!isUuid(comuneId) || text.length < 2 || text.length > 60) {
    return NextResponse.json({ suggestions: [] }, { status: 400, headers });
  }

  const db = getDb();
  const comune = await getTerritory(db, comuneId);
  if (!comune || comune.kind !== "municipality") return NextResponse.json({ suggestions: [] }, { status: 404, headers });

  const now = Date.now();
  if (now - lastCallAt < MIN_INTERVAL_MS) {
    return NextResponse.json({ suggestions: [] }, { status: 429, headers: { ...headers, "Retry-After": "1" } });
  }
  lastCallAt = now;

  try {
    const suggestions = await searchPlaces(
      { text, comune: comune.name },
      { userAgent: `GestioneImmobili/1.0 (uso personale; ${getAuthEnv().BETTER_AUTH_URL})` },
    );
    return NextResponse.json({ suggestions }, { headers });
  } catch {
    return NextResponse.json({ suggestions: [] }, { status: 502, headers });
  }
}
