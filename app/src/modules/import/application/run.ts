import { csvDocument } from "@/shared/csv";
import type { ImportKind } from "../domain/columns";
import { classifyFile, columnsFor } from "./classify";
import type { ImportCounts, ImportFailure, ImportLabels, ImportPorts, ImportPreview, RowOutcome } from "./ports";

const count = (rows: RowOutcome[]): ImportCounts => ({
  total: rows.length,
  ready: rows.filter((r) => r.status === "ready").length,
  duplicate: rows.filter((r) => r.status === "duplicate").length,
  error: rows.filter((r) => r.status === "error").length,
  skipped: rows.filter((r) => r.status === "skipped").length,
});

/** Anteprima: legge e controlla il file con le regole dei moduli, senza scrivere nulla. */
export async function previewImport(kind: ImportKind, text: string, ports: ImportPorts, labels: ImportLabels): Promise<ImportPreview | ImportFailure> {
  const classified = await classifyFile(kind, text, ports, labels);
  if (!classified.ok) return classified;
  const rows = classified.rows.map((row) => ({ line: row.line, status: row.status, label: row.label, message: row.message, column: row.column }));
  return { ok: true, counts: count(rows), rows, ignoredHeaders: classified.ignoredHeaders };
}

/** Interrompe la transazione: nessuna riga resta scritta se una fallisce. */
export class ImportAbort extends Error {
  constructor(
    readonly line: number,
    detail: string,
  ) {
    super(`Riga ${line}: ${detail}`);
  }
}

export type ImportOutcome = { ok: true; kind: ImportKind; counts: ImportCounts };

/**
 * Importa le righe «pronte». Va eseguita dentro una sola transazione (`ports` legati ad essa): se una riga viene rifiutata dal modulo
 * lancia `ImportAbort` e la transazione annulla tutto. L'audit di riepilogo registra solo il tipo e i conteggi.
 */
export async function executeImport(
  kind: ImportKind,
  text: string,
  ports: ImportPorts,
  labels: ImportLabels,
  audit: { record(event: { action: string; entityType: string; entityId: string; diff?: Record<string, unknown> }): Promise<void> },
): Promise<ImportOutcome | ImportFailure> {
  const classified = await classifyFile(kind, text, ports, labels);
  if (!classified.ok) return classified;
  for (const row of classified.rows) {
    if (row.status !== "ready") continue;
    const created = await ports.create(kind, row.payload);
    if (!created.ok) {
      const first = Object.values(created.errors)[0]?.[0] ?? "riga rifiutata";
      throw new ImportAbort(row.line, first);
    }
  }
  const counts = count(classified.rows);
  await audit.record({
    action: "import.run",
    entityType: "import",
    entityId: kind,
    diff: { kind, total: counts.total, imported: counts.ready, duplicates: counts.duplicate, errors: counts.error, skipped: counts.skipped },
  });
  return { ok: true, kind, counts };
}

/** Il modello scaricabile: intestazioni e una riga di esempio chiaramente fittizia. */
export function templateCsv(kind: ImportKind): string {
  const columns = columnsFor(kind);
  return csvDocument([columns.map((c) => c.header), columns.map((c) => c.example)]);
}
