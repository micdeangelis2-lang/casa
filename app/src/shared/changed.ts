/** Nomi dei campi che differiscono tra due versioni di un record (per l'audit: solo i nomi, mai i valori). */
export function changedKeys<T extends Record<string, unknown>>(before: T, after: T): string[] {
  return Object.keys(after).filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null));
}
