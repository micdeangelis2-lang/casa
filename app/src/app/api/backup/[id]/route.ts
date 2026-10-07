import { NextResponse } from "next/server";
import { getOwnerForApi } from "@/platform/auth/owner";
import { requireRecentAuthForApi } from "@/platform/auth/recent-auth";
import { rejectCrossSite } from "@/platform/auth/request-guard";
import { getDb } from "@/platform/db/client";
import { backupSettingsFromEnv, getBackupRun, openBackupArchive } from "@/modules/backup";
import { isUuid } from "@/lib/ids";

/** Scarica un backup (resta cifrato). Serve la sessione del proprietario e una riconferma recente (F-04). */
export async function GET(request: Request, { params }: RouteContext<"/api/backup/[id]">) {
  const crossSite = await rejectCrossSite();
  if (crossSite) return crossSite;
  const owner = await getOwnerForApi();
  if (!owner) return new NextResponse(null, { status: 401 });
  const recent = await requireRecentAuthForApi(request, owner);
  if (recent) return recent;

  const { id } = await params;
  if (!isUuid(id)) return new NextResponse(null, { status: 404 });
  const run = await getBackupRun(getDb(), id);
  if (!run?.destinationKey || (run.status !== "completed" && run.status !== "warning")) return new NextResponse(null, { status: 404 });

  const stream = await openBackupArchive(backupSettingsFromEnv().destination, run.destinationKey);
  if (!stream) return new NextResponse(null, { status: 404 });
  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${run.destinationKey}"`,
      "Content-Length": String(run.sizeBytes ?? ""),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
