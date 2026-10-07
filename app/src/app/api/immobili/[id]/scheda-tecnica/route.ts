import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { getOwnerForApi } from "@/platform/auth/owner";
import { rejectCrossSite } from "@/platform/auth/request-guard";
import { getDb } from "@/platform/db/client";
import { briefCsv, getTechnicalBrief } from "@/modules/technical";
import { isUuid } from "@/lib/ids";

/** Scheda per il tecnico di un immobile in CSV, da aprire in un foglio di calcolo. Serve la sessione del proprietario. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const crossSite = await rejectCrossSite();
  if (crossSite) return crossSite;
  const owner = await getOwnerForApi();
  if (!owner) return new NextResponse(null, { status: 401 });

  const { id } = await params;
  if (!isUuid(id)) return new NextResponse(null, { status: 404 });
  const brief = await getTechnicalBrief(getDb(), id);
  if (!brief) return new NextResponse(null, { status: 404 });

  const ta = await getTranslations("assets");
  const tdoc = await getTranslations("documents");
  const tdos = await getTranslations("dossier");
  const tm = await getTranslations("maintenance");
  const tmatter = await getTranslations("matters");
  const csv = briefCsv(brief, {
    kind: (c) => ta(`kind.${c as "dwelling"}`),
    use: (c) => ta(`use.${c as "let"}`),
    right: (c) => ta(`right.${c as "full"}`),
    workStatus: (c) => tm(`status.${c as "planned"}`),
    matterStatus: (c) => tmatter(`status.${c as "open"}`),
    dossierStatus: (c) => tdos(`status.${c as "missing"}`),
    verification: (c) => tdoc(`status.${c as "draft"}`),
    warrantyState: (c) => tm(`warranties.state.${c as "active"}`),
  });
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="scheda-tecnica-${brief.today}.csv"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
