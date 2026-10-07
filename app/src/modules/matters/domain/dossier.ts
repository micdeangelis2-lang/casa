import { csvDocument } from "@/shared/csv";

/**
 * Fascicolo di una pratica per il professionista: logica pura (nessun accesso ai dati). Cronologia ordinata dei fatti
 * registrati, elenco di cio' che manca prima della consegna, righe CSV. Dice solo cosa RISULTA dai dati inseriti dal
 * proprietario: non valuta ragioni, termini di legge, prescrizioni ne' esiti.
 */

/** Ordine delle fonti a parita' di data (il fatto principale prima del dettaglio). */
export const TIMELINE_KINDS = ["matter", "submission", "request", "opinion", "event", "document", "claim", "communication", "deadline", "rent"] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];

export type TimelineEvent = {
  /** Data di calendario `YYYY-MM-DD`, oppure null se il dato non ha una data. */
  date: string | null;
  kind: TimelineKind;
  title: string;
  detail: string | null;
  /** Percorso interno dell'elemento di origine (per i collegamenti nella pagina). */
  href: string | null;
  amountCents: number | null;
};

export type Timeline = { dated: TimelineEvent[]; undated: TimelineEvent[] };

const kindRank = (kind: TimelineKind): number => TIMELINE_KINDS.indexOf(kind);

/** Ordine cronologico crescente; a parita' di data per fonte e poi per titolo. Gli eventi senza data stanno a parte, mai persi. */
export function buildTimeline(events: TimelineEvent[]): Timeline {
  const byTitle = (a: TimelineEvent, b: TimelineEvent) => a.title.localeCompare(b.title, "it");
  const dated = events
    .filter((e): e is TimelineEvent & { date: string } => e.date !== null)
    .sort((a, b) => a.date.localeCompare(b.date) || kindRank(a.kind) - kindRank(b.kind) || byTitle(a, b));
  const undated = events.filter((e) => e.date === null).sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || byTitle(a, b));
  return { dated, undated };
}

const dateIt = (value: string | null): string => (value ? value.split("-").reverse().join("/") : "");
const euro = (cents: number): string => (cents / 100).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" });

export type TimelineCsvLabels = { header: [string, string, string, string, string]; kind: Record<TimelineKind, string> };

/** CSV della cronologia: data (gg/mm/aaaa), fonte, fatto, dettaglio, importo (euro, virgola). Gli eventi senza data vanno in fondo. */
export function timelineCsv(timeline: Timeline, labels: TimelineCsvLabels): string {
  const rows = [...timeline.dated, ...timeline.undated].map((e) => [dateIt(e.date), labels.kind[e.kind], e.title, e.detail, e.amountCents === null ? null : euro(e.amountCents)]);
  return csvDocument([labels.header, ...rows]);
}

/** Voci dell'elenco «da completare prima di consegnare». Ogni voce elenca i nomi coinvolti, se ce ne sono. */
export const CHECKLIST_CODES = [
  "noParty",
  "noLawyerRole",
  "noAsset",
  "noDescription",
  "noDocuments",
  "openRequests",
  "requestsPastDue",
  "documentsWithoutIssueDate",
  "documentsPastValidity",
  "opinionsWithoutDocument",
  "noDeadlines",
] as const;
export type ChecklistCode = (typeof CHECKLIST_CODES)[number];
export type ChecklistItem = { code: ChecklistCode; names: string[] };

export type ChecklistInput = {
  today: string;
  partyCount: number;
  hasLawyerRole: boolean;
  hasAsset: boolean;
  hasDescription: boolean;
  documents: { title: string; issuedOn: string | null; validTo: string | null }[];
  requests: { title: string; status: "requested" | "received" | "not_available"; dueOn: string | null }[];
  opinions: { partyName: string; documentId: string | null }[];
  deadlineCount: number;
};

/** Cosa risulta mancante o da rivedere nei dati della pratica. Non e' un giudizio sulla pratica: e' un promemoria di completezza dei dati. */
export function buildChecklist(input: ChecklistInput): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  const add = (code: ChecklistCode, names: string[] = []) => items.push({ code, names });
  if (input.partyCount === 0) add("noParty");
  else if (!input.hasLawyerRole) add("noLawyerRole");
  if (!input.hasAsset) add("noAsset");
  if (!input.hasDescription) add("noDescription");
  if (input.documents.length === 0) add("noDocuments");
  const open = input.requests.filter((r) => r.status === "requested");
  if (open.length > 0) add("openRequests", open.map((r) => r.title));
  const pastDue = open.filter((r) => r.dueOn !== null && r.dueOn < input.today);
  if (pastDue.length > 0) add("requestsPastDue", pastDue.map((r) => r.title));
  const undated = input.documents.filter((d) => d.issuedOn === null);
  if (undated.length > 0) add("documentsWithoutIssueDate", undated.map((d) => d.title));
  const pastValidity = input.documents.filter((d) => d.validTo !== null && d.validTo < input.today);
  if (pastValidity.length > 0) add("documentsPastValidity", pastValidity.map((d) => d.title));
  const noDoc = input.opinions.filter((o) => o.documentId === null);
  if (noDoc.length > 0) add("opinionsWithoutDocument", noDoc.map((o) => o.partyName));
  if (input.deadlineCount === 0) add("noDeadlines");
  return items;
}
