import { daysBetween } from "@/shared/dates";
import { allocateOwnerParts, checkVotes, type BudgetScopeName } from "./millesimi";

/**
 * Viste di controllo per il proprietario che dialoga con l'amministratore: versamenti rispetto alle rate, confronto con il
 * consuntivo, documenti che risultano o non risultano consegnati, registro delle delibere. Sono funzioni PURE sui dati
 * inseriti dal proprietario: dicono cosa RISULTA, non cosa e' dovuto, valido o in regola.
 */

export type BudgetKindName = "ordinary" | "extraordinary" | "final";

export type StatementInstallment = { assetId: string; assetName: string; dueOn: string; amountCents: number; paidCents: number };
export type StatementBudget = { id: string; title: string; kind: BudgetKindName; totalCents: number; tableId: string | null; documentId: string | null; installments: StatementInstallment[]; scope?: BudgetScopeName };
export type StatementYear = { id: string; label: string; startsOn: string; endsOn: string; budgets: StatementBudget[] };

export type StatementLine = {
  budgetId: string;
  budgetTitle: string;
  kind: BudgetKindName;
  assetId: string;
  assetName: string;
  installments: number;
  amountCents: number;
  paidCents: number;
  /** Rate registrate meno versato registrato (negativo se risulta versato di piu'). */
  residualCents: number;
  /** Parte non versata delle rate la cui scadenza e' gia' passata. */
  overdueCents: number;
  nextDueOn: string | null;
};

export type FinalComparison = {
  finalBudgetId: string;
  finalTitle: string;
  assetId: string;
  assetName: string;
  /** Quota del consuntivo ripartita con la tabella (ipotesi: stessa regola delle rate). */
  quotaCents: number;
  /** Versato sulle rate dei preventivi (ordinari e straordinari) dello stesso esercizio. */
  paidOnBudgetsCents: number;
  /** Quota meno versato: positivo se la quota supera il versato registrato. */
  differenceCents: number;
};

export type YearStatement = {
  yearId: string;
  label: string;
  startsOn: string;
  endsOn: string;
  lines: StatementLine[];
  budgetsTotalCents: number;
  finalTotalCents: number;
  /** Consuntivo meno preventivi, solo se esistono entrambi. */
  finalVsBudgetsCents: number | null;
  comparisons: FinalComparison[];
  amountCents: number;
  paidCents: number;
  overdueCents: number;
  /** Tabelle usate dai preventivi la cui somma non e' 1000: la ripartizione riguarda solo le unita' registrate. */
  tablesNotThousand: string[];
};

export type TableShares = { name: string; shares: { assetId: string; milli: number }[]; /** Somma dei millesimi degli altri condomini registrati per la tabella. */ othersMilli?: number };

const unpaid = (i: { amountCents: number; paidCents: number }) => Math.max(0, i.amountCents - i.paidCents);

export function yearStatement(year: StatementYear, tables: Map<string, TableShares>, today: string): YearStatement {
  const lines: StatementLine[] = [];
  for (const b of year.budgets) {
    const byAsset = new Map<string, StatementInstallment[]>();
    for (const i of b.installments) byAsset.set(i.assetId, [...(byAsset.get(i.assetId) ?? []), i]);
    for (const [assetId, rows] of byAsset) {
      const open = rows.filter((r) => r.paidCents < r.amountCents).map((r) => r.dueOn).sort();
      lines.push({
        budgetId: b.id,
        budgetTitle: b.title,
        kind: b.kind,
        assetId,
        assetName: rows[0]!.assetName,
        installments: rows.length,
        amountCents: rows.reduce((n, r) => n + r.amountCents, 0),
        paidCents: rows.reduce((n, r) => n + r.paidCents, 0),
        residualCents: rows.reduce((n, r) => n + r.amountCents - r.paidCents, 0),
        overdueCents: rows.filter((r) => r.dueOn < today).reduce((n, r) => n + unpaid(r), 0),
        nextDueOn: open[0] ?? null,
      });
    }
  }
  lines.sort((a, b) => a.budgetTitle.localeCompare(b.budgetTitle, "it") || a.assetName.localeCompare(b.assetName, "it"));

  const finals = year.budgets.filter((b) => b.kind === "final");
  const others = year.budgets.filter((b) => b.kind !== "final");
  const budgetsTotalCents = others.reduce((n, b) => n + b.totalCents, 0);
  const finalTotalCents = finals.reduce((n, b) => n + b.totalCents, 0);

  const comparisons: FinalComparison[] = [];
  for (const f of finals) {
    const table = f.tableId ? tables.get(f.tableId) : undefined;
    if (!table || table.shares.length === 0) continue;
    const parts = allocateOwnerParts(f.totalCents, table.shares.map((s) => s.milli), f.scope ?? "owner_only", table.othersMilli ?? 0);
    table.shares.forEach((s, idx) => {
      const rows = others.flatMap((b) => b.installments).filter((i) => i.assetId === s.assetId);
      const paid = rows.reduce((n, r) => n + r.paidCents, 0);
      const name = rows[0]?.assetName ?? f.installments.find((i) => i.assetId === s.assetId)?.assetName ?? "";
      comparisons.push({ finalBudgetId: f.id, finalTitle: f.title, assetId: s.assetId, assetName: name, quotaCents: parts[idx]!, paidOnBudgetsCents: paid, differenceCents: parts[idx]! - paid });
    });
  }

  const usedTables = new Set(year.budgets.map((b) => b.tableId).filter((x): x is string => x !== null));
  const tablesNotThousand = [...usedTables].flatMap((id) => {
    const t = tables.get(id);
    return t && t.shares.reduce((n, s) => n + s.milli, 0) !== 10_000_000 ? [t.name] : [];
  });

  return {
    yearId: year.id,
    label: year.label,
    startsOn: year.startsOn,
    endsOn: year.endsOn,
    lines,
    budgetsTotalCents,
    finalTotalCents,
    finalVsBudgetsCents: finals.length > 0 && others.length > 0 ? finalTotalCents - budgetsTotalCents : null,
    comparisons,
    amountCents: lines.reduce((n, l) => n + l.amountCents, 0),
    paidCents: lines.reduce((n, l) => n + l.paidCents, 0),
    overdueCents: lines.reduce((n, l) => n + l.overdueCents, 0),
    tablesNotThousand,
  };
}

// ---------------------------------------------------------------------------------------------- documenti ricevuti

export const DELIVERY_KINDS = [
  "no_convocation",
  "no_minutes",
  "budget_no_document",
  "year_ended_no_final",
  "year_no_budget",
  "contract_no_document",
  "contract_ended",
  "no_regulation",
  "no_millesimal_table",
  "no_policy",
] as const;
export type DeliveryKind = (typeof DELIVERY_KINDS)[number];

export type DeliveryFact = {
  kind: DeliveryKind;
  /** Testo del riferimento (titolo, esercizio, data), mai un importo. */
  subject: string;
  /** Una data utile al riferimento (assemblea, fine esercizio, scadenza). */
  date: string | null;
  /** Giorni trascorsi dalla data, se ha senso. */
  daysSince: number | null;
  section: "anagrafica" | "millesimi" | "esercizi" | "assemblee" | "lavori" | "segnalazioni" | "contratti" | "documenti";
  href: string;
};

export type DeliveryInput = {
  condominiumId: string;
  meetings: { id: string; kind: string; status: string; meetingOn: string; convocationDocumentId: string | null; minutesDocumentId: string | null }[];
  years: { id: string; label: string; endsOn: string; budgets: { title: string; kind: BudgetKindName; documentId: string | null }[] }[];
  contracts: { title: string; validTo: string | null; documentId: string | null }[];
  documentKinds: string[];
  tableCount: number;
  /** Polizze non archiviate collegate ad almeno un immobile del condominio. */
  activePolicyCount: number;
  memberCount: number;
};

/** Cio' che non risulta tra i dati e i documenti registrati. Non dice cosa l'amministratore sia tenuto a consegnare. */
export function deliveryFacts(i: DeliveryInput, today: string): DeliveryFact[] {
  const base = `/condominio/${i.condominiumId}`;
  const out: DeliveryFact[] = [];
  const add = (f: Omit<DeliveryFact, "href" | "daysSince"> & { daysSince?: number | null }) => out.push({ ...f, daysSince: f.daysSince ?? null, href: `${base}?sezione=${f.section}` });

  for (const m of i.meetings) {
    if (m.status === "cancelled") continue;
    if (!m.convocationDocumentId) add({ kind: "no_convocation", subject: m.meetingOn, date: m.meetingOn, section: "assemblee" });
    if (m.status === "held" && !m.minutesDocumentId) add({ kind: "no_minutes", subject: m.meetingOn, date: m.meetingOn, daysSince: Math.max(0, daysBetween(m.meetingOn, today)), section: "assemblee" });
  }
  for (const y of i.years) {
    if (y.budgets.length === 0) add({ kind: "year_no_budget", subject: y.label, date: y.endsOn, section: "esercizi" });
    for (const b of y.budgets) if (!b.documentId) add({ kind: "budget_no_document", subject: `${y.label} – ${b.title}`, date: null, section: "esercizi" });
    if (y.endsOn < today && y.budgets.length > 0 && !y.budgets.some((b) => b.kind === "final")) add({ kind: "year_ended_no_final", subject: y.label, date: y.endsOn, daysSince: daysBetween(y.endsOn, today), section: "esercizi" });
  }
  for (const c of i.contracts) {
    if (!c.documentId) add({ kind: "contract_no_document", subject: c.title, date: c.validTo, section: "contratti" });
    if (c.validTo && c.validTo < today) add({ kind: "contract_ended", subject: c.title, date: c.validTo, daysSince: daysBetween(c.validTo, today), section: "contratti" });
  }
  if (!i.documentKinds.includes("regulation")) add({ kind: "no_regulation", subject: "", date: null, section: "documenti" });
  if (i.tableCount === 0 && !i.documentKinds.includes("millesimal")) add({ kind: "no_millesimal_table", subject: "", date: null, section: "millesimi" });
  if (i.memberCount > 0 && i.activePolicyCount === 0) add({ kind: "no_policy", subject: "", date: null, section: "anagrafica" });
  return out;
}

// ---------------------------------------------------------------------------------------------- registro delibere

export type ResolutionInput = {
  condominiumId: string;
  condominiumName: string;
  meetingId: string;
  meetingOn: string;
  meetingKind: string;
  meetingStatus: string;
  resolution: { id: string; title: string; outcome: string; agendaTitle: string | null; votesFor: number | null; votesAgainst: number | null; votesAbstain: number | null; threshold: number | null; deadlineId: string | null; budgetId: string | null };
  workIds: string[];
};

export type ResolutionRegisterRow = {
  id: string;
  condominiumId: string;
  condominiumName: string;
  meetingId: string;
  meetingOn: string;
  meetingKind: string;
  meetingStatus: string;
  title: string;
  agendaTitle: string | null;
  outcome: string;
  votesFor: number | null;
  threshold: number | null;
  /** Le note di controllo sui numeri registrati (vedi checkVotes), o null. */
  voteNote: string | null;
  hasDeadline: boolean;
  hasBudget: boolean;
  workCount: number;
  hasFollowUp: boolean;
};

export function resolutionRegister(inputs: ResolutionInput[]): ResolutionRegisterRow[] {
  return inputs
    .map((i): ResolutionRegisterRow => {
      const r = i.resolution;
      const hasDeadline = r.deadlineId !== null;
      const hasBudget = r.budgetId !== null;
      return {
        id: r.id,
        condominiumId: i.condominiumId,
        condominiumName: i.condominiumName,
        meetingId: i.meetingId,
        meetingOn: i.meetingOn,
        meetingKind: i.meetingKind,
        meetingStatus: i.meetingStatus,
        title: r.title,
        agendaTitle: r.agendaTitle,
        outcome: r.outcome,
        votesFor: r.votesFor,
        threshold: r.threshold,
        voteNote: checkVotes({ outcome: r.outcome, votesFor: r.votesFor, votesAgainst: r.votesAgainst, votesAbstain: r.votesAbstain, threshold: r.threshold }).attention,
        hasDeadline,
        hasBudget,
        workCount: i.workIds.length,
        hasFollowUp: hasDeadline || hasBudget || i.workIds.length > 0,
      };
    })
    .sort((a, b) => b.meetingOn.localeCompare(a.meetingOn) || a.title.localeCompare(b.title, "it"));
}

export type RegisterFilter = { condominiumId?: string; outcome?: string; year?: number; withoutFollowUp?: boolean };

export function filterRegister(rows: ResolutionRegisterRow[], f: RegisterFilter): ResolutionRegisterRow[] {
  return rows.filter(
    (r) =>
      (!f.condominiumId || r.condominiumId === f.condominiumId) &&
      (!f.outcome || r.outcome === f.outcome) &&
      (!f.year || r.meetingOn.slice(0, 4) === String(f.year)) &&
      (!f.withoutFollowUp || (r.outcome === "approved" && !r.hasFollowUp)),
  );
}
