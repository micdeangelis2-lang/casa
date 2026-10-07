import { getAuthEnv } from "@/platform/config/env";
import type { AuditActor } from "@/platform/audit";
import type { Db } from "@/platform/db/types";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { mailFromEnv, runDailyCycle, type CycleResult } from "@/modules/deadlines";
import { evaluateAllDossiers } from "@/modules/dossier";

export type DailyJobResult = CycleResult & { evaluated: number };

/**
 * Giro giornaliero dell'app: rivaluta i dossier (regole, date di validita'), calcola le nuove date delle scadenze,
 * crea gli avvisi dovuti e invia le email. Idempotente: si puo' lanciare piu' volte nello stesso giorno.
 * Lo usano la route del cron e il pulsante «Esegui adesso» nelle impostazioni.
 */
export async function runDailyJob(db: Db, actor: AuditActor): Promise<DailyJobResult> {
  const baseUrl = getAuthEnv().BETTER_AUTH_URL;
  return runInUnitOfWork(db, actor, async (uow) => {
    const evaluation = await evaluateAllDossiers(uow);
    const cycle = await runDailyCycle(uow, { mail: mailFromEnv(), baseUrl });
    return { ...cycle, evaluated: evaluation.assets };
  });
}
