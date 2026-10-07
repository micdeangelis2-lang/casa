/**
 * Scheda di presentazione per l'agente immobiliare: logica pura. Riordina dati GIA' registrati (nessuna stima di valore, nessun
 * verdetto di commerciabilita' o regolarita'). Rispetta la riservatezza: i documenti piu' riservati del livello scelto non si
 * elencano (se ne mostra solo il numero) e i nomi di terzi (titolari, inquilini) restano fuori salvo scelta esplicita.
 */

export const LEVELS = ["ordinary", "reserved", "highly_reserved"] as const;
export type Level = (typeof LEVELS)[number];
const above = (doc: Level, cap: Level) => LEVELS.indexOf(doc) > LEVELS.indexOf(cap);

export type SheetDocument = { id: string; title: string; categoryId: string; confidentiality: Level; issuedOn: string | null; validTo: string | null; verificationStatus: string };
export type SheetCategory = { id: string; name: string };

export type DocumentGroup = { category: SheetCategory; documents: SheetDocument[]; withheld: number };

export type ChecklistItem =
  | { kind: "category_empty"; categoryName: string }
  | { kind: "category_withheld"; categoryName: string; count: number }
  | { kind: "document_expired"; title: string; validTo: string }
  | { kind: "dossier_open"; title: string; status: string };

export type DossierLine = { title: string; status: string };

/**
 * Documenti per categoria (solo quelli entro il livello scelto) e elenco «da preparare»: categorie scelte senza documenti
 * registrati, categorie con soli documenti oltre il livello, documenti con data di validita' passata, voci del dossier
 * mancanti, richieste o scadute. `focusCategoryIds` = null: tutte le categorie.
 */
export function buildDocumentSection(args: { documents: SheetDocument[]; categories: SheetCategory[]; cap: Level; focusCategoryIds: string[] | null; dossier: DossierLine[]; today: string }) {
  const { documents, categories, cap, today } = args;
  const focus = args.focusCategoryIds === null ? categories : categories.filter((c) => args.focusCategoryIds!.includes(c.id));
  const groups: DocumentGroup[] = categories
    .map((category) => {
      const own = documents.filter((d) => d.categoryId === category.id);
      return { category, documents: own.filter((d) => !above(d.confidentiality, cap)), withheld: own.filter((d) => above(d.confidentiality, cap)).length };
    })
    .filter((g) => g.documents.length > 0 || g.withheld > 0);

  const checklist: ChecklistItem[] = [];
  for (const c of focus) {
    const g = groups.find((x) => x.category.id === c.id);
    if (!g) checklist.push({ kind: "category_empty", categoryName: c.name });
    else if (g.documents.length === 0) checklist.push({ kind: "category_withheld", categoryName: c.name, count: g.withheld });
  }
  for (const g of groups)
    for (const d of g.documents) if (d.validTo !== null && d.validTo < today) checklist.push({ kind: "document_expired", title: d.title, validTo: d.validTo });
  for (const i of args.dossier) if (["missing", "requested", "expired"].includes(i.status)) checklist.push({ kind: "dossier_open", title: i.title, status: i.status });
  return { groups, checklist, withheldTotal: groups.reduce((n, g) => n + g.withheld, 0) };
}

export type InstallmentLite = { assetId: string; amountCents: number; paidCents: number };
export type YearLite = { label: string; budgets: { kind: string; title: string; installments: InstallmentLite[] }[] };

/** Per esercizio, somma delle rate dei preventivi ORDINARI intestate all'immobile (come registrate: non sono le cifre dell'amministratore). */
export function ordinaryExpenses(years: YearLite[], assetId: string) {
  return years.flatMap((y) =>
    y.budgets
      .filter((b) => b.kind === "ordinary")
      .flatMap((b) => {
        const mine = b.installments.filter((i) => i.assetId === assetId);
        if (mine.length === 0) return [];
        return [{ yearLabel: y.label, title: b.title, dueCents: mine.reduce((n, i) => n + i.amountCents, 0), paidCents: mine.reduce((n, i) => n + i.paidCents, 0) }];
      }),
  );
}

export type WorkLite = { id: string; title: string; status: string; scheduledOn: string | null; startedOn: string | null; completedOn: string | null; supplierName: string | null };

/** Interventi dal piu' recente; la data di riferimento e' la fine, altrimenti l'inizio, altrimenti la data prevista. Senza date, in fondo. */
export function recentWorks(works: WorkLite[], limit = 10) {
  const dateOf = (w: WorkLite) => w.completedOn ?? w.startedOn ?? w.scheduledOn;
  return works
    .filter((w) => w.status !== "cancelled")
    .sort((a, b) => (dateOf(b) ?? "").localeCompare(dateOf(a) ?? "") || a.title.localeCompare(b.title))
    .slice(0, limit)
    .map((w) => ({ ...w, referenceOn: dateOf(w) }));
}

/** Indirizzo (relativo) della condivisione gia' impostata per l'agente: tetto «ordinario» (esclude riservati), categorie scelte. */
export function agentPackageHref(args: { assetId: string; categoryIds: string[]; contactId?: string | null; level?: Level }): string {
  const p = new URLSearchParams();
  p.set("destinatario", "agent");
  p.set("livello", args.level ?? "ordinary");
  p.append("immobile", args.assetId);
  for (const id of args.categoryIds) p.append("categoria", id);
  if (args.contactId) p.set("contatto", args.contactId);
  p.set("mostra", "1");
  return `/condivisione/nuovo?${p.toString()}`;
}
