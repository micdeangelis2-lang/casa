"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { APIError } from "better-auth/api";
import { getAuth } from "@/platform/auth/auth";
import {
  removePasskey,
  renamePasskey,
  revokeOtherSessions,
  revokeSession,
  clearPasswordAttempts,
  takePasswordAttempt,
  type SecurityError,
} from "@/platform/auth/account-security";
import { requireOwner } from "@/platform/auth/owner";
import { hasRecentReconfirmation } from "@/platform/auth/recent-auth";
import { getDb } from "@/platform/db/client";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";

/**
 * Azioni della pagina «Sicurezza dell'account». Ogni scrittura passa da `runInUnitOfWork` con attore proprietario e scrive
 * una riga di audit con il solo nome dell'azione e identificativi/conteggi: mai password, codici, segreti o nomi scelti.
 * Gli esiti sono codici neutri: il testo lo sceglie l'interfaccia, nessun dettaglio interno esce dal server.
 */

export type SecurityActionError = SecurityError | "wrongPassword" | "weakPassword" | "mismatch" | "samePassword" | "tooManyAttempts" | "reconfirmRequired" | "generic";
export type SecurityActionResult = { ok: true; revoked?: number } | { ok: false; error: SecurityActionError };
export type RecoveryCodesResult = { ok: true; codes: string[] } | { ok: false; error: SecurityActionError };

const PATH = "/impostazioni/sicurezza";
const MIN_PASSWORD = 12;
const MAX_PASSWORD = 128;

/** Le azioni sensibili (F-04) richiedono una riconferma recente: senza, l'azione non fa nulla e l'interfaccia rimanda alla riconferma. */
const RECONFIRM_REQUIRED = { ok: false, error: "reconfirmRequired" } as const;

const text = (value: FormDataEntryValue | null): string => (typeof value === "string" ? value : "");

function asResult(result: { ok: true; revoked?: number } | { ok: false; error: SecurityError }): SecurityActionResult {
  revalidatePath(PATH);
  return result;
}

export async function renamePasskeyAction(passkeyId: string, name: string): Promise<SecurityActionResult> {
  const owner = await requireOwner();
  const result = await runInUnitOfWork(getDb(), { type: "owner", id: owner.userId }, (uow) => renamePasskey(uow, owner.userId, String(passkeyId), String(name)));
  return asResult(result);
}

export async function removePasskeyAction(passkeyId: string): Promise<SecurityActionResult> {
  const owner = await requireOwner();
  if (!(await hasRecentReconfirmation(owner))) return RECONFIRM_REQUIRED;
  const result = await runInUnitOfWork(getDb(), { type: "owner", id: owner.userId }, (uow) => removePasskey(uow, owner.userId, String(passkeyId)));
  return asResult(result);
}

export async function revokeSessionAction(sessionId: string): Promise<SecurityActionResult> {
  const owner = await requireOwner();
  if (!(await hasRecentReconfirmation(owner))) return RECONFIRM_REQUIRED;
  const result = await runInUnitOfWork(getDb(), { type: "owner", id: owner.userId }, (uow) => revokeSession(uow, owner.userId, owner.sessionId, String(sessionId)));
  return asResult(result);
}

export async function revokeOtherSessionsAction(): Promise<SecurityActionResult> {
  const owner = await requireOwner();
  if (!(await hasRecentReconfirmation(owner))) return RECONFIRM_REQUIRED;
  const result = await runInUnitOfWork(getDb(), { type: "owner", id: owner.userId }, (uow) => revokeOtherSessions(uow, owner.userId, owner.sessionId));
  return asResult(result);
}

/** Una password sbagliata e' un esito atteso e comprensibile; qualunque altro errore resta generico. */
function mapAuthError(error: unknown): SecurityActionError {
  if (error instanceof APIError) {
    const code = (error.body as { code?: string } | undefined)?.code;
    if (code === "INVALID_PASSWORD") return "wrongPassword";
    if (code === "PASSWORD_TOO_SHORT" || code === "PASSWORD_TOO_LONG") return "weakPassword";
  }
  return "generic";
}

/** Rigenera i codici di recupero (serve la password attuale). I nuovi codici tornano al chiamante una sola volta e non si salvano altrove. */
export async function regenerateRecoveryCodesAction(formData: FormData): Promise<RecoveryCodesResult> {
  const owner = await requireOwner();
  if (!(await hasRecentReconfirmation(owner))) return RECONFIRM_REQUIRED;
  const password = text(formData.get("password"));
  if (!password) return { ok: false, error: "wrongPassword" };
  if (!(await takePasswordAttempt(getDb(), owner.userId)).allowed) return { ok: false, error: "tooManyAttempts" };
  let codes: string[];
  try {
    const result = await getAuth().api.generateBackupCodes({ headers: await headers(), body: { password } });
    codes = result.backupCodes;
  } catch (error) {
    return { ok: false, error: mapAuthError(error) };
  }
  await clearPasswordAttempts(getDb(), owner.userId);
  await runInUnitOfWork(getDb(), { type: "owner", id: owner.userId }, async ({ audit }) => {
    await audit.record({
      action: "owner.recovery_codes.regenerate",
      entityType: "user",
      entityId: owner.userId,
      diff: { count: codes.length },
    });
  });
  return { ok: true, codes };
}

export async function changePasswordAction(formData: FormData): Promise<SecurityActionResult> {
  const owner = await requireOwner();
  if (!(await hasRecentReconfirmation(owner))) return RECONFIRM_REQUIRED;
  const currentPassword = text(formData.get("currentPassword"));
  const newPassword = text(formData.get("newPassword"));
  const confirmPassword = text(formData.get("confirmPassword"));
  const revokeOthers = formData.get("revokeOthers") === "on";

  if (!currentPassword) return { ok: false, error: "wrongPassword" };
  if (newPassword.length < MIN_PASSWORD || newPassword.length > MAX_PASSWORD) return { ok: false, error: "weakPassword" };
  if (newPassword !== confirmPassword) return { ok: false, error: "mismatch" };
  if (newPassword === currentPassword) return { ok: false, error: "samePassword" };

  if (!(await takePasswordAttempt(getDb(), owner.userId)).allowed) return { ok: false, error: "tooManyAttempts" };
  try {
    await getAuth().api.changePassword({
      headers: await headers(),
      body: { currentPassword, newPassword, revokeOtherSessions: revokeOthers },
    });
  } catch (error) {
    return { ok: false, error: mapAuthError(error) };
  }
  await clearPasswordAttempts(getDb(), owner.userId);
  await runInUnitOfWork(getDb(), { type: "owner", id: owner.userId }, async ({ audit }) => {
    await audit.record({ action: "owner.password.change", entityType: "user", entityId: owner.userId });
  });
  revalidatePath(PATH);
  return { ok: true };
}
