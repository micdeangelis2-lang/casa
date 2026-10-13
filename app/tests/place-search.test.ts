import { describe, expect, it, vi } from "vitest";
import { buildPlaceQuery, buildPlaceUrl, filterPlaceSuggestions, normalizePlaceName, PlaceServiceError, searchPlaces } from "@/lib/place-search";

// Risposte finte nella forma reale di Photon (GeoJSON FeatureCollection).
const feature = (properties: Record<string, unknown>) => ({ type: "Feature", geometry: { type: "Point", coordinates: [14.87, 40.64] }, properties });
const collection = (...items: ReturnType<typeof feature>[]) => ({ type: "FeatureCollection", features: items });
const IT = { county: "Salerno", state: "Campania", country: "Italia", countrycode: "IT" };

const PONTECAGNANO_FAI = collection(
  feature({ osm_key: "place", osm_value: "town", type: "city", name: "Pontecagnano Faiano", ...IT }),
  feature({ osm_key: "place", osm_value: "suburb", type: "district", name: "Faiano", city: "Pontecagnano Faiano", postcode: "84090", ...IT }),
  feature({ osm_key: "railway", osm_value: "station", type: "house", name: "Pontecagnano", street: "Via Torino", district: "Pontecagnano", city: "Pontecagnano Faiano", ...IT }),
  feature({ osm_key: "place", osm_value: "suburb", type: "district", name: "Pontecagnano", city: "Pontecagnano Faiano", ...IT }),
  feature({ osm_key: "amenity", osm_value: "townhall", type: "house", name: "Municipio di Pontecagnano Faiano", city: "Pontecagnano Faiano", ...IT }),
  feature({ osm_key: "amenity", osm_value: "place_of_worship", type: "house", name: "San Benedetto in Faiano", district: "Faiano", city: "Pontecagnano Faiano", ...IT }),
);

const PONTECAGNANO_SANT = collection(
  feature({ osm_key: "place", osm_value: "suburb", type: "district", name: "Sant'Antonio a Picenza", city: "Pontecagnano Faiano", ...IT }),
  feature({ osm_key: "place", osm_value: "hamlet", type: "district", name: "Picciola", city: "Pontecagnano Faiano", ...IT }),
  feature({ osm_key: "place", osm_value: "hamlet", type: "district", name: "Picciola", city: "Pontecagnano Faiano", ...IT }),
  feature({ osm_key: "place", osm_value: "suburb", type: "district", name: "Sant'Antonio", city: "Montecorvino Rovella", ...IT }),
);

// Comuni con nome uguale o simile: senza la provincia non si distinguono due Comuni omonimi italiani (limite noto), ma si scartano
// quelli esteri e quelli con nome diverso ("Castro dei Volsci").
const OMONIMI = collection(
  feature({ osm_key: "place", osm_value: "village", name: "San Pietro", city: "Castro", county: "Lecce", state: "Puglia", country: "Italia", countrycode: "IT" }),
  feature({ osm_key: "place", osm_value: "village", name: "Borgo Alto", city: "Castro", county: "Bergamo", state: "Lombardia", country: "Italia", countrycode: "IT" }),
  feature({ osm_key: "place", osm_value: "village", name: "Aldea Vieja", city: "Castro", county: "Valdivia", state: "Los Rios", country: "Cile", countrycode: "CL" }),
  feature({ osm_key: "place", osm_value: "village", name: "Colle", city: "Castro dei Volsci", county: "Frosinone", countrycode: "IT" }),
);

describe("place-search: query", () => {
  it("compone testo e Comune, senza sigla ne' Italia", () => {
    expect(buildPlaceQuery({ text: " Fai ", comune: "Pontecagnano Faiano" })).toBe("Fai Pontecagnano Faiano");
  });

  it("l'indirizzo usa solo q e limit (niente lang, che Photon rifiuta con 400)", () => {
    const url = new URL(buildPlaceUrl("Fai Pontecagnano Faiano"));
    expect(url.origin + url.pathname).toBe("https://photon.komoot.io/api/");
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: "Fai Pontecagnano Faiano", limit: "15" });
  });

  it("normalizza accenti, maiuscole, apostrofi e spazi", () => {
    expect(normalizePlaceName("  Sant’Antonio  D'Àrco ")).toBe("sant antonio d arco");
  });
});

describe("place-search: filtro", () => {
  it("'Fai': tiene solo la frazione, scarta il Comune stesso, la stazione, il municipio, la chiesa e i nomi che non contengono il testo", () => {
    expect(filterPlaceSuggestions(PONTECAGNANO_FAI, { text: "Fai", comune: "Pontecagnano Faiano" })).toEqual(["Faiano"]);
  });

  it("scarta i luoghi di un altro Comune, deduplica e ordina con i nomi che iniziano col testo per primi", () => {
    expect(filterPlaceSuggestions(PONTECAGNANO_SANT, { text: "Sant Antonio", comune: "Pontecagnano Faiano" })).toEqual(["Sant'Antonio a Picenza"]);
    expect(filterPlaceSuggestions(PONTECAGNANO_SANT, { text: "pic", comune: "Pontecagnano Faiano" })).toEqual(["Picciola", "Sant'Antonio a Picenza"]);
  });

  it("due Comuni omonimi: valgono solo i luoghi in Italia il cui Comune coincide esattamente", () => {
    expect(filterPlaceSuggestions(OMONIMI, { text: "", comune: "Castro" })).toEqual(["Borgo Alto", "San Pietro"]);
  });

  it("la provincia non vale come Comune", () => {
    const items = collection(feature({ osm_key: "place", osm_value: "hamlet", name: "Lontana", city: "Cava de' Tirreni", ...IT }));
    expect(filterPlaceSuggestions(items, { text: "Lo", comune: "Salerno" })).toEqual([]);
  });

  it("riconosce il Comune anche in town/village/municipality, con nomi bilingue e accenti", () => {
    const items = collection(
      feature({ osm_key: "place", osm_value: "suburb", name: "Gries", town: "Bolzano - Bozen" }),
      feature({ osm_key: "place", osm_value: "suburb", name: "Oltrisarco", municipality: "Bozen" }),
      feature({ osm_key: "place", osm_value: "suburb", name: "Città Vecchia", village: "Bolzano" }),
    );
    expect(filterPlaceSuggestions(items, { text: "", comune: "Bolzano/Bozen" })).toEqual(["Città Vecchia", "Oltrisarco"]);
  });

  it("al massimo 10 nomi e input non validi danno un elenco vuoto", () => {
    const many = collection(
      ...Array.from({ length: 30 }, (_, i) => feature({ osm_key: "place", osm_value: "hamlet", name: `Borgo ${i}`, city: "Roma", countrycode: "IT" })),
    );
    expect(filterPlaceSuggestions(many, { text: "Bor", comune: "Roma" })).toHaveLength(10);
    expect(filterPlaceSuggestions(null, { text: "Bor", comune: "Roma" })).toEqual([]);
    expect(filterPlaceSuggestions({ features: [null, 3, "x", {}] }, { text: "Bor", comune: "Roma" })).toEqual([]);
    expect(filterPlaceSuggestions(many, { text: "Bor", comune: "  " })).toEqual([]);
  });
});

describe("place-search: chiamata (fetch finto)", () => {
  const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("invia User-Agent e interroga l'indirizzo giusto, poi filtra", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(PONTECAGNANO_FAI));
    const names = await searchPlaces({ text: "Fai", comune: "Pontecagnano Faiano" }, { fetchImpl: fetchImpl as unknown as typeof fetch, userAgent: "GestioneImmobili/1.0 (test)" });
    expect(names).toEqual(["Faiano"]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).searchParams.get("q")).toBe("Fai Pontecagnano Faiano");
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe("GestioneImmobili/1.0 (test)");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("HTTP in errore e rete assente diventano PlaceServiceError", async () => {
    const down = vi.fn(async () => jsonResponse({}, 503));
    await expect(searchPlaces({ text: "Pic", comune: "Roma" }, { fetchImpl: down as unknown as typeof fetch, userAgent: "t" })).rejects.toBeInstanceOf(PlaceServiceError);
    const offline = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(searchPlaces({ text: "Pic", comune: "Roma" }, { fetchImpl: offline as unknown as typeof fetch, userAgent: "t" })).rejects.toBeInstanceOf(PlaceServiceError);
  });
});
