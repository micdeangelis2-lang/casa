import { isPaid } from "../domain/condominium";
import { checkVotes, tableTotals, type VoteCheck } from "../domain/millesimi";
import type {
  AgendaRow,
  BudgetRow,
  ClaimRow,
  CondoReadDeps,
  CondominiumRow,
  ContractRow,
  InstallmentRow,
  MeetingRow,
  OtherShareRow,
  MemberRow,
  ProxyRow,
  ResolutionRow,
  ShareRow,
  TableRow,
  WorkEntryRow,
  WorkRow,
  YearRow,
} from "./ports";

// -------------------------------------------------------------------------------------------------- letture

/** Le rate con un pagamento registrato in un periodo (data dell'ultimo pagamento), una per riga: servono al quadro economico. */
export async function installmentLedger(deps: CondoReadDeps, from: string, to: string) {
  const rows = await deps.repo.paidInstallmentsBetween(from, to);
  return rows.map((r) => ({ id: r.installmentId, refId: r.condominiumId, date: r.paidOn, amountCents: r.paidCents, documentId: r.documentId, assetId: r.assetId, label: `Rata ${r.number}: ${r.budgetTitle}` }));
}

export type CondominiumListItem = CondominiumRow & { memberCount: number; administratorName: string | null };

export async function listCondominiums(deps: CondoReadDeps, includeArchived = false): Promise<CondominiumListItem[]> {
  const [rows, parties] = await Promise.all([deps.repo.listCondominiums(includeArchived), deps.others.parties()]);
  return Promise.all(rows.map(async (c) => ({ ...c, memberCount: (await deps.repo.members(c.id)).length, administratorName: c.administratorPartyId ? (parties.get(c.administratorPartyId) ?? null) : null })));
}

export type TableView = TableRow & { shares: (ShareRow & { assetName: string })[]; others: OtherShareRow[]; othersTotal: number; total: number; differsFromThousand: boolean };
export type BudgetView = BudgetRow & { tableName: string | null; installments: (InstallmentRow & { assetName: string; paid: boolean; documentTitle: string | null })[]; paidCents: number; dueCents: number };
export type YearView = YearRow & { budgets: BudgetView[] };
export type CondominiumDetail = CondominiumRow & {
  administratorName: string | null;
  members: (MemberRow & { assetName: string })[];
  tables: TableView[];
  years: YearView[];
  meetings: MeetingRow[];
  works: (WorkRow & { invoicedCents: number; entries: (WorkEntryRow & { documentTitle: string | null })[] })[];
  claims: (ClaimRow & { matterTitle: string | null })[];
  contracts: (ContractRow & { counterpartyName: string | null; documentTitle: string | null })[];
  documents: { documentId: string; kind: string; title: string }[];
};

export async function getCondominiumDetail(deps: CondoReadDeps, id: string): Promise<CondominiumDetail | null> {
  const condo = await deps.repo.getCondominium(id);
  if (!condo) return null;
  const [assets, parties, titles, matters, members, tables, years, meetings, works, claims, contracts, docs] = await Promise.all([
    deps.others.assets(),
    deps.others.parties(),
    deps.others.documentTitles(),
    deps.others.matterTitles(),
    deps.repo.members(id),
    deps.repo.tables(id),
    deps.repo.years(id),
    deps.repo.meetings(id),
    deps.repo.works(id),
    deps.repo.claims(id),
    deps.repo.contracts(id),
    deps.repo.documents(id),
  ]);
  const assetName = new Map(assets.map((a) => [a.id, a.name]));
  const tableViews: TableView[] = await Promise.all(
    tables.map(async (t) => {
      const shares = (await deps.repo.shares(t.id)).map((s) => ({ ...s, assetName: assetName.get(s.assetId) ?? "" }));
      const others = await deps.repo.others(t.id);
      return { ...t, shares, others, othersTotal: others.reduce((n, o) => n + o.milli, 0), ...tableTotals(shares.map((s) => s.milli)) };
    }),
  );
  const tableName = new Map(tables.map((t) => [t.id, t.name]));
  const yearViews: YearView[] = await Promise.all(
    years.map(async (y) => ({
      ...y,
      budgets: await Promise.all(
        (await deps.repo.budgets(y.id)).map(async (b) => {
          const installments = (await deps.repo.installments(b.id)).map((i) => ({ ...i, assetName: assetName.get(i.assetId) ?? "", paid: isPaid(i), documentTitle: i.documentId ? (titles.get(i.documentId) ?? null) : null }));
          return { ...b, tableName: b.millesimalTableId ? (tableName.get(b.millesimalTableId) ?? null) : null, installments, paidCents: installments.reduce((n, i) => n + i.paidCents, 0), dueCents: installments.reduce((n, i) => n + i.amountCents, 0) };
        }),
      ),
    })),
  );
  return {
    ...condo,
    administratorName: condo.administratorPartyId ? (parties.get(condo.administratorPartyId) ?? null) : null,
    members: members.map((m) => ({ ...m, assetName: assetName.get(m.assetId) ?? "" })),
    tables: tableViews,
    years: yearViews,
    meetings,
    works: await Promise.all(
      works.map(async (w) => {
        const entries = (await deps.repo.entries(w.id)).map((e) => ({ ...e, documentTitle: e.documentId ? (titles.get(e.documentId) ?? null) : null }));
        return { ...w, entries, invoicedCents: entries.filter((e) => e.kind === "invoice").reduce((n, e) => n + (e.amountCents ?? 0), 0) };
      }),
    ),
    claims: claims.map((c) => ({ ...c, matterTitle: c.matterId ? (matters.get(c.matterId) ?? null) : null })),
    contracts: contracts.map((c) => ({ ...c, counterpartyName: c.counterpartyPartyId ? (parties.get(c.counterpartyPartyId) ?? null) : null, documentTitle: c.documentId ? (titles.get(c.documentId) ?? null) : null })),
    documents: docs.flatMap((d) => (titles.has(d.documentId) ? [{ ...d, title: titles.get(d.documentId)! }] : [])),
  };
}

export type ResolutionView = ResolutionRow & { check: VoteCheck; agendaTitle: string | null; deadlineLinked: boolean; budgetTitle: string | null };
export type MeetingDetail = MeetingRow & {
  condominiumName: string;
  agenda: (AgendaRow & { documents: { id: string; title: string }[] })[];
  proxies: (ProxyRow & { delegateName: string; documentTitle: string | null })[];
  resolutions: ResolutionView[];
  convocationTitle: string | null;
  minutesTitle: string | null;
  /** Elenco di preparazione: cosa leggere e cosa chiedere. */
  preparation: { documentsToRead: { id: string; title: string; agendaTitle: string }[]; questions: { agendaTitle: string; text: string }[]; itemsWithoutDocuments: string[] };
};

export async function getMeetingDetail(deps: CondoReadDeps, meetingId: string): Promise<MeetingDetail | null> {
  const meeting = await deps.repo.getMeeting(meetingId);
  if (!meeting) return null;
  const [condo, titles, parties, agenda, proxies, resolutions, budgetsByYear] = await Promise.all([
    deps.repo.getCondominium(meeting.condominiumId),
    deps.others.documentTitles(),
    deps.others.parties(),
    deps.repo.agenda(meetingId),
    deps.repo.proxies(meetingId),
    deps.repo.resolutions(meetingId),
    deps.repo.years(meeting.condominiumId).then((ys) => Promise.all(ys.map((y) => deps.repo.budgets(y.id)))),
  ]);
  const budgetTitles = new Map(budgetsByYear.flat().map((b) => [b.id, b.title]));
  const agendaTitles = new Map(agenda.map((a) => [a.id, a.title]));
  const agendaView = agenda.map((a) => ({ ...a, documents: a.documentIds.flatMap((d) => (titles.has(d) ? [{ id: d, title: titles.get(d)! }] : [])) }));
  return {
    ...meeting,
    condominiumName: condo?.name ?? "",
    agenda: agendaView,
    proxies: proxies.map((p) => ({ ...p, delegateName: parties.get(p.delegatePartyId) ?? "", documentTitle: p.documentId ? (titles.get(p.documentId) ?? null) : null })),
    resolutions: resolutions.map((r) => ({
      ...r,
      check: checkVotes({ outcome: r.outcome, votesFor: r.votesFor, votesAgainst: r.votesAgainst, votesAbstain: r.votesAbstain, threshold: r.threshold }),
      agendaTitle: r.agendaItemId ? (agendaTitles.get(r.agendaItemId) ?? null) : null,
      deadlineLinked: r.deadlineId !== null,
      budgetTitle: r.budgetId ? (budgetTitles.get(r.budgetId) ?? null) : null,
    })),
    convocationTitle: meeting.convocationDocumentId ? (titles.get(meeting.convocationDocumentId) ?? null) : null,
    minutesTitle: meeting.minutesDocumentId ? (titles.get(meeting.minutesDocumentId) ?? null) : null,
    preparation: {
      documentsToRead: agendaView.flatMap((a) => a.documents.map((d) => ({ ...d, agendaTitle: a.title }))),
      questions: agendaView.filter((a) => a.questions).map((a) => ({ agendaTitle: a.title, text: a.questions! })),
      itemsWithoutDocuments: agendaView.filter((a) => a.documents.length === 0).map((a) => a.title),
    },
  };
}

export async function listAssetsWithoutCondominium(deps: CondoReadDeps): Promise<{ id: string; name: string }[]> {
  const assets = await deps.others.assets();
  const taken = await Promise.all(assets.map(async (a) => ((await deps.repo.condominiumOfAsset(a.id)) ? a.id : null)));
  const set = new Set(taken.filter(Boolean));
  return assets.filter((a) => !set.has(a.id));
}
