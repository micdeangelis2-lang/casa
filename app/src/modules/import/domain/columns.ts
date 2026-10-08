import { normalizeHeader, type CsvParsed } from "./csv-reader";

/** Una colonna del modello: `key` e' il nome interno, `header` l'intestazione mostrata e scaricata. */
export type ImportColumn = {
  key: string;
  header: string;
  /** Altri nomi accettati per l'intestazione (confronto senza maiuscole, accenti e punteggiatura). */
  aliases?: string[];
  /** Valore della riga di esempio del modello (chiaramente fittizio). */
  example: string;
  required?: boolean;
};

export type ImportKind = "contacts" | "assets" | "deadlines" | "rents" | "taxes" | "taxPayments" | "policies";
export const IMPORT_KINDS: readonly ImportKind[] = ["contacts", "assets", "deadlines", "rents", "taxes", "taxPayments", "policies"];

/** Le righe di esempio dei modelli iniziano con questa parola: importate cosi' come sono creerebbero un dato fittizio, quindi si saltano. */
const EXAMPLE_MARKER = "ESEMPIO";

/** La colonna che nel modello porta la riga di esempio (quella il cui esempio inizia con «ESEMPIO»). */
export const exampleColumn = (columns: readonly ImportColumn[]): ImportColumn | undefined => columns.find((c) => c.example.startsWith(EXAMPLE_MARKER));

/** Vero se la riga e' quella di esempio del modello: la colonna di testo che nel modello porta «ESEMPIO» inizia con «ESEMPIO». */
export function isExampleRow(values: Record<string, string>, columns: readonly ImportColumn[]): boolean {
  const marker = exampleColumn(columns);
  const value = marker ? (values[marker.key] ?? "").trim() : "";
  return value.startsWith(EXAMPLE_MARKER) && !/^[\p{L}\p{N}]/u.test(value.slice(EXAMPLE_MARKER.length));
}

export type ImportRecord = { line: number; values: Record<string, string>; columnCountError?: string };

export type MappedFile =
  | { ok: true; records: ImportRecord[]; ignoredHeaders: string[] }
  | { ok: false; message: string };

/**
 * Collega le intestazioni del file alle colonne del modello. Ogni riga diventa un record `chiave -> testo`; una riga con un numero
 * di celle diverso dall'intestazione porta un errore di riga (non blocca le altre).
 */
export function mapColumns(parsed: CsvParsed, columns: readonly ImportColumn[]): MappedFile {
  const indexByKey = new Map<string, number>();
  const ignoredHeaders: string[] = [];
  let repeated: string | null = null;
  parsed.headers.forEach((header, i) => {
    const norm = normalizeHeader(header);
    const column = columns.find((c) => [c.header, c.key, ...(c.aliases ?? [])].some((n) => normalizeHeader(n) === norm));
    if (!column || norm === "") {
      if (header !== "") ignoredHeaders.push(header);
      return;
    }
    if (indexByKey.has(column.key)) repeated ??= column.header;
    indexByKey.set(column.key, i);
  });
  if (repeated) return { ok: false, message: `La colonna «${repeated}» compare più di una volta.` };
  const missing = columns.filter((c) => c.required && !indexByKey.has(c.key)).map((c) => c.header);
  if (missing.length > 0) {
    return { ok: false, message: `Nel file manca la colonna: ${missing.join(", ")}. Scarica il modello per vedere le intestazioni attese.` };
  }
  if (indexByKey.size === 0) return { ok: false, message: "Nessuna intestazione riconosciuta. Scarica il modello per vedere le intestazioni attese." };
  const records = parsed.rows.map((row): ImportRecord => {
    const values: Record<string, string> = {};
    for (const [key, i] of indexByKey) values[key] = row.cells[i] ?? "";
    const wrong =
      row.cells.length === parsed.headers.length
        ? undefined
        : `La riga ha ${row.cells.length} colonne invece di ${parsed.headers.length}: controlla il separatore e le virgolette.`;
    return { line: row.line, values, ...(wrong ? { columnCountError: wrong } : {}) };
  });
  return { ok: true, records, ignoredHeaders };
}

/** Sceglie un valore ammesso a partire dal codice o dall'etichetta italiana (senza badare a maiuscole e accenti). */
export function resolveChoice<T extends string>(raw: string, codes: readonly T[], labels: Record<string, string>): T | null {
  const norm = normalizeHeader(raw);
  if (norm === "") return null;
  return codes.find((c) => normalizeHeader(c) === norm || normalizeHeader(labels[c] ?? "") === norm) ?? null;
}
