import { NextResponse, type NextRequest } from "next/server";
import { getOwnerForApi } from "@/platform/auth/owner";
import { rejectCrossSite } from "@/platform/auth/request-guard";
import { getDb } from "@/platform/db/client";
import { todayInItaly } from "@/platform/clock";
import { getManagementStatement, statementCsv } from "@/modules/management";
import { statementParams } from "@/lib/gestore-params";

/** Rendiconto di gestione di un immobile e di un periodo in CSV. Serve la sessione del proprietario. */
export async function GET(request: NextRequest) {
  const crossSite = await rejectCrossSite();
  if (crossSite) return crossSite;
  const owner = await getOwnerForApi();
  if (!owner) return new NextResponse(null, { status: 401 });

  const params = request.nextUrl.searchParams;
  const { assetId, from, to } = statementParams((k) => params.get(k) ?? "", todayInItaly());
  if (!assetId) return new NextResponse("Immobile non valido", { status: 400 });

  const statement = await getManagementStatement(getDb(), { assetId, from, to });
  if (!statement.assetName) return new NextResponse("Immobile non trovato", { status: 404 });
  const csv = statementCsv(statement, {
    title: "Rendiconto di gestione",
    note: "Cio' che risulta dai dati registrati: non valuta la gestione ne' la sua correttezza.",
    area: { taxes: "Tributi", insurance: "Assicurazioni", maintenance: "Manutenzioni", condominium: "Condominio", lettings: "Locazioni (incassi)" },
    state: { paid: "Incassato", partial: "Parziale", overdue: "Non incassato, data superata", due: "Da incassare" },
    stage: { requested: "Richiesto", approved: "Approvato o in corso", executed: "Eseguito", cancelled: "Annullato" },
  });
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="rendiconto-gestione-${from}-${to}.csv"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
