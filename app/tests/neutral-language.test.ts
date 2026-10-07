import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import messages from "../messages/it.json";
import { conclusiveClaims } from "./helpers/neutral";

/**
 * Linguaggio neutro (sezione 12): nessun testo dell'interfaccia deve suonare come un verdetto. Qui si controllano tutti i
 * messaggi e tutte le stringhe del codice che l'utente puo' leggere; il controllo sulle schermate vere e' in e2e.
 */

const ROOT = join(__dirname, "..", "src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

function leaves(node: unknown, path = ""): { path: string; text: string }[] {
  if (typeof node === "string") return [{ path, text: node }];
  if (Array.isArray(node)) return node.flatMap((v, i) => leaves(v, `${path}.${i}`));
  if (node && typeof node === "object") return Object.entries(node).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  return [];
}

describe("linguaggio neutro", () => {
  it("il controllo riconosce un verdetto e lascia passare le avvertenze", () => {
    expect(conclusiveClaims("L'immobile è conforme.")).toHaveLength(1);
    expect(conclusiveClaims("La delibera è valida.")).toHaveLength(1);
    expect(conclusiveClaims("Sei in regola con tutto.")).toHaveLength(1);
    expect(conclusiveClaims("Puoi avviare l'attività.")).toHaveLength(1);
    expect(conclusiveClaims("Questo tributo non è dovuto.")).toHaveLength(1);
    expect(conclusiveClaims("Non sei tenuto a presentare nulla.")).toHaveLength(1);
    expect(conclusiveClaims("L'app non dice se l'attività è in regola né se si possa avviare.")).toEqual([]);
    expect(conclusiveClaims("Non stabilisce se una delibera è valida.")).toEqual([]);
    expect(conclusiveClaims("Validità scaduta. Valido fino al 31/12/2026. Regola non verificata.")).toEqual([]);
  });

  it("nessun messaggio dell'interfaccia suona come un verdetto (le liste di cio' che l'app non dichiara sono escluse)", () => {
    const found = leaves(messages)
      .filter((l) => !l.path.startsWith("limits.never.items"))
      .flatMap((l) => conclusiveClaims(l.text).map((s) => `${l.path}: ${s}`));
    expect(found).toEqual([]);
  });

  it("nessuna stringa del codice che l'utente puo' leggere suona come un verdetto", () => {
    const found: string[] = [];
    let scanned = 0;
    for (const file of files(ROOT)) {
      const source = readFileSync(file, "utf8");
      for (const m of source.matchAll(/"((?:[^"\\\n]|\\.){14,})"|`((?:[^`\\$]|\\.){14,})`/g)) {
        const text = (m[1] ?? m[2] ?? "").replace(/\\'/g, "'");
        if (!/\s/.test(text)) continue;
        scanned += 1;
        for (const claim of conclusiveClaims(text)) found.push(`${relative(ROOT, file)}: ${claim}`);
      }
    }
    expect(found).toEqual([]);
    expect(scanned, "il controllo deve vedere le stringhe del codice").toBeGreaterThan(500);
  });
});
