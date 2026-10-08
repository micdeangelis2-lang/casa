/**
 * Lettore CSV puro per l'importazione: BOM, CRLF/LF, separatore «;» o «,» rilevato dall'intestazione, campi tra virgolette
 * (virgolette raddoppiate e a capo interni), righe vuote ignorate, spazi tagliati, tetti di dimensione.
 * Errori in italiano, con il numero di riga del file.
 */

export const CSV_LIMITS = { maxChars: 2 * 1024 * 1024, maxRows: 500, maxColumns: 60 } as const;

export type CsvRow = { /** Numero di riga nel file (1 = prima riga), quella in cui comincia il record. */ line: number; cells: string[] };

export type CsvParsed = { delimiter: ";" | ","; headers: string[]; rows: CsvRow[] };

export type CsvParseResult = ({ ok: true } & CsvParsed) | { ok: false; message: string };

const BOM = String.fromCharCode(0xfeff);
// Caratteri di controllo: tutti tranne tabulazione, a capo e ritorno a capo.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const fail = (message: string, line?: number): CsvParseResult => ({ ok: false, message: line ? `Riga ${line}: ${message}` : message });

/** Confronto delle intestazioni: senza maiuscole, accenti, spazi e segni di punteggiatura. */
export function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Sceglie il separatore dalla prima riga non vuota (fuori dalle virgolette): «;» se prevale o pareggia, altrimenti «,». */
function detectDelimiter(text: string): ";" | "," {
  let semi = 0;
  let comma = 0;
  let quoted = false;
  let seen = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) {
      if (seen) break;
    } else if (!quoted) {
      if (ch === ";") semi++;
      else if (ch === ",") comma++;
      if (ch.trim() !== "") seen = true;
    } else seen = true;
  }
  return comma > semi ? "," : ";";
}

export function parseCsv(input: string, limits: { maxChars: number; maxRows: number; maxColumns: number } = CSV_LIMITS): CsvParseResult {
  const text = input.startsWith(BOM) ? input.slice(1) : input;
  if (text.length > limits.maxChars) return fail(`Il file è troppo grande (massimo ${Math.round(limits.maxChars / (1024 * 1024))} MB).`);
  if (text.trim() === "") return fail("Il file è vuoto.");
  if (CONTROL.test(text)) return fail("Il file contiene caratteri di controllo non ammessi: controlla che sia un CSV di testo.");

  const delimiter = detectDelimiter(text);
  const records: CsvRow[] = [];
  let cells: string[] = [];
  let field = "";
  let wasQuoted = false;
  let line = 1;
  let recordLine = 1;
  let i = 0;

  const endField = () => {
    cells.push(field.trim());
    field = "";
    wasQuoted = false;
  };
  const endRecord = () => {
    endField();
    if (cells.some((c) => c !== "")) records.push({ line: recordLine, cells });
    cells = [];
  };

  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"' && field === "" && !wasQuoted) {
      // Campo tra virgolette: si legge fino alla virgoletta di chiusura.
      const startLine = line;
      i++;
      let closed = false;
      while (i < text.length) {
        const c = text[i]!;
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          closed = true;
          i++;
          break;
        }
        if (c === "\r") {
          if (text[i + 1] === "\n") i++;
          field += "\n";
          line++;
        } else if (c === "\n") {
          field += "\n";
          line++;
        } else field += c;
        i++;
      }
      if (!closed) return fail("virgolette aperte e mai chiuse.", startLine);
      wasQuoted = true;
      // Dopo la chiusura si accettano solo spazi, poi separatore o fine riga.
      while (text[i] === " " || text[i] === "\t") i++;
      const next = text[i];
      if (next !== undefined && next !== delimiter && next !== "\n" && next !== "\r") return fail("dopo le virgolette di chiusura c'è altro testo.", line);
      continue;
    }
    if (ch === delimiter) {
      endField();
      if (cells.length > limits.maxColumns) return fail(`troppe colonne (massimo ${limits.maxColumns}).`, recordLine);
      i++;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      i++;
      endRecord();
      line++;
      recordLine = line;
      if (records.length > limits.maxRows + 1) return fail(`troppe righe (massimo ${limits.maxRows} oltre all'intestazione).`, recordLine);
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== "" || wasQuoted || cells.length > 0) endRecord();

  const [head, ...rows] = records;
  if (!head) return fail("Il file è vuoto.");
  if (head.cells.length > limits.maxColumns) return fail(`troppe colonne (massimo ${limits.maxColumns}).`, head.line);
  if (rows.length === 0) return fail("Il file contiene solo l'intestazione: non ci sono righe da importare.");
  if (rows.length > limits.maxRows) return fail(`Il file ha troppe righe (massimo ${limits.maxRows}): dividilo in più file.`);
  for (const r of rows) if (r.cells.length > limits.maxColumns) return fail(`troppe colonne (massimo ${limits.maxColumns}).`, r.line);
  return { ok: true, delimiter, headers: head.cells, rows };
}
