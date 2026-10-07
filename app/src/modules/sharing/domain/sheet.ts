/**
 * Scheda in HTML autonomo dentro un pacchetto di condivisione. La scheda nasce come tabella (lo stesso CSV che l'app offre per
 * lo scarico: le righe sono quelle delle pagine, generate dallo stesso codice di lettura) e qui si trasforma in una pagina
 * stampabile: solo HTML e CSS nel file, nessuno script, nessuna risorsa esterna, nessun collegamento a siti.
 * Linguaggio neutro: la scheda riporta cio' che risulta dai dati registrati, senza giudizi di conformita'.
 */

/** Il tipo di scheda; coincide con la vista da cui nasce (notaio, tecnico, agente, assicuratore, commercialista, gestore, avvocato). */
export const SHEET_KINDS = ["notary", "technical", "agent", "insurer", "accountant", "manager", "lawyer"] as const;
export type SheetKind = (typeof SHEET_KINDS)[number];

/** Nome del file della scheda dentro lo ZIP. */
export const SHEET_PATH = "SCHEDA.html";

/** Cio' che il pacchetto ricorda della scheda: tipo, titolo e righe come furono al momento della creazione. */
export type PackageSheet = { kind: SheetKind; title: string; csv: string; sha256: string };

const BOM = String.fromCharCode(0xfeff);

/** Legge un CSV nel formato dell'app (separatore «;», virgolette doppie, righe CRLF, BOM): l'inverso di `csvDocument`. */
export function parseCsv(text: string): string[][] {
  const source = text.startsWith(BOM) ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (quoted) {
      if (c === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ";") {
      row.push(cell);
      cell = "";
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && source[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const dateIt = (value: string) => value.split("-").reverse().join("/");
/** Il testo di una cella per la pagina: senza l'apice con cui `csvCell` neutralizza le formule e con le date come gg/mm/aaaa. */
const visible = (value: string) => escapeHtml(/^\d{4}-\d{2}-\d{2}$/.test(value) ? dateIt(value) : /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value);
const isBlank = (row: string[]) => row.every((c) => c.trim() === "");
const filled = (row: string[]) => row.filter((c) => c.trim() !== "").length;

/** Contesto della scheda nel pacchetto: per chi, quando, con quale tetto di riservatezza (testi gia' tradotti). */
export type SheetContext = { createdAt: string; recipientName: string; recipientLabel: string; capLabel: string };

type Group = string[][];

/** Gruppi di righe separati da una riga vuota. */
function groups(rows: string[][]): Group[] {
  const out: Group[] = [];
  let current: Group = [];
  for (const row of rows) {
    if (isBlank(row)) {
      if (current.length > 0) out.push(current);
      current = [];
    } else current.push(row);
  }
  if (current.length > 0) out.push(current);
  return out;
}

function table(rows: string[][]): string {
  const [head, ...body] = rows;
  if (!head) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array.from({ length: width - r.length }, () => "")];
  const cells = (r: string[], tag: "th" | "td") => pad(r).map((c) => `<${tag}>${visible(c)}</${tag}>`).join("");
  return `<table>\n<thead><tr>${cells(head, "th")}</tr></thead>\n<tbody>\n${body.map((r) => `<tr>${cells(r, "td")}</tr>`).join("\n")}\n</tbody>\n</table>`;
}

/**
 * Pagina HTML della scheda. Le righe seguono la forma dei CSV dell'app: titolo e avvertenze in testa, poi sezioni separate da una
 * riga vuota, ciascuna con il titolo (una sola cella), l'intestazione e le righe.
 */
export function renderSheetHtml(sheet: Pick<PackageSheet, "title" | "csv">, ctx: SheetContext): string {
  const parts: string[] = [];
  for (const [index, group] of groups(parseCsv(sheet.csv)).entries()) {
    if (index === 0 && filled(group[0]!) === 1) {
      // Testa: la prima riga e' il titolo, le altre righe di una sola cella sono avvertenze.
      for (const row of group.slice(1)) parts.push(`<p class="notice">${visible(row.filter((c) => c.trim() !== "").join(" "))}</p>`);
      continue;
    }
    if (filled(group[0]!) === 1 && group.length > 1) {
      parts.push(`<section>\n<h2>${visible(group[0]!.find((c) => c.trim() !== "")!)}</h2>\n${table(group.slice(1))}\n</section>`);
    } else if (filled(group[0]!) === 1) parts.push(`<section>\n<h2>${visible(group[0]!.find((c) => c.trim() !== "")!)}</h2>\n</section>`);
    else parts.push(`<section>\n${table(group)}\n</section>`);
  }
  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(sheet.title)}</title>
<style>
@page{size:A4;margin:14mm}
body{font-family:system-ui,sans-serif;margin:2rem;color:#111;line-height:1.45;font-size:.95rem}
h1{font-size:1.4rem;margin:0 0 .5rem}
h2{font-size:1.1rem;margin:1.5rem 0 .4rem;break-after:avoid}
table{border-collapse:collapse;width:100%;font-size:.85rem}
th,td{border:1px solid #999;padding:.3rem .5rem;text-align:left;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}
th{background:#eee}
tr{break-inside:avoid}
.meta{margin:0 0 1rem}
.notice{border:1px solid #999;padding:.6rem .8rem;background:#f7f7f7}
</style>
</head>
<body>
<h1>${escapeHtml(sheet.title)}</h1>
<p class="meta"><strong>Destinatario:</strong> ${escapeHtml(ctx.recipientName)} (${escapeHtml(ctx.recipientLabel)})<br>
<strong>Preparata il:</strong> ${escapeHtml(dateIt(ctx.createdAt.slice(0, 10)))}<br>
<strong>Livello massimo di riservatezza scelto:</strong> ${escapeHtml(ctx.capLabel)}</p>
<p class="notice">Questa scheda riporta ciò che risulta dai dati registrati dal proprietario. Non attesta la conformità del bene né la correttezza o la completezza dei dati e dei documenti: per ogni decisione serve il parere di un professionista.</p>
${parts.join("\n")}
</body>
</html>
`;
}
