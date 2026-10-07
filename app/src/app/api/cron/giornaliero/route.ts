import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getBackupEnv } from "@/platform/config/env";
import { getDb } from "@/platform/db/client";
import { runDailyJob } from "@/lib/daily-job";

const sameSecret = (given: string, expected: string) => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * Giro giornaliero (dossier, date delle scadenze, avvisi, email). Vercel chiama le route dei cron con
 * `Authorization: Bearer <CRON_SECRET>`; senza il segreto la route e' chiusa.
 * NON verificato su Vercel (serve l'account): vedi DECISIONS.md.
 */
export async function GET(request: NextRequest) {
  const secret = getBackupEnv().CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret || !sameSecret(header, `Bearer ${secret}`)) return new NextResponse(null, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await runDailyJob(getDb(), { type: "system", id: "cron" })) });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Errore" }, { status: 500 });
  }
}
