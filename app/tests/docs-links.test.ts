import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * Ogni link relativo ai file nei documenti markdown (radice del repository, `docs/`, `app/README.md`) deve puntare a un
 * file o a una cartella che esiste. I link esterni (http, mailto) e le sole ancore (#...) non si controllano.
 */

const REPO = join(__dirname, "..", "..");

const markdownIn = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".md"))
    .map((e) => join(dir, e.name));

const documents = [...markdownIn(REPO), ...markdownIn(join(REPO, "docs")), join(REPO, "app", "README.md")];

/** Toglie i blocchi di codice, dove un «link» e' solo un esempio. */
const withoutCode = (text: string): string => text.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");

/** Obiettivi dei link `[testo](obiettivo)`; l'obiettivo puo' essere tra parentesi angolari o avere un titolo. */
function targets(text: string): string[] {
  return [...withoutCode(text).matchAll(/\[[^\]]*\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+"[^"]*")?\s*\)/g)].map((m) => m[1]!.replace(/^<|>$/g, ""));
}

const isLocal = (target: string): boolean => !/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith("#") && !target.startsWith("//");

describe("link dei documenti markdown", () => {
  it("trova i documenti", () => {
    const names = documents.map((d) => relative(REPO, d).replace(/\\/g, "/"));
    expect(names).toContain("docs/API.md");
    expect(names).toContain("app/README.md");
  });

  it("riconosce un link rotto", () => {
    expect(targets("Vedi [a](docs/x.md) e [b](https://example.org) e `[c](finto.md)`.")).toEqual(["docs/x.md", "https://example.org"]);
  });

  it("ogni link relativo punta a un file o a una cartella esistente", () => {
    const broken: string[] = [];
    for (const doc of documents) {
      for (const target of targets(readFileSync(doc, "utf8")).filter(isLocal)) {
        // L'ancora (`file.md#sezione`) e la query non fanno parte del percorso; i caratteri %xx si decodificano.
        const path = decodeURIComponent(target.split("#")[0]!.split("?")[0]!);
        if (path === "") continue;
        if (!existsSync(resolve(dirname(doc), path))) broken.push(`${relative(REPO, doc).replace(/\\/g, "/")}: ${target}`);
      }
    }
    expect(broken).toEqual([]);
  });
});
