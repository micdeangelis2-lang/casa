import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import messages from "../messages/it.json";

/**
 * Ogni chiave di messaggio scritta nel codice (t("chiave") o t(`prefisso.${...}`)) deve esistere in messages/it.json:
 * un messaggio mancante non si vede in TypeScript ma rompe la pagina a runtime. Il controllo e' statico e prudente:
 * segue le variabili assegnate con getTranslations("ambito") / useTranslations("ambito") dentro lo stesso file.
 */

const ROOT = join(__dirname, "..", "src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

function lookup(path: string): unknown {
  return path.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), messages);
}

type Problem = { file: string; key: string };

function checkSource(source: string, name: string): Problem[] {
  const bindings = [...source.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:getTranslations|useTranslations)\(\s*"([^"]+)"\s*\)/g)].map((m) => ({ name: m[1]!, namespace: m[2]!, at: m.index! }));
  const problems: Problem[] = [];
  for (const [i, binding] of bindings.entries()) {
    // L'ambito vale fino alla prossima assegnazione della stessa variabile nello stesso file.
    const end = bindings.slice(i + 1).find((b) => b.name === binding.name)?.at ?? source.length;
    const scope = source.slice(binding.at, end);
    const call = new RegExp(`(?<![\\w.])${binding.name}\\(\\s*(?:"([^"]+)"|\`([^\`]*)\`)`, "g");
    for (const match of scope.matchAll(call)) {
      if (match[1] !== undefined) {
        const key = `${binding.namespace}.${match[1]}`;
        if (typeof lookup(key) !== "string") problems.push({ file: name, key });
      } else if (match[2] !== undefined) {
        const [prefix] = match[2].split("${");
        if (match[2].includes("${")) {
          // Chiave dinamica: il prefisso deve essere un gruppo esistente (es. `status.` -> messages.x.status).
          const group = prefix!.replace(/\.$/, "");
          const node = group === "" ? lookup(binding.namespace) : lookup(`${binding.namespace}.${group}`);
          if (!node || typeof node !== "object") problems.push({ file: name, key: `${binding.namespace}.${prefix}\${…}` });
        } else if (typeof lookup(`${binding.namespace}.${match[2]}`) !== "string") {
          problems.push({ file: name, key: `${binding.namespace}.${match[2]}` });
        }
      }
    }
  }
  return problems;
}

const check = (file: string) => checkSource(readFileSync(file, "utf8"), relative(ROOT, file));

describe("messaggi dell'interfaccia", () => {
  it("il controllo trova le chiavi mancanti (statiche e dinamiche) e accetta quelle giuste", () => {
    const source = [
      'const t = await getTranslations("maintenance");',
      't("title"); t("non.esiste"); t(`status.${x}`); t(`stati.${x}`);',
      'const t = useTranslations("taxes.detail");',
      't("edit"); t("niente");',
    ].join(" ");
    expect(checkSource(source, "prova.tsx").map((p) => p.key)).toEqual(["maintenance.non.esiste", "maintenance.stati.${…}", "taxes.detail.niente"]);
  });

  it("ogni chiave usata nel codice esiste in messages/it.json", () => {
    const problems = files(ROOT).flatMap(check);
    expect(problems.map((p) => `${p.file}: ${p.key}`)).toEqual([]);
  });

  it("il controllo vede davvero qualcosa (non e' vuoto)", () => {
    const withBindings = files(ROOT).filter((f) => /(?:getTranslations|useTranslations)\(\s*"/.test(readFileSync(f, "utf8")));
    expect(withBindings.length).toBeGreaterThan(40);
  });
});
