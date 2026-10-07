import { NextResponse, type NextRequest } from "next/server";
import { getTranslations } from "next-intl/server";
import { getOwnerForApi } from "@/platform/auth/owner";
import { rejectCrossSite } from "@/platform/auth/request-guard";
import { getDb } from "@/platform/db/client";
import { todayInItaly } from "@/platform/clock";
import { getPlantRegister } from "@/modules/maintenance";
import { PLANT_TYPE_CODES, loadPlantTypes } from "@/app/(app)/manutenzioni/impianti/plant-types";
import { isUuid } from "@/lib/ids";
import { csvResponse } from "@/lib/csv-response";
import { plantRegisterCsv } from "@/lib/sheet-csv";

/** Finestra di «in scadenza» come nella pagina: la sceglie il proprietario (`giorni`), questo e' il valore iniziale. */
const DEFAULT_WINDOW = 60;
const ALL_TYPES: string[] = [...PLANT_TYPE_CODES, "other"];

/** Registro degli impianti in CSV, con gli stessi filtri della pagina (`immobile`, `tipo`, `giorni`). Serve la sessione del proprietario. */
export async function GET(request: NextRequest) {
  const crossSite = await rejectCrossSite();
  if (crossSite) return crossSite;
  const owner = await getOwnerForApi();
  if (!owner) return new NextResponse(null, { status: 401 });

  const query = request.nextUrl.searchParams;
  const asked = query.get("immobile") ?? "";
  const assetId = isUuid(asked) ? asked : undefined;
  const typeAsked = query.get("tipo") ?? "";
  const type = ALL_TYPES.includes(typeAsked) ? typeAsked : undefined;
  const windowAsked = Number(query.get("giorni"));
  const soonDays = Number.isInteger(windowAsked) && windowAsked >= 1 && windowAsked <= 365 ? windowAsked : DEFAULT_WINDOW;

  const today = todayInItaly();
  const { defs, name } = await loadPlantTypes();
  const register = await getPlantRegister(getDb(), { assetId, type, types: defs, today, soonDays });
  const t = await getTranslations({ locale: "it", namespace: "impiantista" });
  const csv = plantRegisterCsv(register, today, {
    typeName: name,
    state: (c) => t(`state.${c as "overdue"}`),
    dueKind: (c) => t(`due.kinds.${c as "inspection"}`),
    workStatus: (c) => t(`workStatus.${c as "planned"}`),
  });
  return csvResponse(csv, `registro-impianti-${today}.csv`);
}
