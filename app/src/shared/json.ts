/**
 * Serializzazione JSON con le chiavi ordinate: serve a confrontare valori letti da jsonb (Postgres riordina le chiavi
 * dei suoi oggetti) con valori costruiti in memoria. `undefined` e `null` si equivalgono.
 */
export const canonicalJson = (value: unknown): string =>
  JSON.stringify(value ?? null, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v,
  );

export const sameJson = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);
