import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { count, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import * as schema from "../db/schema";
import { getAuth } from "./auth";

export type OwnerContext = {
  userId: string;
  name: string;
  email: string;
  sessionId: string;
};

export type OwnerSetup = {
  twoFactorEnabled: boolean;
  passkeyCount: number;
  /** Il proprietario puo' usare l'app solo con TOTP attivo e almeno una passkey registrata. */
  complete: boolean;
};

export async function getOwnerSetup(userId: string): Promise<OwnerSetup> {
  const db = getDb();
  const [user] = await db
    .select({ twoFactorEnabled: schema.user.twoFactorEnabled })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  const [passkeys] = await db
    .select({ n: count() })
    .from(schema.passkey)
    .where(eq(schema.passkey.userId, userId));
  const twoFactorEnabled = user?.twoFactorEnabled === true;
  const passkeyCount = passkeys?.n ?? 0;
  return { twoFactorEnabled, passkeyCount, complete: twoFactorEnabled && passkeyCount >= 1 };
}

async function readSession(): Promise<OwnerContext | null> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;
  return {
    userId: session.user.id,
    name: session.user.name,
    email: session.user.email,
    sessionId: session.session.id,
  };
}

export async function getOwnerSession(): Promise<OwnerContext | null> {
  return readSession();
}

/**
 * Verifica la sessione sul server. Va chiamata in OGNI pagina, Server Action e route handler
 * che tocca dati: il controllo nel proxy e nei layout e' solo ottimistico (i layout non vengono
 * rieseguiti a ogni navigazione).
 *
 * Con `allowIncompleteSetup` lascia passare anche chi non ha ancora attivato TOTP e passkey
 * (serve solo alla pagina di configurazione della sicurezza).
 */
export async function requireOwner(options: { allowIncompleteSetup?: boolean } = {}): Promise<OwnerContext> {
  const owner = await readSession();
  if (!owner) redirect("/accesso");
  if (!options.allowIncompleteSetup) {
    const setup = await getOwnerSetup(owner.userId);
    if (!setup.complete) redirect("/sicurezza/configurazione");
  }
  return owner;
}

/**
 * Come requireOwner, ma per le route handler: invece di reindirizzare restituisce null
 * (da trasformare in 401) quando manca la sessione o la configurazione di sicurezza e' incompleta.
 */
export async function getOwnerForApi(): Promise<OwnerContext | null> {
  const owner = await readSession();
  if (!owner) return null;
  const setup = await getOwnerSetup(owner.userId);
  return setup.complete ? owner : null;
}
