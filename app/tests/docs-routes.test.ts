import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * La documentazione delle route HTTP non deve restare indietro: ogni `route.ts` sotto `src/app/api` deve comparire in
 * `docs/API.md` (alla radice del repository, fuori da `app/`), sia con il percorso del file sia con l'indirizzo.
 */

const APP = join(__dirname, "..");
const API_DIR = join(APP, "src", "app", "api");
const DOC = join(APP, "..", "docs", "API.md");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const routes = walk(API_DIR)
  .filter((f) => /[\\/]route\.ts$/.test(f))
  .map((f) => {
    const file = relative(APP, f).replace(/\\/g, "/");
    const url = `/${relative(join(APP, "src", "app"), f).replace(/\\/g, "/").replace(/\/route\.ts$/, "")}`;
    return { file, url };
  });

const doc = readFileSync(DOC, "utf8");

describe("documentazione delle route (docs/API.md)", () => {
  it("trova le route", () => {
    expect(routes.length).toBeGreaterThan(8);
  });

  it("ogni route.ts compare in docs/API.md con il percorso del file", () => {
    const missing = routes.filter((r) => !doc.includes(r.file)).map((r) => r.file);
    expect(missing, "Documenta la route in docs/API.md (percorso, metodo, autenticazione, parametri, risposta, codici)").toEqual([]);
  });

  it("ogni route compare in docs/API.md anche con il suo indirizzo", () => {
    const missing = routes.filter((r) => !doc.includes(r.url)).map((r) => r.url);
    expect(missing).toEqual([]);
  });

  it("docs/API.md non descrive route che non esistono piu'", () => {
    const documented = [...doc.matchAll(/`(src\/app\/api\/[^`]+\/route\.ts)`/g)].map((m) => m[1]!);
    const known = new Set(routes.map((r) => r.file));
    expect(documented.filter((file) => !known.has(file))).toEqual([]);
  });
});
