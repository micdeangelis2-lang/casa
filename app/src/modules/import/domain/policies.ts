import type { ImportColumn } from "./columns";
import { normText } from "./deadlines";

/** Colonne del modello «Polizze»: compagnia e immobili devono essere gia' registrati. */
export const POLICY_COLUMNS: readonly ImportColumn[] = [
  { key: "title", header: "Titolo", aliases: ["Polizza"], example: "ESEMPIO – Polizza fittizia (riga da cancellare)", required: true },
  { key: "insurer", header: "Compagnia", aliases: ["Assicuratore"], example: "" },
  { key: "policyNumber", header: "Numero polizza", aliases: ["Numero"], example: "" },
  { key: "startsOn", header: "Data inizio", aliases: ["Inizio", "Dal"], example: "01/01/2099" },
  { key: "endsOn", header: "Data fine", aliases: ["Fine", "Scadenza", "Al"], example: "31/12/2099" },
  { key: "premium", header: "Premio", aliases: ["Premio annuo"], example: "0,00" },
  { key: "assets", header: "Immobili", aliases: ["Immobile", "Beni"], example: "" },
  { key: "notes", header: "Note", example: "Riga di esempio" },
];

/** Dal campo del validatore alla colonna del file. */
export const policyErrorColumn = (path: string): string => {
  const head = path.split(".")[0] ?? "_";
  return head === "insurerPartyId" ? "insurer" : head === "assetIds" ? "assets" : head === "note" ? "notes" : head;
};

/** Chiave di una polizza gia' presente: stesso titolo, stesso numero, stessa data di inizio. */
export const policyKey = (title: string, number: string | null | undefined, startsOn: string | null | undefined): string => `${normText(title)}|${normText(number ?? "")}|${startsOn ?? ""}`;
