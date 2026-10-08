import type { ImportColumn } from "./columns";

/** Colonne del modello «Voci di tributo»: immobile e tipo di tributo devono esistere gia'. */
export const TAX_COLUMNS: readonly ImportColumn[] = [
  { key: "asset", header: "Immobile", aliases: ["Bene"], example: "ESEMPIO – Immobile fittizio (riga da cancellare)", required: true },
  { key: "taxType", header: "Tipo di tributo", aliases: ["Tributo", "Tipo"], example: "Nome del tipo di tributo", required: true },
  { key: "year", header: "Anno", example: "2099", required: true },
  { key: "label", header: "Etichetta", aliases: ["Rata", "Periodo"], example: "" },
  { key: "expected", header: "Importo atteso", aliases: ["Importo"], example: "" },
  { key: "note", header: "Note", example: "Riga di esempio" },
];

/** Colonne del modello «Pagamenti di tributo»: la voce si identifica con immobile, tipo, anno ed etichetta. */
export const TAX_PAYMENT_COLUMNS: readonly ImportColumn[] = [
  { key: "asset", header: "Immobile", aliases: ["Bene"], example: "ESEMPIO – Immobile fittizio (riga da cancellare)", required: true },
  { key: "taxType", header: "Tipo di tributo", aliases: ["Tributo", "Tipo"], example: "Nome del tipo di tributo", required: true },
  { key: "year", header: "Anno", example: "2099", required: true },
  { key: "label", header: "Etichetta", aliases: ["Rata", "Periodo"], example: "" },
  { key: "paidOn", header: "Data pagamento", aliases: ["Data", "Pagato il"], example: "31/12/2099", required: true },
  { key: "amount", header: "Importo pagato", aliases: ["Importo"], example: "0,00", required: true },
  { key: "reference", header: "Riferimento", example: "" },
];

/** Come l'indice univoco del database (immobile, tipo, anno, etichetta; etichetta vuota = vuota). */
export const obligationKey = (assetId: string, taxTypeId: string, year: number, label: string | null | undefined): string => `${assetId}|${taxTypeId}|${year}|${label ?? ""}`;

/** Chiave di un pagamento: stessa voce, stessa data, stesso importo. */
export const paymentKey = (obligationId: string, paidOn: string, amountCents: number): string => `${obligationId}|${paidOn}|${amountCents}`;

/** Dal campo del validatore alla colonna del file (voci). */
export const taxErrorColumn = (path: string): string => {
  const head = path.split(".")[0] ?? "_";
  return head === "assetId" ? "asset" : head === "taxTypeId" ? "taxType" : head;
};

/** Dal campo del validatore alla colonna del file (pagamenti). */
export const taxPaymentErrorColumn = (path: string): string => {
  const head = path.split(".")[0] ?? "_";
  return head === "penalty" || head === "interest" ? "amount" : head;
};
