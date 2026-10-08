import type { ImportColumn } from "./columns";

/** Colonne del modello «Scadenze»: solo scadenze con una data scritta a mano (nessun calcolo). */
export const DEADLINE_COLUMNS: readonly ImportColumn[] = [
  { key: "title", header: "Titolo", aliases: ["Scadenza"], example: "ESEMPIO – Scadenza fittizia (riga da cancellare)", required: true },
  { key: "category", header: "Categoria", example: "other", required: true },
  { key: "level", header: "Livello", example: "contract", required: true },
  { key: "asset", header: "Immobile", aliases: ["Bene"], example: "" },
  { key: "dueOn", header: "Data", aliases: ["Data scadenza", "Data di scadenza"], example: "31/12/2099", required: true },
  { key: "priority", header: "Priorità", aliases: ["Priorita"], example: "normal" },
  { key: "notes", header: "Note", aliases: ["Descrizione"], example: "Riga di esempio" },
];

/** Dal campo del validatore alla colonna del file. */
export const deadlineErrorColumn = (path: string): string => {
  const head = path.split(".")[0] ?? "_";
  return head === "firstDueOn" ? "dueOn" : head === "assetId" ? "asset" : head === "description" ? "notes" : head;
};

export const normText = (s: string): string => s.trim().replace(/\s+/g, " ").toLowerCase();

/** Chiave di una scadenza gia' presente: stesso titolo, stessa data, stesso immobile. */
export const deadlineKey = (title: string, dueOn: string, assetId: string | null | undefined): string => `${normText(title)}|${dueOn}|${assetId ?? ""}`;
