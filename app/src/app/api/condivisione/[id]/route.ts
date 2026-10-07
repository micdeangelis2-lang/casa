import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { getOwnerForApi } from "@/platform/auth/owner";
import { rejectCrossSite } from "@/platform/auth/request-guard";
import { getDb } from "@/platform/db/client";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { CONFIDENTIALITY_LEVELS, RECIPIENT_TYPES, packageStream, preparePackageDownload, type IndexLabels } from "@/modules/sharing";
import { VERIFICATION_STATUS } from "@/modules/documents";
import { toWebStream } from "@/shared/archive/stream";
import { isUuid } from "@/lib/ids";

/**
 * Scarica un pacchetto: il file ZIP si genera ora, a pezzi, direttamente verso il browser (nessuna copia sul server).
 * Lo scarico e' registrato nel registro delle condivisioni. Serve la sessione del proprietario.
 */
export async function GET(_request: Request, { params }: RouteContext<"/api/condivisione/[id]">) {
  const crossSite = await rejectCrossSite();
  if (crossSite) return crossSite;
  const owner = await getOwnerForApi();
  if (!owner) return new NextResponse(null, { status: 401 });
  const { id } = await params;
  if (!isUuid(id)) return new NextResponse(null, { status: 404 });

  const db = getDb();
  const prepared = await runInUnitOfWork(db, { type: "owner", id: owner.userId }, (uow) => preparePackageDownload(uow, id));
  if (!prepared.ok) return new NextResponse(null, { status: prepared.errors._?.[0]?.includes("revocato") ? 410 : 404 });

  const t = await getTranslations({ locale: "it", namespace: "sharing" });
  const tdoc = await getTranslations({ locale: "it", namespace: "documents" });
  const labels: IndexLabels = {
    recipient: Object.fromEntries(RECIPIENT_TYPES.map((r) => [r, t(`recipient.${r}`)])) as IndexLabels["recipient"],
    confidentiality: Object.fromEntries(CONFIDENTIALITY_LEVELS.map((c) => [c, t(`confidentiality.${c}`)])) as IndexLabels["confidentiality"],
    verification: Object.fromEntries(VERIFICATION_STATUS.map((s) => [s, tdoc(`status.${s}`)])),
  };
  const stream = await packageStream(db, prepared.value, labels);
  return new NextResponse(toWebStream(stream), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${prepared.value.filename}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
