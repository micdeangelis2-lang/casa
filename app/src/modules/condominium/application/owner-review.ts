import { csvDocument, type CsvCell } from "@/shared/csv";
import {
  deliveryFacts,
  filterRegister,
  resolutionRegister,
  yearStatement,
  type DeliveryFact,
  type ResolutionInput,
  type ResolutionRegisterRow,
  type StatementYear,
  type TableShares,
  type YearStatement,
} from "../domain/owner-review";
import { formatMilli } from "../domain/millesimi";
import type { CondoReadDeps } from "./ports";

/** Cosa serve in piu' ai moduli di lettura: le polizze registrate (le fornisce l'interfaccia del modulo Assicurazioni). */
export type ReviewExtras = { policyAssetIds: () => Promise<Set<string>> };

export type CondoReview = {
  condominiumId: string;
  name: string;
  administratorName: string | null;
  years: YearStatement[];
  facts: DeliveryFact[];
  overdueCents: number;
};

export type OwnerReview = { condominiums: CondoReview[]; resolutions: ResolutionRegisterRow[]; today: string };

const euros = (cents: number): number => Number((cents / 100).toFixed(2));

/** Legge tutti i condomini (di solito uno o due: un solo proprietario) e ne ricava le tre viste di controllo. */
export async function getOwnerReview(deps: CondoReadDeps, extras: ReviewExtras, today: string, includeArchived = false): Promise<OwnerReview> {
  const [condos, assets, parties, policyAssets] = await Promise.all([deps.repo.listCondominiums(includeArchived), deps.others.assets(), deps.others.parties(), extras.policyAssetIds()]);
  const assetName = new Map(assets.map((a) => [a.id, a.name]));
  const register: ResolutionInput[] = [];

  const condominiums = await Promise.all(
    condos.map(async (c): Promise<CondoReview> => {
      const [members, tables, years, meetings, works, contracts, docs] = await Promise.all([
        deps.repo.members(c.id),
        deps.repo.tables(c.id),
        deps.repo.years(c.id),
        deps.repo.meetings(c.id),
        deps.repo.works(c.id),
        deps.repo.contracts(c.id),
        deps.repo.documents(c.id),
      ]);
      const tableShares = new Map<string, TableShares>();
      for (const t of tables) tableShares.set(t.id, { name: t.name, shares: (await deps.repo.shares(t.id)).map((s) => ({ assetId: s.assetId, milli: s.milli })), othersMilli: (await deps.repo.others(t.id)).reduce((n, o) => n + o.milli, 0) });

      const yearInputs: StatementYear[] = await Promise.all(
        years.map(async (y) => ({
          id: y.id,
          label: y.label,
          startsOn: y.startsOn,
          endsOn: y.endsOn,
          budgets: await Promise.all(
            (await deps.repo.budgets(y.id)).map(async (b) => ({
              id: b.id,
              title: b.title,
              kind: b.kind,
              totalCents: b.totalCents,
              tableId: b.millesimalTableId,
              documentId: b.documentId,
              scope: b.scope,
              installments: (await deps.repo.installments(b.id)).map((i) => ({ assetId: i.assetId, assetName: assetName.get(i.assetId) ?? "", dueOn: i.dueOn, amountCents: i.amountCents, paidCents: i.paidCents })),
            })),
          ),
        })),
      );
      const statements = yearInputs.map((y) => yearStatement(y, tableShares, today)).sort((a, b) => b.startsOn.localeCompare(a.startsOn));

      const memberIds = new Set(members.map((m) => m.assetId));
      const facts = deliveryFacts(
        {
          condominiumId: c.id,
          meetings,
          years: yearInputs.map((y) => ({ id: y.id, label: y.label, endsOn: y.endsOn, budgets: y.budgets })),
          contracts,
          documentKinds: docs.map((d) => d.kind),
          tableCount: tables.length,
          activePolicyCount: [...memberIds].filter((id) => policyAssets.has(id)).length,
          memberCount: members.length,
        },
        today,
      );

      for (const m of meetings) {
        const [agenda, resolutions] = await Promise.all([deps.repo.agenda(m.id), deps.repo.resolutions(m.id)]);
        const agendaTitle = new Map(agenda.map((a) => [a.id, a.title]));
        for (const r of resolutions) {
          register.push({
            condominiumId: c.id,
            condominiumName: c.name,
            meetingId: m.id,
            meetingOn: m.meetingOn,
            meetingKind: m.kind,
            meetingStatus: m.status,
            resolution: { id: r.id, title: r.title, outcome: r.outcome, agendaTitle: r.agendaItemId ? (agendaTitle.get(r.agendaItemId) ?? null) : null, votesFor: r.votesFor, votesAgainst: r.votesAgainst, votesAbstain: r.votesAbstain, threshold: r.threshold, deadlineId: r.deadlineId, budgetId: r.budgetId },
            workIds: works.filter((w) => w.resolutionId === r.id).map((w) => w.id),
          });
        }
      }
      return { condominiumId: c.id, name: c.name, administratorName: c.administratorPartyId ? (parties.get(c.administratorPartyId) ?? null) : null, years: statements, facts, overdueCents: statements.reduce((n, s) => n + s.overdueCents, 0) };
    }),
  );
  return { condominiums, resolutions: resolutionRegister(register), today };
}

export { filterRegister };

// ---------------------------------------------------------------------------------------------- CSV

export type ReviewLabels = { kinds: Record<string, string>; meetingKinds: Record<string, string>; outcomes: Record<string, string>; deliveries: Record<string, string> };

/** Versamenti: una riga per preventivo/consuntivo e immobile, poi il confronto con il consuntivo. */
export function statementCsv(review: OwnerReview, condominiumId: string | undefined, labels: ReviewLabels): string {
  const rows: CsvCell[][] = [
    ["Versamenti registrati e rate dei preventivi"],
    ["Cifre ricavate dai dati inseriti: non sostituiscono l'estratto conto dell'amministratore."],
    [],
    ["Condominio", "Esercizio", "Voce", "Tipo", "Immobile", "Rate", "Importo rate (€)", "Versato (€)", "Differenza rate meno versato (€)", "Non versato con scadenza passata (€)", "Prossima scadenza aperta"],
  ];
  const chosen = review.condominiums.filter((c) => !condominiumId || c.condominiumId === condominiumId);
  for (const c of chosen)
    for (const y of c.years)
      for (const l of y.lines) rows.push([c.name, y.label, l.budgetTitle, labels.kinds[l.kind] ?? l.kind, l.assetName, l.installments, euros(l.amountCents), euros(l.paidCents), euros(l.residualCents), euros(l.overdueCents), l.nextDueOn]);
  rows.push([], ["Confronto con il consuntivo (ipotesi: la quota si ripartisce con la tabella come le rate)"], ["Condominio", "Esercizio", "Consuntivo", "Immobile", "Quota ripartita (€)", "Versato sui preventivi (€)", "Quota meno versato (€)"]);
  for (const c of chosen) for (const y of c.years) for (const k of y.comparisons) rows.push([c.name, y.label, k.finalTitle, k.assetName, euros(k.quotaCents), euros(k.paidOnBudgetsCents), euros(k.differenceCents)]);
  return csvDocument(rows);
}

/** Documenti e dati che non risultano registrati, per condominio. */
export function deliveriesCsv(review: OwnerReview, condominiumId: string | undefined, labels: ReviewLabels): string {
  const rows: CsvCell[][] = [["Cosa non risulta registrato"], ["Elenco ricavato dai dati inseriti: non dice cosa l'amministratore debba consegnare."], [], ["Condominio", "Voce", "Riferimento", "Data", "Giorni trascorsi"]];
  for (const c of review.condominiums.filter((x) => !condominiumId || x.condominiumId === condominiumId)) for (const f of c.facts) rows.push([c.name, labels.deliveries[f.kind] ?? f.kind, f.subject === "" ? null : f.subject, f.date, f.daysSince]);
  return csvDocument(rows);
}

/** Registro delle delibere registrate (esito scelto dal proprietario, voti come da verbale). */
export function resolutionsCsv(rows: ResolutionRegisterRow[], labels: ReviewLabels): string {
  const out: CsvCell[][] = [
    ["Registro delle delibere registrate"],
    ["Esiti e voti sono quelli inseriti dal proprietario: l'app non ne valuta la validita'."],
    [],
    ["Condominio", "Data assemblea", "Assemblea", "Punto all'ordine del giorno", "Delibera", "Esito registrato", "Millesimi favorevoli", "Soglia indicata", "Scadenza collegata", "Spesa collegata", "Lavori collegati", "Nota sui numeri"],
  ];
  for (const r of rows) out.push([r.condominiumName, r.meetingOn, labels.meetingKinds[r.meetingKind] ?? r.meetingKind, r.agendaTitle, r.title, labels.outcomes[r.outcome] ?? r.outcome, r.votesFor === null ? null : formatMilli(r.votesFor), r.threshold === null ? null : formatMilli(r.threshold), r.hasDeadline ? "sì" : "no", r.hasBudget ? "sì" : "no", r.workCount, r.voteNote]);
  return csvDocument(out);
}
