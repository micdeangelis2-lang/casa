import { CSV_BOM, csvLine } from "@/shared/csv";
import type { AdviserSummary } from "./use-cases";

const STATE_LABEL = {
  closed: "Chiusa dal proprietario",
  settled: "Pagamenti registrati pari all'importo indicato",
  partial: "Pagata in parte",
  recorded: "Pagamenti registrati, importo atteso non indicato",
  unpaid: "Nessun pagamento registrato",
} as const;

const RETURN_STATE_LABEL = { filed: "Presentata", overdue: "Data di scadenza superata, presentazione non registrata", to_file: "Da presentare" } as const;

const euros = (cents: number | null): number | null => (cents === null ? null : cents / 100);
const line = csvLine;

/**
 * Il riepilogo di un anno in CSV (UTF-8 con BOM, separatore «;»), da aprire in un foglio di calcolo o consegnare al consulente.
 * Riporta i dati cosi' come sono stati inseriti: non contiene calcoli di imposta ne' giudizi.
 */
export function summaryCsv(s: AdviserSummary): string {
  const rows: string[] = [
    line(["Riepilogo tributi e pagamenti", s.year]),
    line(["Gli importi attesi sono quelli indicati dal proprietario: non sono un calcolo di quanto e' dovuto."]),
    "",
    line(["Voci"]),
    line(["Immobile", "Tributo", "Dettaglio", "Scadenza", "Importo atteso (€)", "Pagato (€)", "Differenza (€)", "Situazione registrata", "Pagamenti senza prova", "Da chiedere al consulente", "Nota"]),
    ...s.items.map((i) =>
      line([i.assetName, i.typeName, i.label, i.dueOn, euros(i.expectedCents), euros(i.paidCents), euros(i.remainingCents), STATE_LABEL[i.state], i.paymentsWithoutProof, i.askAdviser ? "sì" : "", i.note]),
    ),
    "",
    line(["Dichiarazioni e comunicazioni"]),
    line(["Titolo", "Immobile", "Scadenza", "Presentata il", "Protocollo", "Situazione registrata", "Da chiedere al consulente", "Nota"]),
    ...s.returns.map((r) => line([r.title, r.assetName, r.dueOn, r.filedOn, r.protocol, RETURN_STATE_LABEL[r.state], r.askAdviser ? "sì" : "", r.note])),
  ];
  return `${CSV_BOM}${rows.join("\r\n")}\r\n`;
}
