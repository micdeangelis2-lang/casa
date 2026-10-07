/**
 * Calendario iCalendar (RFC 5545) per importare le scadenze in Google Calendar, Apple Calendar, Outlook o Thunderbird.
 * Eventi «tutto il giorno» (`VALUE=DATE`), fine riga CRLF, righe piegate a 75 byte senza spezzare un carattere UTF-8,
 * testo con gli escape previsti (`\\`, `\;`, `\,`, a capo). Nessuna dipendenza: e' un formato di testo semplice.
 */

export type IcsEvent = {
  /** Identificatore stabile: reimportando il file l'evento viene aggiornato, non duplicato. */
  uid: string;
  /** Giorno dell'evento, `YYYY-MM-DD`. */
  date: string;
  summary: string;
  description?: string;
  /** Indirizzo da aprire dall'evento (pagina della scadenza nell'app). */
  url?: string;
  /** Promemoria: quanti giorni prima (0 = il giorno stesso), alle 9:00. */
  alarmsDaysBefore?: number[];
  alarmText?: string;
};

export type IcsCalendar = { name: string; productId?: string; events: IcsEvent[]; now: Date };

const NEWLINE = "\r\n";
const MAX_OCTETS = 75;
const encoder = new TextEncoder();

/** Escape di un valore di testo (RFC 5545, 3.3.11); i caratteri di controllo si tolgono. */
export function icsText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Piega una riga a 75 byte: le continuazioni iniziano con uno spazio, e un carattere multibyte non viene mai spezzato. */
export function foldLine(line: string): string {
  if (encoder.encode(line).length <= MAX_OCTETS) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  let limit = MAX_OCTETS;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (size + bytes > limit) {
      parts.push(current);
      current = "";
      size = 0;
      limit = MAX_OCTETS - 1; // lo spazio iniziale della continuazione conta
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join(`${NEWLINE} `);
}

const compactDate = (date: string) => date.replaceAll("-", "");

const nextDay = (date: string): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** `20261006T083000Z`: l'istante in UTC senza separatori. */
const stamp = (now: Date) => now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Quanto prima dell'inizio (mezzanotte del giorno) scatta un promemoria alle 9:00 di N giorni prima. */
export function alarmTrigger(daysBefore: number): string {
  if (daysBefore <= 0) return "PT9H";
  return daysBefore === 1 ? "-PT15H" : `-P${daysBefore - 1}DT15H`;
}

function eventLines(event: IcsEvent, now: Date): string[] {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART;VALUE=DATE:${compactDate(event.date)}`,
    `DTEND;VALUE=DATE:${compactDate(nextDay(event.date))}`,
    `SUMMARY:${icsText(event.summary)}`,
  ];
  if (event.description) lines.push(`DESCRIPTION:${icsText(event.description)}`);
  if (event.url) lines.push(`URL:${event.url.replace(/[\u0000-\u001f\u007f\s]/g, "")}`);
  lines.push("TRANSP:TRANSPARENT");
  for (const days of [...new Set(event.alarmsDaysBefore ?? [])].sort((a, b) => b - a)) {
    lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsText(event.alarmText ?? event.summary)}`, `TRIGGER:${alarmTrigger(days)}`, "END:VALARM");
  }
  lines.push("END:VEVENT");
  return lines;
}

/** Il file `.ics` completo. */
export function buildIcs(calendar: IcsCalendar): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${calendar.productId ?? "-//Gestione Immobili//Scadenze//IT"}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText(calendar.name)}`,
    ...calendar.events.flatMap((e) => eventLines(e, calendar.now)),
    "END:VCALENDAR",
  ];
  return `${lines.map(foldLine).join(NEWLINE)}${NEWLINE}`;
}
