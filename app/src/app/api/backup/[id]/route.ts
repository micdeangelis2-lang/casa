import { NextResponse } from "next/server";
import { getOwnerForApi } from "@/platform/auth/owner";
import { rejectCrossSite } from "@/platform/auth/request-guard";
import { getDb } from "@/platform/db/client";
import { backupSettingsFromEnv, getBackupRun, openBackupArchive } from "@/modules/backup";
import { isUuid } from "@/lib/ids";

/** Scarica un backup (resta cifrato). Serve la sessione del proprietario. */
export async function GET(_request: Request, { params }: RouteContext<"/api/backup/[id]">) {
  const crossSite = await rejectCrossSite();
  if (crossSite) return crossSite;
  const owner = await getOwnerForApi();
  if (!owner) return new NextResponse(null, { status: 401 });

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
