import "server-only";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { sql } from "drizzle-orm";
import { runInUnitOfWork } from "../db/unit-of-work";
import { getDb } from "../db/client";
import * as schema from "../db/schema";
import { getAuthEnv } from "../config/env";

const APP_NAME = "Gestione Immobili";

/** Rotte di Better Auth che verificano la password e non devono essere raggiungibili in HTTP diretto (vedi `hooks.before`). */
const PASSWORD_GATED_PATHS = new Set([
  "/change-password",
  "/two-factor/generate-backup-codes",
  // Bastano sessione e password: restituirebbero il segreto TOTP o spegnerebbero il secondo fattore senza riconferma. L'app non le usa.
  "/two-factor/get-totp-uri",
  "/two-factor/disable",
]);

function createAuth() {
  const env = getAuthEnv();
  const db = getDb();
  const origin = new URL(env.BETTER_AUTH_URL);

  return betterAuth({
    appName: APP_NAME,
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.BETTER_AUTH_URL],
    database: drizzleAdapter(db, { provider: "pg", schema }),

    // Registrazione pubblica spenta: l'unico account si crea con il token di avvio
    // (src/platform/auth/bootstrap.ts). La password serve solo come via di riserva con TOTP.
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },

    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      // Esportazioni, cancellazioni e condivisioni richiederanno una sessione "fresca".
      freshAge: 60 * 10,
      // Nessuna cache nel cookie: una sessione revocata smette di valere subito.
      cookieCache: { enabled: false },
    },

    // L'archivio in memoria non vale nulla in serverless: i contatori stanno nel database.
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        // Percorso reale del plugin passkey per l'accesso (la vecchia regola sign-in/passkey non corrispondeva a nulla).
        "/passkey/verify-authentication": { window: 60, max: 10 },
        "/two-factor/*": { window: 60, max: 5 },
      },
    },

    advanced: {
      // Cookie "Secure" quando l'app e' servita in HTTPS (produzione). In locale su http://localhost no.
      useSecureCookies: origin.protocol === "https:",
      // Su Vercel `x-real-ip` e' impostato dalla piattaforma e non e' falsificabile dal client.
      ipAddress: { ipAddressHeaders: ["x-real-ip"] },
    },

    hooks: {
      // Rinomina e rimozione delle passkey passano SOLO dalle azioni della pagina «Sicurezza dell'account»
      // (src/app/(app)/impostazioni/sicurezza), che applicano l'invariante E6 (mai l'ultima passkey) e scrivono l'audit
      // nella stessa transazione. Le rotte equivalenti di Better Auth restano chiuse: dall'esterno non si aggira la regola.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/passkey/delete-passkey" || ctx.path === "/passkey/update-passkey") {
          throw new APIError("FORBIDDEN", { message: "Operazione non consentita da questa rotta" });
        }
        // Cambio password e codici di recupero: dall'esterno (richiesta HTTP) restano chiusi; le azioni della pagina «Sicurezza
        // dell'account» li chiamano come funzioni (`auth.api.*` senza `request`), con limite ai tentativi di password e audit.
        if (ctx.request && PASSWORD_GATED_PATHS.has(ctx.path)) {
          throw new APIError("FORBIDDEN", { message: "Operazione non consentita da questa rotta" });
        }
      }),
      // Audit della nuova passkey garantito lato server, anche per la prima configurazione. (Il plugin scrive con l'adattatore
      // "grezzo": i `databaseHooks` non scattano.) Solo l'identificativo: il nome scelto dall'utente non si registra.
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/passkey/verify-registration") return;
        const returned = ctx.context.returned as { id?: unknown; userId?: unknown } | undefined;
        if (typeof returned?.id !== "string" || typeof returned.userId !== "string") return;
        const { id, userId } = returned;
        await runInUnitOfWork(db, { type: "owner", id: userId }, async ({ audit }) => {
          await audit.record({ action: "owner.passkey.add", entityType: "passkey", entityId: id });
        });
      }),
    },

    databaseHooks: {
      user: {
        create: {
          // Seconda barriera dopo l'indice univoco `user_single_owner`: un solo proprietario.
          before: async () => {
            const existing = await db.execute(sql`select 1 from "user" limit 1`);
            const rows = (existing as unknown as { rows: unknown[] }).rows;
            if (rows.length > 0) {
              throw new APIError("FORBIDDEN", { message: "Esiste già un proprietario" });
            }
          },
        },
      },
      session: {
        create: {
          after: async (session) => {
            await runInUnitOfWork(db, { type: "owner", id: session.userId }, async ({ audit }) => {
              await audit.record({
                action: "auth.sign_in",
                entityType: "session",
                entityId: session.id,
                diff: { ipAddress: session.ipAddress ?? null, userAgent: session.userAgent ?? null },
              });
            });
          },
        },
      },
    },

    plugins: [
      passkey({
        rpID: origin.hostname,
        rpName: APP_NAME,
        origin: origin.origin,
        // Credenziali "discoverable" e verifica dell'utente (biometria o PIN) obbligatorie:
        // la passkey da sola vale come due fattori.
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        // Il plugin installato usa `userVerification: "preferred"` in accesso e `requireUserVerification: false` nelle verifiche:
        // la verifica dell'utente (biometria/PIN) la impone qui il server, leggendo il flag UV dell'asserzione gia' verificata.
        registration: {
          afterVerification: ({ verification }) => {
            if (verification.registrationInfo?.userVerified !== true) {
              throw new APIError("UNAUTHORIZED", { message: "Verifica dell'utente (biometria o PIN) richiesta" });
            }
          },
        },
        authentication: {
          afterVerification: ({ verification }) => {
            if (verification.authenticationInfo?.userVerified !== true) {
              throw new APIError("UNAUTHORIZED", { message: "Verifica dell'utente (biometria o PIN) richiesta" });
            }
          },
        },
      }),
      twoFactor({
        issuer: APP_NAME,
        backupCodeOptions: { amount: 10, length: 10, storeBackupCodes: "encrypted" },
        // Blocco dell'account dopo troppi secondi fattori errati (valori di default, resi espliciti).
        accountLockout: { enabled: true, maxFailedAttempts: 10, durationSeconds: 15 * 60 },
      }),
      // Deve essere l'ultimo plugin: imposta i cookie anche dalle Server Actions.
      nextCookies(),
    ],
  });
}

type AuthInstance = ReturnType<typeof createAuth>;
// Singleton su globalThis (vedi db/client.ts): una sola istanza condivisa tra tutti i livelli di Next.js.
const globalForAuth = globalThis as typeof globalThis & { __gestioneImmobiliAuth?: AuthInstance };

/** Istanza lazy: `next build` non deve richiedere l'ambiente completo. */
export function getAuth(): AuthInstance {
  return (globalForAuth.__gestioneImmobiliAuth ??= createAuth());
}
