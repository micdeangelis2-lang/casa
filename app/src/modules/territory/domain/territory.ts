import { optionalText, requiredText, z } from "@/shared/zod";

export const TERRITORY_KINDS = ["country", "region", "province", "municipality", "locality"] as const;
export type TerritoryKind = (typeof TERRITORY_KINDS)[number];

/** Livello superiore di ogni tipo di territorio: la gerarchia e' una regola di dominio, non dati. */
export const PARENT_KIND: Record<TerritoryKind, TerritoryKind | null> = {
  country: null,
  region: "country",
  province: "region",
  municipality: "province",
  locality: "municipality",
};

/** Tipi che l'utente puo' aggiungere a mano (lo Stato e le regioni arrivano dall'import). */
export const MANUAL_KINDS = ["province", "municipality", "locality"] as const;

export const createTerritorySchema = z.object({
  kind: z.enum(MANUAL_KINDS, { error: "Scegli il tipo di territorio" }),
  parentId: z.uuid("Scegli il territorio di livello superiore"),
  name: requiredText("Nome", 120),
  code: optionalText(20),
  cadastralCode: z.preprocess(
    (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : v.trim().toUpperCase()) : v),
    z
      .string()
      .regex(/^[A-Z]\d{3}$/, "Il codice catastale ha una lettera e tre cifre (es. A123)")
      .optional(),
  ),
});


export type Territory = {
  id: string;
  kind: TerritoryKind;
  parentId: string | null;
  name: string;
  code: string | null;
  cadastralCode: string | null;
  provinceSigla: string | null;
  source: string;
  verificationStatus: string;
};

/** Territorio con l'etichetta completa per i selettori, es. "Comune (XX) · Regione". */
export type TerritoryOption = Territory & { label: string };

/**
 * Etichetta leggibile per i selettori, a partire dalla catena territorio -> antenati (primo elemento = il territorio stesso).
 * Esempi: "Comune (XX) · Regione", "Frazione, Comune (XX) · Regione".
 */
export function territoryLabel(chain: Pick<Territory, "kind" | "name" | "provinceSigla">[]): string {
  const self = chain[0];
  if (!self) return "";
  const find = (kind: TerritoryKind) => chain.find((t) => t.kind === kind);
  const province = find("province");
  const municipality = find("municipality");
  const region = find("region");
  const sigla = province?.provinceSigla ? ` (${province.provinceSigla})` : "";

  let head: string;
  if (self.kind === "locality") head = `${self.name}, ${municipality?.name ?? ""}${sigla}`;
  else if (self.kind === "municipality" || self.kind === "province") head = `${self.name}${sigla}`;
  else head = self.name;

  return region && self.kind !== "region" && self.kind !== "country" ? `${head} · ${region.name}` : head;
}
