import { createAuditRecorder, type AuditActor, type AuditRecorder } from "../audit";
import type { Db } from "./types";

export interface UnitOfWork {
  /** Transazione corrente: tutti i repository di un caso d'uso usano questa. */
  tx: Db;
  audit: AuditRecorder;
}

/**
 * Esegue un caso d'uso in una sola transazione con audit.
 * Regola dell'architettura: ogni scrittura passa da qui, quindi
 * "modifica avvenuta" e "riga di audit presente" sono atomiche.
 */
export function runInUnitOfWork<T>(
  db: Db,
  actor: AuditActor,
  work: (uow: UnitOfWork) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => work({ tx, audit: createAuditRecorder(tx, actor) }));
}
