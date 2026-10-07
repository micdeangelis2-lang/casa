import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(__dirname, "..");

/** Nessun territorio puo' comparire nella logica: sono dati (seed e UI di configurazione). */
const FORBIDDEN_TERRITORY_NAMES = [/Piano di Sorrento/i, /\bSorrento\b/i, /\bMeta\b/, /\bCampania\b/i, /\bNapoli\b/i];

const SCANNED_DIRS = ["src", "drizzle", "messages"];
const SCANNED_EXTENSIONS = new Set([".ts", ".tsx", ".sql", ".json", ".css"]);

function walk(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    const ext = name.slice(name.lastIndexOf("."));
    return SCANNED_EXTENSIONS.has(ext) ? [full] : [];
  });
}

describe("architettura: nessun territorio nel codice", () => {
  it("src, migrazioni e messaggi non contengono nomi di Comuni o Regioni", () => {
    const violations: string[] = [];
    for (const dir of SCANNED_DIRS) {
      for (const file of walk(join(root, dir))) {
        const text = readFileSync(file, "utf8");
        for (const pattern of FORBIDDEN_TERRITORY_NAMES) {
          const match = pattern.exec(text);
          if (match) violations.push(`${relative(root, file)}: "${match[0]}"`);
        }
      }
    }
    expect(violations, "I territori vanno in scripts/seed come dati, non nel codice").toEqual([]);
  });
});
