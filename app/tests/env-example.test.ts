import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

/** I nomi delle variabili d'ambiente (MAIUSCOLO_CON_TRATTINI) usati come chiavi degli schemi in `env.ts`. */
function variablesInEnvTs(): string[] {
  const source = read("src/platform/config/env.ts");
  return [...new Set([...source.matchAll(/^ {2}([A-Z][A-Z0-9_]+):\s/gm)].map((m) => m[1]!))];
}

/** Le variabili elencate in `.env.example`, anche se commentate (`# NOME=`). */
function variablesInExample(): Set<string> {
  return new Set([...read(".env.example").matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]!));
}

describe(".env.example", () => {
  it("l'estrazione trova le variabili note (il controllo non e' vuoto)", () => {
    expect(variablesInEnvTs()).toEqual(expect.arrayContaining(["DATABASE_URL", "BETTER_AUTH_SECRET", "BACKUP_PUBLIC_KEY", "CRON_SECRET", "RESEND_API_KEY"]));
  });

  it("ogni variabile letta in src/platform/config/env.ts compare in .env.example", () => {
    const example = variablesInExample();
    expect(variablesInEnvTs().filter((name) => !example.has(name))).toEqual([]);
  });

  it("STORAGE_DIR (letta da platform/storage) e' documentata", () => {
    expect(variablesInExample().has("STORAGE_DIR")).toBe(true);
  });
});
