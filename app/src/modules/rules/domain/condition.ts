import { z } from "@/shared/zod";

/**
 * Condizioni delle regole: un albero JSON limitato (all / any / not e confronti), niente codice arbitrario.
 * Ogni confronto guarda un FATTO del bene scelto tra quelli ammessi (vedi `FACT_PATH`).
 */
export const CONDITION_OPS = ["eq", "in", "gte", "lte", "exists", "contains"] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

export type Primitive = string | number | boolean;

/** Fatti ammessi: gli attributi base del bene, i regimi di titolarita' e le caratteristiche tecniche libere. */
export const FACT_PATH = /^(asset\.(kind|useType|inCondominium)|rights\.regimes|letting\.types|attributes\.[a-z][a-z0-9_]{0,39})$/;

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { op: ConditionOp; path: string; value?: Primitive | Primitive[] };

const MAX_DEPTH = 6;
const MAX_NODES = 60;

const primitive = z.union([z.string().max(200), z.number(), z.boolean()]);

const leafSchema = z
  .object({
    op: z.enum(CONDITION_OPS),
    path: z.string().regex(FACT_PATH, "Fatto non ammesso"),
    value: z.union([primitive, z.array(primitive).min(1).max(50)]).optional(),
  })
  .superRefine((leaf, ctx) => {
    if (leaf.op === "exists") {
      if (leaf.value !== undefined) ctx.addIssue({ code: "custom", path: ["value"], message: "«Esiste» non ha un valore" });
      return;
    }
    if (leaf.value === undefined) ctx.addIssue({ code: "custom", path: ["value"], message: "Manca il valore da confrontare" });
    else if (leaf.op === "in" && !Array.isArray(leaf.value)) ctx.addIssue({ code: "custom", path: ["value"], message: "«Tra» vuole un elenco di valori" });
    else if (leaf.op !== "in" && Array.isArray(leaf.value)) ctx.addIssue({ code: "custom", path: ["value"], message: "Questo confronto vuole un solo valore" });
    else if ((leaf.op === "gte" || leaf.op === "lte") && typeof leaf.value !== "number") {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Questo confronto vuole un numero" });
    }
  });

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(conditionSchema).min(1) }).strict(),
    z.object({ any: z.array(conditionSchema).min(1) }).strict(),
    z.object({ not: conditionSchema }).strict(),
    leafSchema,
  ]),
) as z.ZodType<Condition>;

/** Controlla profondita' e numero di nodi (un albero enorme non e' una regola, e' un errore). */
export function conditionShapeIssues(condition: Condition): string | null {
  let nodes = 0;
  const walk = (c: Condition, depth: number): string | null => {
    nodes += 1;
    if (depth > MAX_DEPTH) return "La condizione è troppo annidata";
    if (nodes > MAX_NODES) return "La condizione ha troppi confronti";
    if ("all" in c) return c.all.map((x) => walk(x, depth + 1)).find(Boolean) ?? null;
    if ("any" in c) return c.any.map((x) => walk(x, depth + 1)).find(Boolean) ?? null;
    if ("not" in c) return walk(c.not, depth + 1);
    return null;
  };
  return walk(condition, 1);
}

/** Fatti di un bene, raccolti dal chiamante: il motore non legge nulla da solo. */
export type Facts = {
  asset: { kind: string; useType: string | null; inCondominium: boolean };
  rights: { regimes: string[] };
  /** Tipi di locazione o attivita' in corso sul bene (scelti dal proprietario nel modulo Locazioni). */
  letting?: { types: string[] };
  attributes: Record<string, Primitive>;
};

export function factValue(facts: Facts, path: string): Primitive | Primitive[] | undefined {
  if (path === "asset.kind") return facts.asset.kind;
  if (path === "asset.useType") return facts.asset.useType ?? undefined;
  if (path === "asset.inCondominium") return facts.asset.inCondominium;
  if (path === "rights.regimes") return facts.rights.regimes;
  if (path === "letting.types") return facts.letting?.types ?? [];
  if (path.startsWith("attributes.")) return facts.attributes[path.slice("attributes.".length)];
  return undefined;
}

/** Perche' una condizione e' risultata vera o falsa: per ogni confronto il fatto usato e il valore atteso. */
export type Trace =
  | { kind: "all" | "any"; result: boolean; children: Trace[] }
  | { kind: "not"; result: boolean; child: Trace }
  | { kind: "cmp"; result: boolean; op: ConditionOp; path: string; expected?: Primitive | Primitive[]; actual?: Primitive | Primitive[] };

export function evaluateCondition(condition: Condition | null, facts: Facts): { result: boolean; trace: Trace | null } {
  if (condition === null) return { result: true, trace: null };
  const trace = run(condition, facts);
  return { result: trace.result, trace };
}

function run(condition: Condition, facts: Facts): Trace {
  if ("all" in condition) {
    const children = condition.all.map((c) => run(c, facts));
    return { kind: "all", result: children.every((c) => c.result), children };
  }
  if ("any" in condition) {
    const children = condition.any.map((c) => run(c, facts));
    return { kind: "any", result: children.some((c) => c.result), children };
  }
  if ("not" in condition) {
    const child = run(condition.not, facts);
    return { kind: "not", result: !child.result, child };
  }
  const actual = factValue(facts, condition.path);
  return { kind: "cmp", result: compare(condition.op, actual, condition.value), op: condition.op, path: condition.path, expected: condition.value, actual };
}

function compare(op: ConditionOp, actual: Primitive | Primitive[] | undefined, expected: Primitive | Primitive[] | undefined): boolean {
  switch (op) {
    case "exists":
      return actual !== undefined && actual !== null;
    case "eq":
      return actual !== undefined && !Array.isArray(actual) && actual === expected;
    case "in":
      return actual !== undefined && !Array.isArray(actual) && Array.isArray(expected) && expected.includes(actual);
    case "contains":
      return Array.isArray(actual) && !Array.isArray(expected) && expected !== undefined && actual.includes(expected);
    case "gte":
      return typeof actual === "number" && typeof expected === "number" && actual >= expected;
    case "lte":
      return typeof actual === "number" && typeof expected === "number" && actual <= expected;
  }
}

/** I fatti realmente consultati da una valutazione (senza ripetizioni), per mostrarli accanto all'esito. */
export function factsUsed(trace: Trace | null): { path: string; value: Primitive | Primitive[] | null }[] {
  const seen = new Map<string, Primitive | Primitive[] | null>();
  const walk = (t: Trace) => {
    if (t.kind === "cmp") seen.set(t.path, t.actual ?? null);
    else if (t.kind === "not") walk(t.child);
    else t.children.forEach(walk);
  };
  if (trace) walk(trace);
  return [...seen].map(([path, value]) => ({ path, value }));
}
