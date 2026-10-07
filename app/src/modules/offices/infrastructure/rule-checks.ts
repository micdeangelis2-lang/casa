import { and, eq, inArray, max, sql } from "drizzle-orm";
import { auditLog } from "@/platform/db/schema";
import type { Db } from "@/platform/db/types";

/**
 * Data dell'ultimo controllo di ogni versione di regola: l'ultima riga di audit `rule.verify` che l'ha portata a «verificata».
 * Non serve una colonna nuova: lo stato di verifica e' gia' una revisione registrata nell'audit (solo identificativi e stato).
 */
export async function lastVerificationAt(db: Db): Promise<Map<string, Date>> {
  const versionId = sql<string>`${auditLog.diff}->>'versionId'`;
  const rows = await db
    .select({ versionId, at: max(auditLog.at) })
    .from(auditLog)
    .where(and(eq(auditLog.action, "rule.verify"), inArray(sql`${auditLog.diff}->>'status'`, ["verified_by_owner", "validated_by_professional"])))
    .groupBy(versionId);
  return new Map(rows.flatMap((r) => (r.versionId && r.at ? [[r.versionId, new Date(r.at)] as const] : [])));
}
