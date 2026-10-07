/**
 * Configurazione SOLO per la CLI di Better Auth (`pnpm auth:schema`).
 * Serve a generare lo schema Drizzle delle tabelle di autenticazione senza collegarsi a un database.
 * Deve elencare gli stessi plugin e le stesse opzioni che cambiano lo schema di src/platform/auth/auth.ts.
 */
import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";

export const auth = betterAuth({
  database: drizzleAdapter({} as never, { provider: "pg" }),
  emailAndPassword: { enabled: true },
  rateLimit: { storage: "database" },
  plugins: [passkey(), twoFactor()],
});
