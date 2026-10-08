import type { ImportColumn } from "./columns";

/** Colonne del modello «Canoni di locazione»: una riga per ogni canone di una locazione gia' registrata. */
export const RENT_COLUMNS: readonly ImportColumn[] = [
  { key: "letting", header: "Locazione", aliases: ["Titolo locazione", "Contratto"], example: "ESEMPIO – Locazione fittizia (riga da cancellare)", required: true },
  { key: "dueOn", header: "Scadenza", aliases: ["Data scadenza", "Data di scadenza"], example: "31/12/2099", required: true },
  { key: "amount", header: "Importo", aliases: ["Canone", "Importo canone"], example: "0,00", required: true },
  { key: "paidOn", header: "Data incasso", aliases: ["Incassato il", "Data pagamento"], example: "" },
  { key: "paid", header: "Importo incassato", aliases: ["Incassato"], example: "" },
];

/** Dal campo del validatore alla colonna del file. */
export const rentErrorColumn = (path: string): string => {
  const head = path.split(".")[0] ?? "_";
  return head === "paid" ? "paid" : head === "paidOn" ? "paidOn" : head === "dueOn" ? "dueOn" : "amount";
};
