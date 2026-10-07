import { NextResponse } from "next/server";
import { getOwnerForApi } from "@/platform/auth/owner";
import { requireRecentAuthForApi } from "@/platform/auth/recent-auth";
import { rejectCrossSite } from "@/platform/auth/request-guard";
import { getDb } from "@/platform/db/client";
import { createExport } from "@/modules/backup";
import { toWebStream } from "@/shared/archive/stream";

/** Esportazione completa in chiaro, senza credenziali. Serve la sessione del proprietario e una riconferma recente (F-04). */
export async function GET(request: Request) {
  const crossSite = await rejectCrossSite();
  if (crossSite) return crossSite;
  const owner = await getOwnerForApi();
  if (!owner) return new NextResponse(null, { status: 401 });
  const recent = await requireRecentAuthForApi(request, owner);
  if (recent) return recent;

  const { stream } = await createExport(getDb(), { type: "owner", id: owner.userId });
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(toWebStream(stream), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="gestione-immobili-esportazione-${day}.zip"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
