import { sql } from "drizzle-orm";
import { auditLog } from "../db/schema";
import type { Db } from "../db/types";

export type AuditActor = {
  type: "owner" | "system";
  id: string;
};

export type AuditEvent = {
  /** Convenzione `<entita>.<azione>`, es. `asset.create`. */
  action: string;
  entityType: string;
  entityId: string;
  /** Campi modificati (prima/dopo). Mai contenuti di documenti ne' segreti: solo riferimenti. */
  diff?: Record<string, unknown>;
};

export interface AuditRecorder {
  record(event: AuditEvent): Promise<void>;
}

/** Scrive una riga di audit usando la transazione corrente: se la modifica fallisce, l'audit non esiste. */
export function createAuditRecorder(tx: Db, actor: AuditActor): AuditRecorder {
  return {
    async record(event) {
      await tx.insert(auditLog).values({
        actorType: actor.type,
        actorId: actor.id,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        diff: event.diff ?? {},
      });
    },
  };
}

export type AuditVerification =
  | { intact: true; headHash: string | null; rows: number }
  | { intact: false; firstBrokenSeq: number };

type VerifyRow = { broken: string | null; head: string | null; total: string };

/**
 * Ricalcola la catena di hash. Rileva modifiche ai campi, righe rimosse nel mezzo
 * e righe inserite fuori catena. NON rileva la rimozione delle ultime righe se
 * non si confronta `headHash` con una copia esterna (backup, interfaccia).
 */
export async function verifyAuditChain(db: Db): Promise<AuditVerification> {
  const result = (await db.execute(
    sql`select audit_log_verify() as broken,
               (select hash from audit_log order by seq desc limit 1) as head,
               (select count(*) from audit_log) as total`,
  )) as unknown as { rows: VerifyRow[] };
  const row = result.rows[0];
  if (!row) throw new Error("audit_log_verify non ha restituito risultati");
  if (row.broken !== null) {
    return { intact: false, firstBrokenSeq: Number(row.broken) };
  }
  return { intact: true, headHash: row.head, rows: Number(row.total) };
}

export type AuditEntry = {
  seq: number;
  at: Date;
  actorType: string;
  action: string;
  entityType: string;
  entityId: string;
  diff: Record<string, unknown>;
};

/** `a_b%` → `a\_b\%`: il testo cercato con LIKE vale alla lettera. */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

const areaFilter = (area: string | undefined) => (area ? sql`where action like ${`${escapeLike(area)}.%`}` : sql``);

/** Le righe del registro dalla piu' recente. `area` e' la parte dell'azione prima del punto (es. «asset» per `asset.create`). */
export async function listAuditEntries(db: Db, args: { area?: string; limit: number; offset: number }): Promise<{ rows: AuditEntry[]; total: number }> {
  const filter = areaFilter(args.area);
  const [list, count] = await Promise.all([
    db.execute(
      sql`select seq, at, actor_type, action, entity_type, entity_id, diff from audit_log ${filter} order by seq desc limit ${args.limit} offset ${args.offset}`,
    ) as unknown as Promise<{ rows: { seq: string | number; at: Date | string; actor_type: string; action: string; entity_type: string; entity_id: string; diff: Record<string, unknown> }[] }>,
    db.execute(sql`select count(*) as total from audit_log ${filter}`) as unknown as Promise<{ rows: { total: string | number }[] }>,
  ]);
  return {
    rows: list.rows.map((r) => ({ seq: Number(r.seq), at: new Date(r.at), actorType: r.actor_type, action: r.action, entityType: r.entity_type, entityId: r.entity_id, diff: r.diff ?? {} })),
    total: Number(count.rows[0]?.total ?? 0),
  };
}

/** Le aree presenti nel registro (la parte dell'azione prima del punto), in ordine alfabetico. */
export async function listAuditAreas(db: Db): Promise<string[]> {
  const result = (await db.execute(sql`select distinct split_part(action, '.', 1) as area from audit_log order by 1`)) as unknown as { rows: { area: string }[] };
  return result.rows.map((r) => r.area).filter(Boolean);
}

/** L'ultima riga e la sua impronta: da confrontare con quella annotata nei backup. */
export async function auditHead(db: Db): Promise<{ seq: number; hash: string } | null> {
  const result = (await db.execute(sql`select seq, hash from audit_log order by seq desc limit 1`)) as unknown as { rows: { seq: string | number; hash: string }[] };
  const row = result.rows[0];
  return row ? { seq: Number(row.seq), hash: row.hash } : null;
}
