import type { ImportColumn } from "./columns";

/** Colonne del modello «Immobili». Le chiavi coincidono, dove possibile, con i campi del modulo Beni. */
export const ASSET_COLUMNS: readonly ImportColumn[] = [
  { key: "kind", header: "Tipo", example: "dwelling", required: true },
  { key: "name", header: "Denominazione", aliases: ["Nome"], example: "ESEMPIO – Immobile fittizio (riga da cancellare)", required: true },
  { key: "address", header: "Indirizzo", example: "Via Esempio 1" },
  { key: "municipality", header: "Comune", example: "Nome del Comune", required: true },
  { key: "province", header: "Provincia", aliases: ["Sigla provincia", "Prov"], example: "XX" },
  { key: "postalCode", header: "CAP", example: "00000" },
  { key: "locality", header: "Località", aliases: ["Frazione"], example: "" },
  { key: "useType", header: "Uso", example: "unused" },
  { key: "notes", header: "Note", example: "Riga di esempio" },
  { key: "holder", header: "Titolare", example: "" },
  { key: "quota", header: "Quota", example: "" },
  { key: "rightType", header: "Diritto", example: "" },
  { key: "sheet", header: "Foglio", example: "" },
  { key: "parcel", header: "Particella", aliases: ["Mappale"], example: "" },
  { key: "subunit", header: "Subalterno", aliases: ["Sub"], example: "" },
  { key: "cadastralCategory", header: "Categoria", aliases: ["Categoria catastale"], example: "" },
  { key: "income", header: "Rendita", aliases: ["Rendita catastale"], example: "" },
];

/** Dal percorso di un errore del validatore (es. `rights.0.quotaNumerator`) alla colonna del file. */
export function assetErrorColumn(path: string): string {
  const parts = path.split(".");
  const [head, , field] = parts;
  if (head === "territoryId") return "municipality";
  if (head === "rights") return field === "rightType" ? "rightType" : field === "holder" ? "holder" : "quota";
  if (head === "cadastral") return field === "sheet" || field === "parcel" || field === "subunit" || field === "cadastralCategory" || field === "income" ? field : "sheet";
  return head ?? "_";
}

/** Chiave per riconoscere un immobile gia' presente: stessa denominazione e stesso indirizzo (senza badare a maiuscole e spazi). */
export const assetKey = (name: string, address: string | null | undefined): string =>
  `${name.trim().replace(/\s+/g, " ").toLowerCase()}|${(address ?? "").trim().replace(/\s+/g, " ").toLowerCase()}`;
