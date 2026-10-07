import { NextResponse } from "next/server";
import { getOwnerForApi } from "@/platform/auth/owner";
import { rejectCrossSite } from "@/platform/auth/request-guard";
import { getDb } from "@/platform/db/client";
import { createExport } from "@/modules/backup";
import { toWebStream } from "@/shared/archive/stream";

/** Esportazione completa in chiaro, senza credenziali. Serve la sessione del proprietario. */
export async function GET() {
  const crossSite = await rejectCrossSite();
  if (crossSite) return crossSite;
  const owner = await getOwnerForApi();
  if (!owner) return new NextResponse(null, { status: 401 });

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
