/**
 * Suggerimenti di frazioni/localita' per un Comune, da Photon (geocoder di Komoot su dati OpenStreetMap), che completa i prefissi
 * mentre si digita. Solo logica: costruzione della query, chiamata (con `fetch` iniettabile, cosi' i test non usano la rete) e
 * filtro dei risultati. Si usa SOLO dal server. I nomi che arrivano da OSM non sono i nomi ufficiali ISTAT: sono un aiuto alla
 * digitazione, il campo resta libero.
 */

export const PHOTON_URL = "https://photon.komoot.io/api/";
const MAX_SUGGESTIONS = 10;
const TIMEOUT_MS = 5000;

/** Tipi di luogo OSM (chiave "place") che indicano una frazione, un borgo o una zona abitata. */
const PLACE_TYPES = new Set(["hamlet", "village", "suburb", "neighbourhood", "quarter", "locality", "isolated_dwelling", "town", "farm"]);

export class PlaceServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlaceServiceError";
  }
}

/** Minuscolo, senza accenti, senza apostrofi e punteggiatura, spazi singoli. */
export function normalizePlaceName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’'`´.,;:()-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Il nome di un Comune puo' avere piu' forme ("Bolzano/Bozen"): ciascuna vale come nome del Comune. */
function municipalityForms(comune: string): string[] {
  return comune
    .split("/")
    .map(normalizePlaceName)
    .filter((n) => n.length > 0);
}

export function buildPlaceQuery(args: { text: string; comune: string }): string {
  return `${args.text.trim()} ${args.comune.trim()}`;
}

/** Nessun parametro `lang`: Photon risponde 400 a "it". */
export function buildPlaceUrl(query: string): string {
  return `${PHOTON_URL}?${new URLSearchParams({ q: query, limit: "15" }).toString()}`;
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * Tiene i luoghi (chiave "place", tipo frazione/borgo/zona) che appartengono al Comune, scarta il Comune stesso, toglie i doppioni
 * e mette prima i nomi che iniziano con il testo digitato. La provincia (county) non vale come Comune.
 */
export function filterPlaceSuggestions(raw: unknown, args: { text: string; comune: string }): string[] {
  const features = raw && typeof raw === "object" ? (raw as { features?: unknown }).features : null;
  if (!Array.isArray(features)) return [];
  const forms = municipalityForms(args.comune);
  if (forms.length === 0) return [];
  const typed = normalizePlaceName(args.text);
  const seen = new Set<string>();
  const out: { name: string; starts: boolean }[] = [];

  for (const feature of features) {
    const props = feature && typeof feature === "object" ? (feature as { properties?: unknown }).properties : null;
    if (!props || typeof props !== "object") continue;
    const p = props as Record<string, unknown>;
    if (str(p.osm_key) !== "place" || !PLACE_TYPES.has(str(p.osm_value))) continue;
    if (p.countrycode !== undefined && str(p.countrycode).toUpperCase() !== "IT") continue;
    const name = str(p.name).trim();
    if (name.length === 0 || name.length > 120) continue;
    const key = normalizePlaceName(name);
    if (key.length === 0 || forms.includes(key) || seen.has(key)) continue;
    // Photon cerca anche nel Comune: si tengono solo i nomi che contengono davvero il testo digitato.
    if (typed.length > 0 && !key.includes(typed)) continue;
    if (!["city", "town", "village", "municipality"].some((k) => forms.includes(normalizePlaceName(str(p[k]))))) continue;

    seen.add(key);
    out.push({ name, starts: typed.length > 0 && key.startsWith(typed) });
  }

  out.sort((a, b) => Number(b.starts) - Number(a.starts) || a.name.localeCompare(b.name, "it"));
  return out.slice(0, MAX_SUGGESTIONS).map((o) => o.name);
}

export type PlaceSearchDeps = {
  fetchImpl?: typeof fetch;
  /** User-Agent identificativo. */
  userAgent: string;
};

/** Interroga Photon e restituisce i nomi filtrati. Lancia PlaceServiceError se il servizio non risponde o risponde male. */
export async function searchPlaces(args: { text: string; comune: string }, deps: PlaceSearchDeps): Promise<string[]> {
  const doFetch = deps.fetchImpl ?? fetch;
  let body: unknown;
  try {
    const response = await doFetch(buildPlaceUrl(buildPlaceQuery(args)), {
      headers: { "User-Agent": deps.userAgent, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) throw new PlaceServiceError(`HTTP ${response.status}`);
    body = await response.json();
  } catch (error) {
    if (error instanceof PlaceServiceError) throw error;
    throw new PlaceServiceError("Servizio non raggiungibile");
  }
  return filterPlaceSuggestions(body, args);
}
