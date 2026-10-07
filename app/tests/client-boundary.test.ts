import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

/**
 * Confine tra server e client (privacy e sicurezza): il codice che gira nel browser — i file con "use client" e tutto cio' che
 * importano — non deve importare gli indici dei moduli (che portano con se' database e logica del server), il codice della
 * piattaforma ne' leggere variabili d'ambiente. Il vocabolario condiviso con il client passa dai file `client.ts` dei moduli.
 */

const SRC = join(__dirname, "..", "src");
const posix = (path: string) => path.split(sep).join("/");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const IMPORT = /^(?:import|export) (type )?[^;]*?from "([^"]+)";/gms;
const EXTENSIONS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

function resolveImport(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/") ? join(SRC, specifier.slice(2)) : specifier.startsWith(".") ? resolve(dirname(from), specifier) : null;
  if (!base) return null;
  for (const extension of EXTENSIONS) {
    const candidate = base + extension;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

describe("confine tra server e client", () => {
  const roots = walk(SRC).filter((f) => readFileSync(f, "utf8").trimStart().startsWith('"use client"'));

  /** Tutto cio' che il browser riceve a partire dai componenti client (senza entrare nei moduli e nella piattaforma). */
  function reachable(): Map<string, string> {
    const seen = new Map<string, string>(); // file -> radice client da cui si arriva
    const visit = (file: string, root: string) => {
      if (seen.has(file)) return;
      const source = readFileSync(file, "utf8");
      // Le azioni del server ("use server") nel browser diventano chiamate di rete: il loro codice non viaggia verso il client.
      if (source.trimStart().startsWith('"use server"')) return;
      seen.set(file, root);
      for (const m of source.matchAll(IMPORT)) {
        if (m[1]) continue; // import di soli tipi
        const target = resolveImport(file, m[2]!);
        if (target && !/\/(modules|platform)\//.test(posix(target))) visit(target, root);
      }
    };
    for (const root of roots) visit(root, root);
    return seen;
  }

  it("il controllo vede i componenti client e cio' che importano", () => {
    expect(roots.length).toBeGreaterThan(30);
    expect(reachable().size).toBeGreaterThan(roots.length);
  });

  it("il codice del browser non importa indici di moduli, piattaforma, ne' legge variabili d'ambiente", () => {
    const problems: string[] = [];
    for (const [file, root] of reachable()) {
      const source = readFileSync(file, "utf8");
      const name = `${posix(relative(SRC, file))} (da ${posix(relative(SRC, root))})`;
      for (const m of source.matchAll(IMPORT)) {
        if (m[1]) continue;
        const target = m[2]!;
        if (/^@\/(?:modules|platform)\//.test(target) && !/^@\/modules\/[a-z]+\/client$/.test(target)) problems.push(`${name}: importa ${target}`);
      }
      if (/process\.env/.test(source)) problems.push(`${name}: legge process.env`);
    }
    expect(problems).toEqual([]);
  });
});
