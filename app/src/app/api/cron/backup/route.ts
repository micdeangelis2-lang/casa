import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getBackupEnv } from "@/platform/config/env";
import { getDb } from "@/platform/db/client";
import { runBackup } from "@/modules/backup";

const sameSecret = (given: string, expected: string) => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * Backup giornaliero. Vercel chiama le route dei cron con `Authorization: Bearer <CRON_SECRET>`:
 * senza CRON_SECRET configurato (o con un valore sbagliato) la route e' chiusa.
 * NON verificato su Vercel (serve l'account): vedi DECISIONS.md.
 */
export async function GET(request: NextRequest) {
  const secret = getBackupEnv().CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret || !sameSecret(header, `Bearer ${secret}`)) return new NextResponse(null, { status: 401 });

  const outcome = await runBackup(getDb(), { type: "system", id: "cron" }, "scheduled");
  return NextResponse.json(outcome.ok ? { ok: true, status: outcome.run.status } : { ok: false, message: outcome.message }, { status: outcome.ok ? 200 : 500 });
}
