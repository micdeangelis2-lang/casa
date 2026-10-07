import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Revisione degli accessi (incremento 12): app a utente unico, quindi OGNI pagina, route e azione del server deve verificare la
 * sessione del proprietario per conto proprio (il layout e il proxy sono solo controlli ottimistici). Questo controllo statico
 * cammina sui sorgenti e fallisce se una pagina, una route o un'azione nuova se ne dimentica.
 */

const APP = join(__dirname, "..", "src", "app");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
const rel = (file: string) => relative(APP, file).replace(/\\/g, "/");
const all = walk(APP);
const read = (file: string) => readFileSync(file, "utf8");

/** L'unica azione pubblica: la configurazione iniziale (protetta dal token di avvio, valida solo finche' non esiste il proprietario). */
const PUBLIC_ACTIONS = new Set(["(auth)/configurazione-iniziale/actions.ts#bootstrapAction"]);

type Fn = { name: string; body: string; exported: boolean };

/** Le funzioni di un file, anche non esportate (gli helper locali): ognuna con il suo testo. */
function functionsOf(source: string): Fn[] {
  const header = /^(?:export )?(?:async )?function (\w+)/;
  return source
    .split(/\n(?=(?:export )?(?:async )?function )/)
    .filter((part) => header.test(part))
    .map((body) => ({ name: header.exec(body)![1]!, body, exported: body.startsWith("export ") }));
}

/** Nomi delle funzioni che verificano la sessione: direttamente, con ownerAction, oppure chiamando una che lo fa. */
function guarded(functions: Fn[]): Set<string> {
  const safe = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const fn of functions) {
      if (safe.has(fn.name)) continue;
      const direct = /requireOwner\(\)|ownerAction(?:WithValue)?\(/.test(fn.body);
      const delegated = functions.some((other) => other.name !== fn.name && safe.has(other.name) && new RegExp(`\\b${other.name}\\(`).test(fn.body));
      if (direct || delegated) {
        safe.add(fn.name);
        changed = true;
      }
    }
  }
  return safe;
}

describe("controllo degli accessi", () => {
  it("ogni pagina dell'area riservata verifica la sessione del proprietario", () => {
    const pages = all.filter((f) => /[\\/]\(app\)[\\/].*page\.tsx$/.test(f));
    expect(pages.length).toBeGreaterThan(60);
    const missing = pages.filter((f) => !/requireOwner\(\)/.test(read(f))).map(rel);
    expect(missing).toEqual([]);
  });

  it("le uniche pagine pubbliche sono quelle di accesso e di configurazione", () => {
    const publicPages = all
      .filter((f) => /page\.tsx$/.test(f) && !/[\\/]\(app\)[\\/]/.test(f))
      .map(rel)
      .sort();
    expect(publicPages).toEqual(["(auth)/accesso/page.tsx", "(auth)/configurazione-iniziale/page.tsx", "(auth)/sicurezza/configurazione/page.tsx"]);
  });

  it("ogni route API verifica la sessione, oppure il segreto del cron, oppure e' il gestore dell'autenticazione", () => {
    const routes = all.filter((f) => /route\.ts$/.test(f));
    expect(routes.length).toBeGreaterThan(8);
    const problems: string[] = [];
    for (const file of routes) {
      const name = rel(file);
      const source = read(file);
      if (name === "api/auth/[...all]/route.ts") continue; // Better Auth: le sue rotte fanno l'accesso
      if (name === "api/health/route.ts") {
        // Controllo di salute pubblico: ammesso solo se non legge dati dell'archivio (nessun modulo) e non espone l'errore.
        if (/@\/modules\//.test(source)) problems.push(`${name}: la route pubblica di salute non deve leggere dai moduli`);
        if (/error\.message|String\(error\)/.test(source)) problems.push(`${name}: la route pubblica di salute non deve esporre il motivo dell'errore`);
        continue;
      }
      if (name.startsWith("api/cron/")) {
        if (!/CRON_SECRET/.test(source) || !/timingSafeEqual/.test(source)) problems.push(`${name}: manca il controllo del segreto del cron`);
        continue;
      }
      if (!/getOwnerForApi\(\)/.test(source)) problems.push(`${name}: manca getOwnerForApi()`);
    }
    expect(problems).toEqual([]);
  });

  it("ogni azione del server verifica la sessione (direttamente, con ownerAction o passando da una funzione che lo fa)", () => {
    const actionFiles = all.filter((f) => /actions\.ts$/.test(f) && read(f).trimStart().startsWith('"use server"'));
    expect(actionFiles.length).toBeGreaterThan(12);
    const problems: string[] = [];
    for (const file of actionFiles) {
      const source = read(file);
      const functions = functionsOf(source);
      const safe = guarded(functions);
      for (const fn of functions) {
        if (fn.exported && !safe.has(fn.name) && !PUBLIC_ACTIONS.has(`${rel(file)}#${fn.name}`)) problems.push(`${rel(file)}: ${fn.name}`);
      }
      // Next espone come endpoint tutto cio' che un file "use server" esporta: solo funzioni asincrone (e tipi).
      for (const m of source.matchAll(/^export (?!async function|type |interface )(\w+ \w+)/gm)) problems.push(`${rel(file)}: esportazione non asincrona (${m[1]})`);
    }
    expect(problems).toEqual([]);
  });

  it("l'helper delle azioni piccole passa sempre dalla verifica del proprietario", () => {
    const helper = readFileSync(join(__dirname, "..", "src", "lib", "owner-action.ts"), "utf8");
    expect((helper.match(/await requireOwner\(\)/g) ?? []).length).toBe(2);
  });

  it("il controllo si accorge di un'azione dimenticata", () => {
    const source = ['export async function aperta(id: string) {', "  return 1;", "}", "", "async function aiuto() {", "  await requireOwner();", "}", "", "export async function chiusa() {", "  await aiuto();", "}"].join("\n");
    const functions = functionsOf(source);
    const safe = guarded(functions);
    expect(functions.map((f) => [f.name, safe.has(f.name)])).toEqual([["aperta", false], ["aiuto", true], ["chiusa", true]]);
  });
});
