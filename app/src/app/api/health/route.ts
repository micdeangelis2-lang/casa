import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/platform/db/client";

/** Attesa massima del database: oltre, l'app si dichiara non sana invece di restare appesa. */
const TIMEOUT_MS = 3000;

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

/**
 * Stato dell'app per un controllo esterno (monitoraggio, bilanciatore): risponde 200 se il database risponde, 503 altrimenti.
 * Volutamente pubblica e povera: non legge dati dell'archivio, non dice versioni, percorsi o motivi dell'errore.
 */
export async function GET() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      getDb().execute(sql`select 1`),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS);
      }),
    ]);
    return NextResponse.json({ status: "ok" }, { headers });
  } catch {
    return NextResponse.json({ status: "error" }, { status: 503, headers });
  } finally {
    clearTimeout(timer);
  }
}
