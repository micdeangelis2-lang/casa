import { NextResponse } from "next/server";
import { getOwnerForApi } from "@/platform/auth/owner";
import { rejectCrossSite } from "@/platform/auth/request-guard";
import { importTemplate } from "@/modules/import";

const TYPES = {
  contatti: { kind: "contacts", file: "modello-contatti.csv" },
  immobili: { kind: "assets", file: "modello-immobili.csv" },
  scadenze: { kind: "deadlines", file: "modello-scadenze.csv" },
  canoni: { kind: "rents", file: "modello-canoni.csv" },
  tributi: { kind: "taxes", file: "modello-tributi.csv" },
  "pagamenti-tributi": { kind: "taxPayments", file: "modello-pagamenti-tributi.csv" },
  polizze: { kind: "policies", file: "modello-polizze.csv" },
} as const;

/** Modello CSV per l'importazione: intestazioni e una riga di esempio fittizia (`;`, BOM, CRLF). */
export async function GET(request: Request) {
  const crossSite = await rejectCrossSite();
  if (crossSite) return crossSite;
  const owner = await getOwnerForApi();
  if (!owner) return new NextResponse(null, { status: 401 });

  const tipo = new URL(request.url).searchParams.get("tipo") ?? "";
  const type = Object.hasOwn(TYPES, tipo) ? TYPES[tipo as keyof typeof TYPES] : null;
  if (!type) return NextResponse.json({ error: "Tipo non valido: usa contatti, immobili, scadenze, canoni, tributi, pagamenti-tributi o polizze" }, { status: 400 });
  return new NextResponse(importTemplate(type.kind), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${type.file}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
