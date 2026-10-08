import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * dependency-cruiser vede gli import di codice, non le LETTURE DIRETTE delle tabelle di un altro modulo (un `select` su
 * `rule` fatto dal modulo `offices` passa dal file comune `platform/db/schema`). Questo test rende quelle dipendenze sui
 * dati esplicite: elenca, per ogni modulo, i file di schema che usa. Chi aggiunge un nuovo accoppiamento deve scriverlo
 * qui con il motivo; chi ne toglie uno deve toglierlo (le voci superate fanno fallire il test, cosi' l'elenco resta vero).
 *
 * Vale solo per le LETTURE incrociate: nessuna tabella e' scritta da piu' di un modulo (lo verifica l'ultimo test).
 */

const SCHEMA_DIR = join(__dirname, "..", "src", "platform", "db", "schema");
const MODULES_DIR = join(__dirname, "..", "src", "modules");

/**
 * Modulo -> file di schema che usa. Le voci con "propria" sono tabelle del modulo stesso (il file di schema non porta il
 * nome del modulo); le altre sono dipendenze sui dati di un altro modulo, tutte in sola lettura.
 */
const ALLOWED: Record<string, Record<string, string>> = {
  agent: { listings: "propria: mandati e inserzioni di vendita/affitto" },
  assets: { registry: "propria: immobili, diritti, catasto" },
  backup: { audit: "legge il registro delle operazioni per l'esportazione", backup: "propria" },
  condominium: { condominium: "propria" },
  deadlines: {
    auth: "legge l'utente per gli avvisi via email",
    deadlines: "propria",
    matters: "legge le pratiche collegate a una scadenza",
    registry: "legge immobili e territori per l'elenco e i collegamenti",
    rules: "legge le regole da cui nascono scadenze",
  },
  directory: {
    competence: "legge le competenze dei contatti",
    documents: "legge i titoli dei documenti collegati a un contatto",
    registry: "propria: rubrica",
  },
  documents: { documents: "propria", rules: "legge le voci del dossier che richiedono un documento" },
  dossier: {
    documents: "legge le categorie documentali",
    lettings: "legge le locazioni per il dossier dell'immobile",
    registry: "legge immobili e territori",
    rules: "legge categorie e voci del dossier",
  },
  engagements: { engagements: "propria" },
  insurance: { insurance: "propria" },
  lettings: { lettings: "propria" },
  maintenance: { maintenance: "propria" },
  management: { lettings: "propria: mandati di gestione" },
  matters: { matters: "propria" },
  notary: { notary: "propria" },
  offices: {
    audit: "legge il registro delle operazioni per le verifiche delle regole",
    offices: "propria",
    rules: "legge le regole dei dossier",
  },
  rules: {
    documents: "legge categorie e documenti per controllare i requisiti",
    registry: "legge i territori per l'ambito delle regole",
    rules: "propria",
  },
  sharing: { matters: "propria: pacchetti di condivisione (nello stesso file delle pratiche)" },
  taxes: { taxes: "propria" },
  territory: { registry: "propria: territori" },
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** nome esportato della tabella -> nome del file di schema che la definisce */
function tableOwners(): Map<string, string> {
  const owners = new Map<string, string>();
  for (const file of readdirSync(SCHEMA_DIR)) {
    if (file === "index.ts") continue;
    const text = readFileSync(join(SCHEMA_DIR, file), "utf8");
    for (const match of text.matchAll(/export const (\w+) = pgTable\(/g)) owners.set(match[1]!, file.replace(/\.ts$/, ""));
  }
  return owners;
}

function observedSchemaUse(): Record<string, string[]> {
  const owners = tableOwners();
  const seen: Record<string, Set<string>> = {};
  for (const moduleName of readdirSync(MODULES_DIR)) {
    for (const file of walk(join(MODULES_DIR, moduleName))) {
      const text = readFileSync(file, "utf8");
      if (!text.includes("platform/db/schema")) continue;
      for (const [table, schemaFile] of owners) {
        if (new RegExp(`\\b${table}\\b`).test(text)) (seen[moduleName] ??= new Set()).add(schemaFile);
      }
    }
  }
  return Object.fromEntries(Object.entries(seen).map(([name, files]) => [name, [...files].sort()]));
}

describe("dipendenze sui dati tra moduli", () => {
  const observed = observedSchemaUse();

  it("ogni modulo usa solo i file di schema dichiarati (nessun nuovo accoppiamento silenzioso)", () => {
    const undeclared = Object.entries(observed).flatMap(([name, files]) =>
      files.filter((file) => !(file in (ALLOWED[name] ?? {}))).map((file) => `${name} -> ${file}`),
    );
    expect(undeclared, "Nuova lettura di tabelle di un altro modulo: dichiarala in ALLOWED con il motivo, o passa da una porta").toEqual([]);
  });

  it("l'elenco dichiarato non contiene voci superate", () => {
    const stale = Object.entries(ALLOWED).flatMap(([name, files]) =>
      Object.keys(files).filter((file) => !(observed[name] ?? []).includes(file)).map((file) => `${name} -> ${file}`),
    );
    expect(stale).toEqual([]);
  });

  it("nessuna tabella e' scritta da piu' di un modulo", () => {
    const owners = tableOwners();
    const writers = new Map<string, Set<string>>();
    for (const moduleName of readdirSync(MODULES_DIR)) {
      for (const file of walk(join(MODULES_DIR, moduleName))) {
        const text = readFileSync(file, "utf8");
        for (const match of text.matchAll(/\.(?:insert|update|delete)\(\s*(\w+)\s*\)/g)) {
          const table = match[1]!;
          if (owners.has(table)) writers.set(table, (writers.get(table) ?? new Set()).add(moduleName));
        }
      }
    }
    const shared = [...writers].filter(([, modules]) => modules.size > 1).map(([table, modules]) => `${table}: ${[...modules].join(", ")}`);
    expect(shared).toEqual([]);
  });
});
