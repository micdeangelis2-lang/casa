import { addDays, daysBetween, type PeriodState } from "@/shared/dates";

/**
 * «Da controllare»: cosa, nei dati inseriti, merita uno sguardo (date superate, scadenze vicine, pagamenti senza prova, voci
 * senza documento, backup mancante...). Dice solo cio' che risulta dai dati: non stabilisce se una situazione sia irregolare
 * o se vada fatto qualcosa per legge.
 */

export const ATTENTION_AREAS = ["deadlines", "documents", "taxes", "condominium", "maintenance", "insurance", "lettings", "dossier", "backup"] as const;
export type AttentionArea = (typeof ATTENTION_AREAS)[number];

export type Severity = "high" | "normal";

export type Finding = {
  /** Unico nell'elenco: area + tipo + identificativo dell'elemento. */
  id: string;
  area: AttentionArea;
  /** Chiave del messaggio (`attention.kinds.<kind>`). */
  kind: string;
  severity: Severity;
  /** Valori per il testo del messaggio. */
  params: Record<string, string | number>;
  href: string;
  /** La data a cui si riferisce (per ordinare), se c'e'. */
  date: string | null;
};

/** I dati grezzi letti dai moduli: il calcolo dei risultati e' puro e si prova senza database. */
export type Sources = {
  today: string;
  overdueDeadlines: number;
  soonDeadlines: number;
  documents: { id: string; title: string; validTo: string | null }[];
  obligations: { id: string; title: string; assetName: string; overdue: boolean; dueOn: string | null; paymentsWithoutProof: number }[];
  returns: { id: string; title: string; overdue: boolean; dueOn: string | null }[];
  condominiums: { id: string; name: string; unpaidOverdue: { count: number; cents: number; oldestDueOn: string | null }; contracts: { title: string; validTo: string | null }[] }[];
  works: { id: string; title: string; unpaidCents: number; expiredQuotes: number }[];
  warranties: { id: string; title: string; state: PeriodState; endsOn: string }[];
  policies: { id: string; title: string; state: PeriodState; endsOn: string | null; nextPremium: { dueOn: string; amountCents: number; overdue: boolean } | null }[];
  lettings: {
    id: string;
    title: string;
    status: string;
    endsOn: string | null;
    overdueRents: number;
    reports: { title: string; dueOn: string | null; overdue: boolean }[];
    codes: { label: string; validUntil: string | null; state: PeriodState }[];
  }[];
  dossiers: { assetId: string; assetName: string; missing: number; stale: number }[];
  backup: { configured: boolean; lastSuccessOn: string | null; lastFailed: boolean };
};

/** Entro quanti giorni una data si considera «vicina» per documenti, polizze, garanzie e codici. */
export const SOON_DAYS = 60;
/** Entro quanti giorni una scadenza si considera «imminente». */
export const DEADLINE_SOON_DAYS = 14;
/** Dopo quanti giorni senza un backup riuscito lo si segnala. */
export const BACKUP_STALE_DAYS = 7;

export function computeFindings(s: Sources): Finding[] {
  const out: Finding[] = [];
  const add = (f: Omit<Finding, "id"> & { key: string }) => out.push({ id: `${f.area}:${f.kind}:${f.key}`, area: f.area, kind: f.kind, severity: f.severity, params: f.params, href: f.href, date: f.date });
  const soon = (date: string) => date >= s.today && date <= addDays(s.today, SOON_DAYS);

  if (s.overdueDeadlines > 0) add({ key: "all", area: "deadlines", kind: "deadlines_overdue", severity: "high", params: { count: s.overdueDeadlines }, href: "/scadenze?vista=ritardo", date: null });
  if (s.soonDeadlines > 0) add({ key: "all", area: "deadlines", kind: "deadlines_soon", severity: "normal", params: { count: s.soonDeadlines, days: DEADLINE_SOON_DAYS }, href: "/scadenze", date: null });

  for (const d of s.documents) {
    if (!d.validTo) continue;
    if (d.validTo < s.today) add({ key: d.id, area: "documents", kind: "document_expired", severity: "normal", params: { title: d.title, date: d.validTo }, href: `/documenti/${d.id}`, date: d.validTo });
    else if (soon(d.validTo)) add({ key: d.id, area: "documents", kind: "document_expiring", severity: "normal", params: { title: d.title, date: d.validTo }, href: `/documenti/${d.id}`, date: d.validTo });
  }

  for (const o of s.obligations) {
    if (o.overdue) add({ key: o.id, area: "taxes", kind: "tax_overdue", severity: "high", params: { title: o.title, asset: o.assetName, date: o.dueOn ?? "" }, href: `/tributi/${o.id}`, date: o.dueOn });
    if (o.paymentsWithoutProof > 0) add({ key: o.id, area: "taxes", kind: "tax_proof_missing", severity: "normal", params: { title: o.title, asset: o.assetName, count: o.paymentsWithoutProof }, href: `/tributi/${o.id}`, date: null });
  }
  for (const r of s.returns) if (r.overdue) add({ key: r.id, area: "taxes", kind: "return_overdue", severity: "high", params: { title: r.title, date: r.dueOn ?? "" }, href: "/tributi/dichiarazioni", date: r.dueOn });

  for (const c of s.condominiums) {
    if (c.unpaidOverdue.count > 0) add({ key: c.id, area: "condominium", kind: "condo_rates_overdue", severity: "high", params: { condo: c.name, count: c.unpaidOverdue.count, cents: c.unpaidOverdue.cents }, href: `/condominio/${c.id}?sezione=esercizi`, date: c.unpaidOverdue.oldestDueOn });
    for (const [i, contract] of c.contracts.entries()) {
      if (!contract.validTo) continue;
      const kind = contract.validTo < s.today ? "condo_contract_expired" : soon(contract.validTo) ? "condo_contract_expiring" : null;
      if (kind) add({ key: `${c.id}-${i}`, area: "condominium", kind, severity: "normal", params: { title: contract.title, condo: c.name, date: contract.validTo }, href: `/condominio/${c.id}?sezione=contratti`, date: contract.validTo });
    }
  }

  for (const w of s.works) {
    if (w.unpaidCents > 0) add({ key: w.id, area: "maintenance", kind: "work_invoice_unpaid", severity: "normal", params: { title: w.title, cents: w.unpaidCents }, href: `/manutenzioni/${w.id}`, date: null });
    if (w.expiredQuotes > 0) add({ key: w.id, area: "maintenance", kind: "work_quote_expired", severity: "normal", params: { title: w.title, count: w.expiredQuotes }, href: `/manutenzioni/${w.id}`, date: null });
  }
  for (const w of s.warranties) if (w.state === "expiring") add({ key: w.id, area: "maintenance", kind: "warranty_expiring", severity: "normal", params: { title: w.title, date: w.endsOn }, href: "/manutenzioni?sezione=warranties", date: w.endsOn });

  for (const p of s.policies) {
    if (p.nextPremium?.overdue) add({ key: p.id, area: "insurance", kind: "premium_overdue", severity: "high", params: { title: p.title, date: p.nextPremium.dueOn, cents: p.nextPremium.amountCents }, href: `/assicurazioni/${p.id}`, date: p.nextPremium.dueOn });
    if (p.state === "expiring" && p.endsOn) add({ key: p.id, area: "insurance", kind: "policy_expiring", severity: "normal", params: { title: p.title, date: p.endsOn }, href: `/assicurazioni/${p.id}`, date: p.endsOn });
    if (p.state === "expired" && p.endsOn) add({ key: p.id, area: "insurance", kind: "policy_expired", severity: "normal", params: { title: p.title, date: p.endsOn }, href: `/assicurazioni/${p.id}`, date: p.endsOn });
  }

  for (const l of s.lettings) {
    if (l.overdueRents > 0) add({ key: l.id, area: "lettings", kind: "rent_overdue", severity: "high", params: { title: l.title, count: l.overdueRents }, href: `/locazioni/${l.id}`, date: null });
    if (l.status === "active" && l.endsOn && l.endsOn < s.today) add({ key: l.id, area: "lettings", kind: "letting_end_passed", severity: "normal", params: { title: l.title, date: l.endsOn }, href: `/locazioni/${l.id}`, date: l.endsOn });
    for (const [i, r] of l.reports.entries()) if (r.overdue) add({ key: `${l.id}-${i}`, area: "lettings", kind: "report_overdue", severity: "high", params: { title: r.title, letting: l.title, date: r.dueOn ?? "" }, href: `/locazioni/${l.id}`, date: r.dueOn });
    for (const [i, c] of l.codes.entries()) {
      if (c.state === "expired" && c.validUntil) add({ key: `${l.id}-${i}`, area: "lettings", kind: "code_expired", severity: "normal", params: { label: c.label, letting: l.title, date: c.validUntil }, href: `/locazioni/${l.id}`, date: c.validUntil });
      if (c.state === "expiring" && c.validUntil) add({ key: `${l.id}-${i}`, area: "lettings", kind: "code_expiring", severity: "normal", params: { label: c.label, letting: l.title, date: c.validUntil }, href: `/locazioni/${l.id}`, date: c.validUntil });
    }
  }

  for (const d of s.dossiers) {
    if (d.missing > 0) add({ key: d.assetId, area: "dossier", kind: "dossier_missing", severity: "normal", params: { asset: d.assetName, count: d.missing }, href: `/immobili/${d.assetId}/dossier`, date: null });
    if (d.stale > 0) add({ key: `${d.assetId}-stale`, area: "dossier", kind: "dossier_stale", severity: "normal", params: { asset: d.assetName, count: d.stale }, href: `/immobili/${d.assetId}/dossier`, date: null });
  }

  const b = s.backup;
  if (!b.configured) add({ key: "config", area: "backup", kind: "backup_not_configured", severity: "high", params: {}, href: "/impostazioni/backup", date: null });
  else if (b.lastSuccessOn === null) add({ key: "never", area: "backup", kind: "backup_never", severity: "high", params: {}, href: "/impostazioni/backup", date: null });
  else if (daysBetween(b.lastSuccessOn, s.today) > BACKUP_STALE_DAYS) add({ key: "old", area: "backup", kind: "backup_old", severity: "high", params: { days: daysBetween(b.lastSuccessOn, s.today), date: b.lastSuccessOn }, href: "/impostazioni/backup", date: b.lastSuccessOn });
  if (b.configured && b.lastFailed) add({ key: "failed", area: "backup", kind: "backup_failed", severity: "high", params: {}, href: "/impostazioni/backup", date: null });

  // Prima le priorita' alte, poi per data (le piu' vecchie prima, senza data in fondo), poi per area e tipo: ordine stabile.
  const areaOrder = (a: AttentionArea) => ATTENTION_AREAS.indexOf(a);
  return out.sort((a, b2) => (a.severity === b2.severity ? 0 : a.severity === "high" ? -1 : 1) || (a.date ?? "9999").localeCompare(b2.date ?? "9999") || areaOrder(a.area) - areaOrder(b2.area) || a.id.localeCompare(b2.id));
}

/** Quanti risultati per priorita' (per il riquadro della panoramica). */
export const countBySeverity = (findings: Finding[]): Record<Severity, number> => ({ high: findings.filter((f) => f.severity === "high").length, normal: findings.filter((f) => f.severity === "normal").length });
