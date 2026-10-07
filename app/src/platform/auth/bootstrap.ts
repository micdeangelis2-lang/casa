import "server-only";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { count } from "drizzle-orm";
import { z } from "zod";
import { getAuthEnv } from "../config/env";
import { getDb } from "../db/client";
import * as schema from "../db/schema";
import { runInUnitOfWork } from "../db/unit-of-work";
import { getAuth } from "./auth";

export const bootstrapInputSchema = z
  .object({
    name: z.string().trim().min(1, "Inserisci il nome").max(80),
    email: z.email("Indirizzo email non valido").max(254),
    password: z
      .string()
      .min(12, "La password deve avere almeno 12 caratteri")
      .max(128, "La password può avere al massimo 128 caratteri"),
    token: z.string().min(1, "Inserisci il token di avvio").max(512),
  })
  .superRefine((value, ctx) => {
    const localPart = value.email.split("@")[0]?.toLowerCase() ?? "";
    if (localPart.length >= 4 && value.password.toLowerCase().includes(localPart)) {
      ctx.addIssue({ code: "custom", path: ["password"], message: "La password non deve contenere il tuo indirizzo email" });
    }
    if (/^(.)\1+$/.test(value.password)) {
      ctx.addIssue({ code: "custom", path: ["password"], message: "La password è troppo semplice" });
    }
  });

export type BootstrapInput = z.input<typeof bootstrapInputSchema>;

export type BootstrapResult =
  | { ok: true; email: string }
  | { ok: false; reason: "invalid_input"; fieldErrors: Record<string, string[]> }
  | { ok: false; reason: "bootstrap_disabled" | "invalid_token" | "already_initialized" };

class AlreadyInitializedError extends Error {}

/** Confronto a tempo costante (e indipendente dalla lunghezza) tra il token fornito e quello atteso. */
export function tokensMatch(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function ownerExists(): Promise<boolean> {
  const [row] = await getDb().select({ n: count() }).from(schema.user);
  return (row?.n ?? 0) > 0;
}

/**
 * Crea l'unico account del proprietario. Possibile solo con il token di avvio
 * e solo finche' nel database non esiste nessun utente.
 */
export async function bootstrapOwner(input: BootstrapInput): Promise<BootstrapResult> {
  const parsed = bootstrapInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "invalid_input", fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const { name, email, password, token } = parsed.data;

  const expectedToken = getAuthEnv().OWNER_BOOTSTRAP_TOKEN;
  if (!expectedToken) return { ok: false, reason: "bootstrap_disabled" };
  if (!tokensMatch(token, expectedToken)) return { ok: false, reason: "invalid_token" };

  const normalizedEmail = email.toLowerCase();
  const db = getDb();
  try {
    await runInUnitOfWork(db, { type: "system", id: "bootstrap" }, async ({ tx, audit }) => {
      const [row] = await tx.select({ n: count() }).from(schema.user);
      if ((row?.n ?? 0) > 0) throw new AlreadyInitializedError();

      const authContext = await getAuth().$context;
      const passwordHash = await authContext.password.hash(password);
      const userId = randomUUID();

      await tx.insert(schema.user).values({
        id: userId,
        name,
        email: normalizedEmail,
        emailVerified: false,
        twoFactorEnabled: false,
      });
      // Account "credential" nel formato di Better Auth: accountId coincide con l'id utente.
      await tx.insert(schema.account).values({
        id: randomUUID(),
        accountId: userId,
        providerId: "credential",
        userId,
        password: passwordHash,
      });
      await audit.record({
        action: "owner.bootstrap",
        entityType: "user",
        entityId: userId,
        diff: { email: normalizedEmail },
      });
    });
  } catch (error) {
    // Gara tra due richieste: l'indice univoco `user_single_owner` ne lascia passare una sola.
    if (error instanceof AlreadyInitializedError || isUniqueViolation(error)) {
      return { ok: false, reason: "already_initialized" };
    }
    throw error;
  }
  return { ok: true, email: normalizedEmail };
}

function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    if ((e as { code?: string }).code === "23505") return true;
  }
  return false;
}
