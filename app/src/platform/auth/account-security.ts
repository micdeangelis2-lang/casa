import { and, count, desc, eq, gt, ne, sql } from "drizzle-orm";
import type { UnitOfWork } from "../db/unit-of-work";
import type { Db } from "../db/types";
import { passkey, rateLimit, session, user } from "../db/schema";
import { canRemovePasskey } from "@/shared/account-security";

/**
 * Gestione di passkey e sessioni del proprietario. Le scritture passano da una `UnitOfWork`: modifica e riga di audit sono
 * atomiche. L'audit contiene solo il nome dell'azione e identificativi/conteggi: mai i nomi scelti dall'utente.
 * (Niente "server-only": il file non importa nulla del framework, cosi' si prova con PGlite nei test.)
 */

export type PasskeyRow = {
  id: string;
  name: string | null;
  createdAt: Date | null;
  deviceType: string;
  backedUp: boolean;
};

export type SessionRow = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
};

export type SecurityError = "notFound" | "lastPasskey" | "currentSession" | "invalidName";
export type SecurityResult<T = unknown> = ({ ok: true } & T) | { ok: false; error: SecurityError };

export const PASSKEY_NAME_MAX = 60;

export async function listPasskeys(db: Db, userId: string): Promise<PasskeyRow[]> {
  return db
    .select({
      id: passkey.id,
      name: passkey.name,
      createdAt: passkey.createdAt,
      deviceType: passkey.deviceType,
      backedUp: passkey.backedUp,
    })
    .from(passkey)
    .where(eq(passkey.userId, userId))
    .orderBy(passkey.createdAt);
}

/** Sessioni ancora valide del proprietario, dalla piu' recente. Il token non esce mai dal database. */
export async function listActiveSessions(db: Db, userId: string, now: Date = new Date()): Promise<SessionRow[]> {
  return db
    .select({
      id: session.id,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
    })
    .from(session)
    .where(and(eq(session.userId, userId), gt(session.expiresAt, now)))
    .orderBy(desc(session.updatedAt));
}

/** Blocca la riga del proprietario fino a fine transazione: due rimozioni in parallelo non possono lasciare zero passkey. */
async function lockOwner({ tx }: UnitOfWork, userId: string): Promise<void> {
  await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for("update");
}

export async function renamePasskey(uow: UnitOfWork, userId: string, passkeyId: string, rawName: string): Promise<SecurityResult> {
  const name = rawName.trim();
  if (name.length < 1 || name.length > PASSKEY_NAME_MAX) return { ok: false, error: "invalidName" };
  const updated = await uow.tx
    .update(passkey)
    .set({ name })
    .where(and(eq(passkey.id, passkeyId), eq(passkey.userId, userId)))
    .returning({ id: passkey.id });
  if (updated.length === 0) return { ok: false, error: "notFound" };
  await uow.audit.record({ action: "owner.passkey.rename", entityType: "passkey", entityId: passkeyId });
  return { ok: true };
}

/** Invariante E6 applicata qui, sul server: l'ultima passkey non si rimuove, qualunque cosa mandi l'interfaccia. */
export async function removePasskey(uow: UnitOfWork, userId: string, passkeyId: string): Promise<SecurityResult> {
  await lockOwner(uow, userId);
  const [owned] = await uow.tx
    .select({ id: passkey.id })
    .from(passkey)
    .where(and(eq(passkey.id, passkeyId), eq(passkey.userId, userId)));
  if (!owned) return { ok: false, error: "notFound" };
  const [total] = await uow.tx.select({ n: count() }).from(passkey).where(eq(passkey.userId, userId));
  if (!canRemovePasskey(total?.n ?? 0)) return { ok: false, error: "lastPasskey" };
  await uow.tx.delete(passkey).where(and(eq(passkey.id, passkeyId), eq(passkey.userId, userId)));
  await uow.audit.record({ action: "owner.passkey.remove", entityType: "passkey", entityId: passkeyId });
  return { ok: true };
}

/** Revoca una sessione diversa da quella in uso (per uscire da questa c'e' il pulsante «Esci»). */
export async function revokeSession(uow: UnitOfWork, userId: string, currentSessionId: string, sessionId: string): Promise<SecurityResult> {
  if (sessionId === currentSessionId) return { ok: false, error: "currentSession" };
  const removed = await uow.tx
    .delete(session)
    .where(and(eq(session.id, sessionId), eq(session.userId, userId)))
    .returning({ id: session.id });
  if (removed.length === 0) return { ok: false, error: "notFound" };
  await uow.audit.record({ action: "owner.session.revoke", entityType: "session", entityId: sessionId });
  return { ok: true };
}

/** Revoca tutte le sessioni tranne quella in uso. Restituisce quante ne ha chiuse. */
export async function revokeOtherSessions(uow: UnitOfWork, userId: string, currentSessionId: string): Promise<SecurityResult<{ revoked: number }>> {
  const removed = await uow.tx
    .delete(session)
    .where(and(eq(session.userId, userId), ne(session.id, currentSessionId)))
    .returning({ id: session.id });
  await uow.audit.record({ action: "owner.sessions.revoke_others", entityType: "user", entityId: userId, diff: { revoked: removed.length } });
  return { ok: true, revoked: removed.length };
}

/** Tentativi di password consentiti per finestra nelle azioni «cambia password» e «rigenera i codici di recupero». */
export const PASSWORD_ATTEMPTS_MAX = 5;
export const PASSWORD_ATTEMPTS_WINDOW_MS = 15 * 60 * 1000;

const passwordAttemptsKey = (userId: string) => `owner-password-actions|${userId}`;

/**
 * Prenota un tentativo di password per le azioni della pagina di sicurezza (le chiamate dirette `auth.api.*` non passano dal
 * limitatore di Better Auth). Il conteggio sta nella tabella `rate_limit` (chiave propria, nessuna tabella nuova) e si incrementa
 * PRIMA di verificare la password con un solo UPSERT atomico: richieste parallele non aggirano il tetto. La finestra e' fissa
 * (parte dal primo tentativo); con una password giusta si azzera con `clearPasswordAttempts`.
 */
export async function takePasswordAttempt(db: Db, userId: string, nowMs: number = Date.now()): Promise<{ allowed: boolean }> {
  const key = passwordAttemptsKey(userId);
  const [row] = await db
    .insert(rateLimit)
    .values({ id: key, key, count: 1, lastRequest: nowMs })
    .onConflictDoUpdate({
      target: rateLimit.key,
      set: {
        count: sql`case when ${rateLimit.lastRequest} < ${nowMs - PASSWORD_ATTEMPTS_WINDOW_MS} then 1 else ${rateLimit.count} + 1 end`,
        lastRequest: sql`case when ${rateLimit.lastRequest} < ${nowMs - PASSWORD_ATTEMPTS_WINDOW_MS} then ${nowMs} else ${rateLimit.lastRequest} end`,
      },
    })
    .returning({ count: rateLimit.count });
  return { allowed: (row?.count ?? 1) <= PASSWORD_ATTEMPTS_MAX };
}

/** Azzera il contatore dopo una password corretta. */
export async function clearPasswordAttempts(db: Db, userId: string): Promise<void> {
  await db.delete(rateLimit).where(eq(rateLimit.key, passwordAttemptsKey(userId)));
}
