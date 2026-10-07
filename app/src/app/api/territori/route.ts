import { NextResponse } from "next/server";
import { getOwnerForApi } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { searchTerritories, TERRITORY_KINDS, type TerritoryKind } from "@/modules/territory";

/** Ricerca di territori per i selettori: GET /api/territori?q=meta&kinds=municipality,locality */
export async function GET(request: Request) {
  const owner = await getOwnerForApi();
  if (!owner) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const requested = (url.searchParams.get("kinds") ?? "municipality").split(",");
  const kinds = requested.filter((k): k is TerritoryKind => (TERRITORY_KINDS as readonly string[]).includes(k));

  const results = await searchTerritories(getDb(), { query, kinds, limit: 15 });
  return NextResponse.json(
    { results: results.map((r) => ({ id: r.id, label: r.label })) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
