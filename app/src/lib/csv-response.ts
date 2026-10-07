import { NextResponse } from "next/server";

/** Risposta di scarico di un CSV: UTF-8 con BOM gia' nel testo, mai in cache, tipo dichiarato. */
export function csvResponse(csv: string, filename: string): NextResponse {
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
