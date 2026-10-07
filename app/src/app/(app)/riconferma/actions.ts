"use server";

import { headers } from "next/headers";
import { getAuth } from "@/platform/auth/auth";
import { clearPasswordAttempts, takePasswordAttempt } from "@/platform/auth/account-security";
import { requireOwner } from "@/platform/auth/owner";
import { grantReconfirmation, isSessionJustCreated } from "@/platform/auth/recent-auth";
import { safeReturnPath } from "@/platform/auth/reconfirmation";
import { getDb } from "@/platform/db/client";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";

/**
 * Riconferma recente (F-04): due vie, entrambe con esito neutro. Con password e codice la verifica avviene qui, senza creare
 * sessioni; con la passkey il browser fa prima l'accesso (`signIn.passkey`, verifica del plugin) e qui si controlla solo che la
 * sessione sia appena nata. In entrambi i casi si scrive il cookie firmato e legato alla sessione in uso.
 * L'audit registra solo il metodo, mai password o codici.
 */

export type ReconfirmError = "wrongPassword" | "invalidCode" | "tooManyAttempts" | "notRecent" | "generic";
export type ReconfirmResult = { ok: true; target: string } | { ok: false; error: ReconfirmError };

const text = (value: FormDataEntryValue | null): string => (typeof value === "string" ? value : "");

async function audit(userId: string, method: "password_code" | "passkey"): Promise<void> {
  await runInUnitOfWork(getDb(), { type: "owner", id: userId }, async ({ audit: log }) => {
    await log.record({ action: "owner.reconfirm", entityType: "user", entityId: userId, diff: { method } });
  });
}

/** Password attuale + codice dell'app di autenticazione (o di recupero). I tentativi condividono il tetto della pagina Sicurezza. */
export async function reconfirmWithPasswordAction(formData: FormData): Promise<ReconfirmResult> {
  const owner = await requireOwner();
  const password = text(formData.get("password"));
  const code = text(formData.get("code")).trim();
  const useBackupCode = formData.get("useBackupCode") === "on";
  const target = safeReturnPath(text(formData.get("ritorno"))) ?? "/";
  if (!password) return { ok: false, error: "wrongPassword" };
  if (!code) return { ok: false, error: "invalidCode" };

  const db = getDb();
  if (!(await takePasswordAttempt(db, owner.userId)).allowed) return { ok: false, error: "tooManyAttempts" };

  try {
    const auth = getAuth();
    const context = await auth.$context;
    const account = await context.internalAdapter.findCredentialAccount(owner.userId);
    const passwordOk = account?.password ? await context.password.verify({ hash: account.password, password }) : false;
    if (!passwordOk) return { ok: false, error: "wrongPassword" };
    try {
      if (useBackupCode) await auth.api.verifyBackupCode({ headers: await headers(), body: { code, disableSession: true } });
      else await auth.api.verifyTOTP({ headers: await headers(), body: { code } });
    } catch {
      return { ok: false, error: "invalidCode" };
    }
  } catch {
    return { ok: false, error: "generic" };
  }

  await clearPasswordAttempts(db, owner.userId);
  await grantReconfirmation(owner);
  await audit(owner.userId, "password_code");
  return { ok: true, target };
}

/** Da chiamare subito dopo `authClient.signIn.passkey()` riuscito: il cookie si lega alla sessione nata da quell'accesso. */
export async function reconfirmAfterPasskeyAction(ritorno: string): Promise<ReconfirmResult> {
  const owner = await requireOwner();
  if (!(await isSessionJustCreated())) return { ok: false, error: "notRecent" };
  await grantReconfirmation(owner);
  await audit(owner.userId, "passkey");
  return { ok: true, target: safeReturnPath(ritorno) ?? "/" };
}
