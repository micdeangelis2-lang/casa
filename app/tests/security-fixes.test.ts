import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { rateLimit } from "@/platform/db/schema";
import { PASSWORD_ATTEMPTS_MAX, PASSWORD_ATTEMPTS_WINDOW_MS, clearPasswordAttempts, takePasswordAttempt } from "@/platform/auth/account-security";
import { isCrossSiteFetch } from "@/platform/auth/request-guard";
import { ruleVersionInputSchema } from "@/modules/rules/domain/rule";
import { createTestDb, type TestDb } from "./helpers/test-db";

/** Correzioni della revisione di sicurezza (docs/SECURITY_REVIEW.md): F-01, F-03, F-05, F-07, F-08. */

const SRC = join(__dirname, "..", "src");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

describe("F-05: Sec-Fetch-Site", () => {
  it("ammette same-origin, none e l'assenza dell'intestazione; rifiuta il resto", () => {
    expect(isCrossSiteFetch(null)).toBe(false);
    expect(isCrossSiteFetch(undefined)).toBe(false);
    expect(isCrossSiteFetch("")).toBe(false);
    expect(isCrossSiteFetch("same-origin")).toBe(false);
    expect(isCrossSiteFetch("none")).toBe(false);
    expect(isCrossSiteFetch("cross-site")).toBe(true);
    expect(isCrossSiteFetch("same-site")).toBe(true);
    expect(isCrossSiteFetch("qualcosa-di-nuovo")).toBe(true);
  });

  it("ogni route /api che produce dati (tutte tranne territori, auth, cron, health) chiama rejectCrossSite()", () => {
    const routes = walk(join(SRC, "app", "api")).filter((f) => /route\.ts$/.test(f));
    const missing = routes
      .filter((f) => /getOwnerForApi\(\)/.test(readFileSync(f, "utf8")) && !/territori/.test(f))
      .filter((f) => !/rejectCrossSite\(\)/.test(readFileSync(f, "utf8")))
      .map((f) => f.replace(SRC, ""));
    expect(missing).toEqual([]);
  });
});

describe("F-01, F-03, F-08: configurazione di Better Auth", () => {
  const auth = readFileSync(join(SRC, "platform", "auth", "auth.ts"), "utf8");

  it("il server impone la verifica dell'utente (UV) della passkey in accesso e in registrazione", () => {
    expect(auth).toMatch(/registration:\s*\{\s*afterVerification[\s\S]*registrationInfo\?\.userVerified !== true/);
    expect(auth).toMatch(/authentication:\s*\{\s*afterVerification[\s\S]*authenticationInfo\?\.userVerified !== true/);
  });

  it("change-password e generate-backup-codes sono chiuse alle richieste HTTP dirette (non alle azioni del server)", () => {
    expect(auth).toContain('"/change-password"');
    expect(auth).toContain('"/two-factor/generate-backup-codes"');
    expect(auth).toMatch(/ctx\.request && PASSWORD_GATED_PATHS\.has\(ctx\.path\)/);
  });

  it("la regola di frequenza dell'accesso con passkey usa il percorso reale del plugin", () => {
    expect(auth).not.toContain('"/sign-in/passkey"');
    expect(auth).toContain('"/passkey/verify-authentication"');
    const plugin = readFileSync(join(__dirname, "..", "node_modules", "@better-auth", "passkey", "dist", "index.mjs"), "utf8");
    expect(plugin).toContain('createAuthEndpoint("/passkey/verify-authentication"');
  });
});

describe("F-03: tetto ai tentativi di password nelle azioni di sicurezza", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  it("consente 5 tentativi per finestra, poi blocca; la finestra scaduta riparte; il successo azzera", async () => {
    const t0 = 1_800_000_000_000;
    for (let i = 0; i < PASSWORD_ATTEMPTS_MAX; i++) expect((await takePasswordAttempt(t.db, "u1", t0 + i)).allowed).toBe(true);
    expect((await takePasswordAttempt(t.db, "u1", t0 + 10)).allowed).toBe(false);
    expect((await takePasswordAttempt(t.db, "u1", t0 + PASSWORD_ATTEMPTS_WINDOW_MS - 1)).allowed).toBe(false);
    // Un altro utente non e' toccato.
    expect((await takePasswordAttempt(t.db, "u2", t0)).allowed).toBe(true);
    // Finestra scaduta: riparte da 1.
    expect((await takePasswordAttempt(t.db, "u1", t0 + PASSWORD_ATTEMPTS_WINDOW_MS + 1)).allowed).toBe(true);
    // Password giusta: contatore azzerato.
    for (let i = 0; i < 3; i++) await takePasswordAttempt(t.db, "u1", t0 + PASSWORD_ATTEMPTS_WINDOW_MS + 2);
    await clearPasswordAttempts(t.db, "u1");
    for (let i = 0; i < PASSWORD_ATTEMPTS_MAX; i++) expect((await takePasswordAttempt(t.db, "u1", t0 + PASSWORD_ATTEMPTS_WINDOW_MS + 3)).allowed).toBe(true);
    expect((await takePasswordAttempt(t.db, "u1", t0 + PASSWORD_ATTEMPTS_WINDOW_MS + 4)).allowed).toBe(false);
  });

  it("richieste parallele non superano il tetto", async () => {
    await t.db.delete(rateLimit);
    const results = await Promise.all(Array.from({ length: 12 }, () => takePasswordAttempt(t.db, "u9", 1_900_000_000_000)));
    expect(results.filter((r) => r.allowed)).toHaveLength(PASSWORD_ATTEMPTS_MAX);
  });
});

describe("F-07: l'indirizzo della fonte ammette solo http e https", () => {
  const base = {
    title: "Regola",
    level: "national",
    sourceText: "Testo",
    outcomes: [{ type: "checklist", key: "voce", title: "Documento atteso", dossierCategory: "cadastre" }],
  };
  const urlError = (sourceUrl: string) => {
    const r = ruleVersionInputSchema.safeParse({ ...base, sourceUrl });
    return r.success ? false : r.error.issues.some((i) => i.path.join(".") === "sourceUrl");
  };
  it("rifiuta javascript: e data:, accetta https:", () => {
    expect(urlError("javascript:alert(1)")).toBe(true);
    expect(urlError("data:text/html,<script>alert(1)</script>")).toBe(true);
    expect(urlError("https://www.example.it/norma")).toBe(false);
    expect(ruleVersionInputSchema.safeParse({ ...base, sourceUrl: "https://www.example.it/norma" }).success).toBe(true);
  });
});
