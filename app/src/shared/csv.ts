/**
 * CSV per un foglio di calcolo italiano: separatore «;», decimali con la virgola, UTF-8 con BOM, fine riga CRLF.
 * Un testo che inizia come una formula («=», «+», «-», «@», tabulazione) viene neutralizzato con un apice, perche' aprendo il
 * file non venga eseguito (iniezione di formule): vale per ogni CSV dell'app, anche per quelli che partono per terzi.
 */

export type CsvCell = string | number | null;

/** Il segno d'ordine dei byte che fa riconoscere l'UTF-8 a Excel. */
export const CSV_BOM = String.fromCharCode(0xfeff);

export function csvCell(value: CsvCell, options: { alwaysQuote?: boolean } = {}): string {
  if (value === null) return options.alwaysQuote ? '""' : "";
  if (typeof value === "number") return String(value).replace(".", ",");
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return options.alwaysQuote || /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const csvLine = (cells: CsvCell[], options: { alwaysQuote?: boolean } = {}): string => cells.map((c) => csvCell(c, options)).join(";");

/** Un documento CSV: BOM, righe unite con CRLF e fine riga finale. */
export const csvDocument = (rows: CsvCell[][], options: { alwaysQuote?: boolean } = {}): string => `${CSV_BOM}${rows.map((r) => csvLine(r, options)).join("\r\n")}\r\n`;
