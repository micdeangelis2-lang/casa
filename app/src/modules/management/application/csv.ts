import { csvDocument, type CsvCell } from "@/shared/csv";
import type { Statement } from "../domain/management";

const euros = (cents: number): number => cents / 100;

/** Etichette gia' pronte (italiano) per il CSV del rendiconto: le fornisce chi chiama, il modulo non conosce l'interfaccia. */
export type StatementCsvLabels = { title: string; note: string; area: Record<string, string>; state: Record<string, string>; stage: Record<string, string> };

/** Il rendiconto in CSV (UTF-8 con BOM, «;», virgola decimale): una sezione per argomento. */
export function statementCsv(s: Statement & { assetName: string | null }, labels: StatementCsvLabels): string {
  const rows: CsvCell[][] = [
    [`${labels.title} - ${s.assetName ?? ""} - ${s.from} / ${s.to}`],
    [labels.note],
    [],
    ["Canoni con scadenza nel periodo"],
    ["Scadenza", "Locazione", "Previsto (€)", "Incassato (€)", "Data incasso", "Situazione", "Documento di prova"],
    ...s.rents.map((r): CsvCell[] => [r.dueOn, r.lettingTitle, euros(r.amountCents), euros(r.paidCents), r.paidOn, labels.state[r.state] ?? r.state, r.hasProof ? "sì" : "no"]),
    ["Totale", "", euros(s.rentTotals.dueCents), euros(s.rentTotals.paidCents), "", `arretrato ${(s.rentTotals.overdueCents / 100).toFixed(2).replace(".", ",")} €`, ""],
    [],
    ["Incassi registrati con data nel periodo"],
    ["Data", "Descrizione", "Importo (€)"],
    ...s.receipts.map((e): CsvCell[] => [e.date, e.label, euros(e.amountCents)]),
    ["Totale incassi", "", euros(s.totals.receiptsCents)],
    [],
    ["Pagamenti registrati con data nel periodo"],
    ["Data", "Area", "Descrizione", "Importo (€)"],
    ...s.payments.map((e): CsvCell[] => [e.date, labels.area[e.area] ?? e.area, e.label, euros(e.amountCents)]),
    ["Totale pagamenti", "", "", euros(s.totals.paymentsCents)],
    ["Differenza incassi meno pagamenti", "", "", euros(s.totals.differenceCents)],
    [],
    ["Interventi di manutenzione"],
    ["Intervento", "Fase", "Fornitore", "Preventivo accettato (€)", "Fatturato (€)", "Pagato (€)", "Prevista", "Inizio", "Fine"],
    ...s.works.map((w): CsvCell[] => [w.title, labels.stage[w.stage] ?? w.stage, w.supplierName, euros(w.acceptedQuotesCents), euros(w.invoicedCents), euros(w.paidCents), w.scheduledOn, w.startedOn, w.completedOn]),
    [],
    ["Codici identificativi"],
    ["Locazione", "Nome", "Codice", "Rilasciato da", "Valido fino al"],
    ...s.codes.map((c): CsvCell[] => [c.lettingTitle, c.label, c.value, c.issuer, c.validUntil]),
    [],
    ["Adempimenti"],
    ["Locazione", "Adempimento", "Periodo", "Scadenza", "Eseguito il"],
    ...s.reports.map((r): CsvCell[] => [r.lettingTitle, r.title, r.period, r.dueOn, r.doneOn]),
    [],
    ["Mandato di gestione"],
    ["Titolo", "Gestore", "Fine", "Compenso dichiarato"],
    ...s.mandates.map((m): CsvCell[] => [m.title, m.managerName, m.endsOn, m.compensation]),
  ];
  return csvDocument(rows);
}
