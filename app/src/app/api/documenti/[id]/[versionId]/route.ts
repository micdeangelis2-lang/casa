import { NextResponse, type NextRequest } from "next/server";
import { getOwnerForApi } from "@/platform/auth/owner";
import { rejectCrossSite } from "@/platform/auth/request-guard";
import { getDb } from "@/platform/db/client";
import { INLINE_MIME_TYPES, openDocumentFile } from "@/modules/documents";
import { isUuid } from "@/lib/ids";

/**
 * Restituisce i byte di una versione. Mai URL pubblici: serve la sessione del proprietario.
 * PDF e immagini si aprono nel browser; gli altri tipi (e `?scarica=1`) si scaricano.
 */
export async function GET(request: NextRequest, { params }: RouteContext<"/api/documenti/[id]/[versionId]">) {
  const crossSite = await rejectCrossSite();
  if (crossSite) return crossSite;
  const owner = await getOwnerForApi();
  if (!owner) return new NextResponse(null, { status: 401 });

  const { id, versionId } = await params;
  if (!isUuid(id) || !isUuid(versionId)) return new NextResponse(null, { status: 404 });
  const file = await openDocumentFile(getDb(), id, versionId);
  if (!file) return new NextResponse(null, { status: 404 });

  const inline = (INLINE_MIME_TYPES as readonly string[]).includes(file.mimeType) && request.nextUrl.searchParams.get("scarica") !== "1";
  const asciiName = file.originalFilename.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return new NextResponse(file.stream, {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.sizeBytes),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.originalFilename)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
