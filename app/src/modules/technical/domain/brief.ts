import { csvDocument, type CsvCell } from "@/shared/csv";
import { formatCents } from "@/shared/money";

/**
 * Scheda per il tecnico: cio' che il proprietario consegna a un geometra, architetto o ingegnere che prepara un rilievo,
 * una pratica o una perizia. Raccoglie SOLO cio' che e' registrato nell'app (scheda del bene, catasto a storico, documenti,
 * voci del dossier, interventi, garanzie, ispezioni, scadenze, pratiche). Non dice se un bene sia conforme, regolare o
 * completo dal punto di vista edilizio, urbanistico o catastale: elenca cio' che risulta e cio' che non risulta.
 */

/**
 * Categorie documentali (dati di partenza della migrazione 0005) e categorie del dossier (migrazione 0007) di interesse
 * tecnico. Sono i CODICI delle categorie, non valori normativi: l'elenco e' solo la preselezione della scheda.
 */
export const TECHNICAL_DOCUMENT_CATEGORIES = ["cadastral", "building", "systems", "energy", "works"] as const;
export const TECHNICAL_DOSSIER_CATEGORIES = ["cadastre", "building", "habitability", "systems", "works"] as const;

/** Stati del dossier che indicano qualcosa ancora da raccogliere o da rivedere. */
export const OPEN_DOSSIER_STATUSES = ["missing", "requested", "to_verify", "expired"] as const;

export type BriefAsset = {
  id: string;
  name: string;
  kind: string;
  useType: string | null;
  territoryLabel: string;
  locality: string | null;
  address: string | null;
  postalCode: string | null;
  inCondominium: boolean;
  notes: string | null;
  attributes: Record<string, string | number | boolean>;
  cadastral: {
    sheet: string | null;
    parcel: string | null;
    subunit: string | null;
    cadastralCategory: string | null;
    cadastralClass: string | null;
    consistency: string | null;
    incomeCents: number | null;
    validFrom: string | null;
    validTo: string | null;
    notes: string | null;
  }[];
  rights: { holderName: string; rightType: string; quotaNumerator: number; quotaDenominator: number; validFrom: string | null; validTo: string | null }[];
};

export type BriefDocument = { id: string; title: string; categoryId: string; categoryName: string; issuedOn: string | null; validTo: string | null; verificationStatus: string };
export type BriefCategory = { id: string; code: string; name: string };
export type BriefDossierItem = { id: string; title: string; status: string; stale: boolean; categoryCode: string; categoryName: string; documentCount: number; expiredDocumentCount: number };
export type BriefWork = {
  id: string;
  title: string;
  status: string;
  supplierName: string | null;
  scheduledOn: string | null;
  startedOn: string | null;
  completedOn: string | null;
  budgetCents: number | null;
  acceptedQuotesCents: number;
  invoicedCents: number;
  paidCents: number;
  lastPercent: number | null;
};
export type BriefWarranty = { id: string; title: string; startsOn: string | null; endsOn: string; state: string; supplierName: string | null; workTitle: string | null };
export type BriefPlan = { id: string; title: string; intervalMonths: number; nextDueOn: string | null; lastDoneOn: string | null; supplierName: string | null };
export type BriefDeadline = { id: string; title: string; dueOn: string; overdue: boolean };
export type BriefMatter = { id: string; title: string; status: string; openedOn: string; assignees: string[]; openRequests: { title: string; dueOn: string | null; overdue: boolean }[] };

export type BriefSource = {
  asset: BriefAsset;
  categories: BriefCategory[];
  documents: BriefDocument[];
  dossierItems: BriefDossierItem[];
  works: BriefWork[];
  warranties: BriefWarranty[];
  plans: BriefPlan[];
  deadlines: BriefDeadline[];
  matters: BriefMatter[];
};

export type BriefDocumentRow = BriefDocument & { expired: boolean };

export type TechnicalBrief = {
  today: string;
  asset: BriefAsset;
  documents: {
    groups: { category: BriefCategory; documents: BriefDocumentRow[] }[];
    /** Categorie tecniche in cui non risulta alcun documento collegato al bene. */
    emptyCategories: BriefCategory[];
    /** Documenti collegati al bene in categorie non tecniche (solo il numero: stanno nella scheda del bene). */
    otherCount: number;
    expiredCount: number;
    /** Identificativi delle categorie tecniche, per preselezionarle nel pacchetto di condivisione. */
    technicalCategoryIds: string[];
  };
  dossier: { total: number; counts: Record<string, number>; toCollect: BriefDossierItem[] };
  works: { rows: BriefWork[]; totals: { acceptedQuotesCents: number; invoicedCents: number; paidCents: number } };
  warranties: BriefWarranty[];
  plans: BriefPlan[];
  deadlines: BriefDeadline[];
  matters: BriefMatter[];
};

/** Data usata per ordinare un intervento: la piu' vicina al momento in cui e' avvenuto (fine, inizio, poi data prevista). */
export const workDate = (w: Pick<BriefWork, "completedOn" | "startedOn" | "scheduledOn">): string | null => w.completedOn ?? w.startedOn ?? w.scheduledOn;

const isTechnicalDocumentCategory = (code: string): boolean => (TECHNICAL_DOCUMENT_CATEGORIES as readonly string[]).includes(code);
const isTechnicalDossierCategory = (code: string): boolean => (TECHNICAL_DOSSIER_CATEGORIES as readonly string[]).includes(code);

export function buildBrief(source: BriefSource, today: string): TechnicalBrief {
  const technical = source.categories.filter((c) => isTechnicalDocumentCategory(c.code));
  const technicalIds = new Set(technical.map((c) => c.id));
  const rows: BriefDocumentRow[] = source.documents.map((d) => ({ ...d, expired: d.validTo !== null && d.validTo < today }));
  const groups = technical.map((category) => ({
    category,
    documents: rows.filter((d) => d.categoryId === category.id).sort((a, b) => (b.issuedOn ?? "").localeCompare(a.issuedOn ?? "") || a.title.localeCompare(b.title, "it")),
  }));

  const dossierItems = source.dossierItems.filter((i) => isTechnicalDossierCategory(i.categoryCode));
  const counts: Record<string, number> = {};
  for (const item of dossierItems) counts[item.status] = (counts[item.status] ?? 0) + 1;
  const toCollect = dossierItems.filter((i) => (OPEN_DOSSIER_STATUSES as readonly string[]).includes(i.status) || i.stale);

  const works = [...source.works].sort((a, b) => (workDate(b) ?? "").localeCompare(workDate(a) ?? "") || a.title.localeCompare(b.title, "it"));
  const sum = (pick: (w: BriefWork) => number) => works.reduce((n, w) => n + pick(w), 0);

  return {
    today,
    asset: source.asset,
    documents: {
      groups,
      emptyCategories: groups.filter((g) => g.documents.length === 0).map((g) => g.category),
      otherCount: rows.filter((d) => !technicalIds.has(d.categoryId)).length,
      expiredCount: groups.reduce((n, g) => n + g.documents.filter((d) => d.expired).length, 0),
      technicalCategoryIds: technical.map((c) => c.id),
    },
    dossier: { total: dossierItems.length, counts, toCollect },
    works: { rows: works, totals: { acceptedQuotesCents: sum((w) => w.acceptedQuotesCents), invoicedCents: sum((w) => w.invoicedCents), paidCents: sum((w) => w.paidCents) } },
    warranties: source.warranties,
    plans: source.plans,
    deadlines: [...source.deadlines].sort((a, b) => a.dueOn.localeCompare(b.dueOn)),
    matters: source.matters,
  };
}

/** Etichette italiane dei codici, fornite da chi chiama (stanno in messages/it.json). */
export type BriefCsvLabels = {
  kind: (code: string) => string;
  use: (code: string) => string;
  right: (code: string) => string;
  workStatus: (code: string) => string;
  matterStatus: (code: string) => string;
  dossierStatus: (code: string) => string;
  verification: (code: string) => string;
  warrantyState: (code: string) => string;
};

const euros = (cents: number | null): string => (cents === null ? "" : formatCents(cents));
const dateCell = (value: string | null): string => (value ? value.split("-").reverse().join("/") : "");
const yesNo = (v: boolean): string => (v ? "sì" : "no");

/** La scheda in CSV (UTF-8 con BOM, «;»): una sezione dopo l'altra, ciascuna con la sua intestazione. */
export function briefCsv(brief: TechnicalBrief, labels: BriefCsvLabels): string {
  const a = brief.asset;
  const section = (title: string, header: CsvCell[], body: CsvCell[][]): CsvCell[][] => [[], [title], header, ...body];
  const rows: CsvCell[][] = [
    [`Scheda per il tecnico: ${a.name}`],
    [`Preparata il ${dateCell(brief.today)} con i dati registrati nell'app. Non attesta la conformità edilizia, urbanistica o catastale: elenca ciò che risulta.`],
    ...section(
      "Bene",
      ["Campo", "Valore"],
      [
        ["Denominazione", a.name],
        ["Tipo", labels.kind(a.kind)],
        ["Uso", a.useType ? labels.use(a.useType) : ""],
        ["Comune", a.territoryLabel],
        ["Località", a.locality],
        ["Indirizzo", [a.address, a.postalCode].filter(Boolean).join(" – ")],
        ["In condominio", yesNo(a.inCondominium)],
        ["Note", a.notes],
      ],
    ),
    ...section("Caratteristiche tecniche", ["Nome", "Valore"], Object.entries(a.attributes).map(([k, v]): CsvCell[] => [k, typeof v === "boolean" ? yesNo(v) : v])),
    ...section(
      "Dati catastali (storico)",
      ["Foglio", "Particella", "Subalterno", "Categoria", "Classe", "Consistenza", "Rendita (€)", "Dal", "Al", "Note"],
      a.cadastral.map((c): CsvCell[] => [c.sheet, c.parcel, c.subunit, c.cadastralCategory, c.cadastralClass, c.consistency, euros(c.incomeCents), dateCell(c.validFrom), dateCell(c.validTo), c.notes]),
    ),
    ...section(
      "Titolarità registrata",
      ["Titolare", "Diritto", "Quota", "Dal", "Al"],
      a.rights.map((r): CsvCell[] => [r.holderName, labels.right(r.rightType), `${r.quotaNumerator}/${r.quotaDenominator}`, dateCell(r.validFrom), dateCell(r.validTo)]),
    ),
    ...section(
      "Documenti tecnici collegati al bene",
      ["Categoria", "Titolo", "Emesso il", "Valido fino al", "Verifica", "Scaduto alla data della scheda"],
      brief.documents.groups.flatMap((g) => g.documents.map((d): CsvCell[] => [g.category.name, d.title, dateCell(d.issuedOn), dateCell(d.validTo), labels.verification(d.verificationStatus), yesNo(d.expired)])),
    ),
    ...section(
      "Categorie tecniche senza documenti collegati",
      ["Categoria"],
      brief.documents.emptyCategories.map((c): CsvCell[] => [c.name]),
    ),
    ...section(
      "Voci del dossier da raccogliere o rivedere",
      ["Categoria", "Voce", "Stato", "Da rivedere", "Documenti collegati"],
      brief.dossier.toCollect.map((i): CsvCell[] => [i.categoryName, i.title, labels.dossierStatus(i.status), yesNo(i.stale), i.documentCount]),
    ),
    ...section(
      "Storico degli interventi",
      ["Data", "Intervento", "Stato", "Fornitore", "Previsto (€)", "Preventivi accettati (€)", "Fatturato (€)", "Pagato (€)", "Avanzamento (%)"],
      brief.works.rows.map((w): CsvCell[] => [dateCell(workDate(w)), w.title, labels.workStatus(w.status), w.supplierName, euros(w.budgetCents), euros(w.acceptedQuotesCents), euros(w.invoicedCents), euros(w.paidCents), w.lastPercent]),
    ),
    ["Totali registrati", "", "", "", "", euros(brief.works.totals.acceptedQuotesCents), euros(brief.works.totals.invoicedCents), euros(brief.works.totals.paidCents)],
    ...section(
      "Garanzie registrate",
      ["Garanzia", "Intervento", "Dal", "Al", "Situazione", "Fornitore"],
      brief.warranties.map((w): CsvCell[] => [w.title, w.workTitle, dateCell(w.startsOn), dateCell(w.endsOn), labels.warrantyState(w.state), w.supplierName]),
    ),
    ...section(
      "Ispezioni periodiche registrate",
      ["Ispezione", "Ogni (mesi)", "Prossima", "Ultima eseguita", "Fornitore"],
      brief.plans.map((p): CsvCell[] => [p.title, p.intervalMonths, dateCell(p.nextDueOn), dateCell(p.lastDoneOn), p.supplierName]),
    ),
    ...section(
      "Scadenze aperte del bene",
      ["Scadenza", "Data", "In ritardo"],
      brief.deadlines.map((d): CsvCell[] => [d.title, dateCell(d.dueOn), yesNo(d.overdue)]),
    ),
    ...section(
      "Pratiche aperte del bene",
      ["Pratica", "Stato", "Aperta il", "Contatti", "Richieste di documenti aperte"],
      brief.matters.map((m): CsvCell[] => [m.title, labels.matterStatus(m.status), dateCell(m.openedOn), m.assignees.join(" / "), m.openRequests.map((r) => r.title).join(" / ")]),
    ),
  ];
  return csvDocument(rows);
}
