import type { Condition, ConditionOp, Primitive } from "./condition";

/**
 * Forma "piatta" di una condizione, quella che l'editor a moduli sa mostrare: nessuna condizione (sempre),
 * oppure un elenco di confronti uniti da «tutte» o «almeno una», ciascuno con un eventuale «non».
 * Un albero piu' complesso resta valido nei dati, ma l'editor lo mostra in sola lettura.
 */
export type FlatRow = { negate: boolean; op: ConditionOp; path: string; value?: Primitive | Primitive[] };
export type FlatCondition = { mode: "always" } | { mode: "all" | "any"; rows: FlatRow[] };

const isLeaf = (c: Condition): c is Extract<Condition, { op: ConditionOp }> => "op" in c;

/** Restituisce la forma piatta, oppure null se la condizione non e' rappresentabile dal modulo. */
export function toFlat(condition: Condition | null): FlatCondition | null {
  if (condition === null) return { mode: "always" };
  const row = (c: Condition): FlatRow | null => {
    if (isLeaf(c)) return { negate: false, op: c.op, path: c.path, value: c.value };
    if ("not" in c && isLeaf(c.not)) return { negate: true, op: c.not.op, path: c.not.path, value: c.not.value };
    return null;
  };
  if (isLeaf(condition) || "not" in condition) {
    const single = row(condition);
    return single ? { mode: "all", rows: [single] } : null;
  }
  const list = "all" in condition ? condition.all : condition.any;
  const rows = list.map(row);
  if (rows.some((r) => r === null)) return null;
  return { mode: "all" in condition ? "all" : "any", rows: rows as FlatRow[] };
}

export function fromFlat(flat: FlatCondition): Condition | null {
  if (flat.mode === "always" || flat.rows.length === 0) return null;
  const leaves: Condition[] = flat.rows.map((r) => {
    const leaf: Condition = r.value === undefined ? { op: r.op, path: r.path } : { op: r.op, path: r.path, value: r.value };
    return r.negate ? { not: leaf } : leaf;
  });
  if (leaves.length === 1) return leaves[0]!;
  return flat.mode === "all" ? { all: leaves } : { any: leaves };
}
