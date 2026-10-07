/**
 * Ricerca globale: parole del testo cercato confrontate, senza maiuscole e senza accenti, con i campi di ogni elemento.
 * Tutte le parole devono comparire (in un qualunque punto dei campi). Nessun punteggio: l'ordine e' quello dei moduli.
 */

export const SEARCH_GROUPS = ["assets", "documents", "parties", "deadlines", "taxes", "condominium", "maintenance", "insurance", "lettings", "matters", "rules"] as const;
export type SearchGroup = (typeof SEARCH_GROUPS)[number];

export type Hit = { id: string; group: SearchGroup; title: string; subtitle: string | null; href: string };
export type GroupResult = { group: SearchGroup; total: number; items: Hit[] };

export const MIN_QUERY = 2;
export const MAX_QUERY = 100;
/** Quanti risultati per gruppo si mostrano (il resto si conta soltanto). */
export const PER_GROUP = 8;

/** Minuscolo e senza accenti (e/è/é diventano uguali): «caffe» trova «caffè». */
export const normalize = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/** Il testo cercato ripulito, oppure null se e' troppo corto. */
export function cleanQuery(raw: string | null | undefined): string | null {
  const text = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY);
  return text.length >= MIN_QUERY ? text : null;
}

/** Vero se ogni parola del testo cercato compare in almeno uno dei campi. */
export function matchesAll(query: string, ...fields: (string | null | undefined)[]): boolean {
  const haystack = normalize(fields.filter(Boolean).join(" "));
  return normalize(query)
    .split(" ")
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/** Limita un gruppo ai primi risultati, ricordando quanti erano in tutto. */
export const limitGroup = (group: SearchGroup, hits: Hit[], per = PER_GROUP): GroupResult => ({ group, total: hits.length, items: hits.slice(0, per) });
