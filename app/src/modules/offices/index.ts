/**
 * Interfaccia pubblica del modulo Uffici: legge Rubrica (contatti con ruolo «ufficio pubblico»), Pratiche, Scadenze, Regole e
 * Territori e ne ricava due viste di sola lettura, senza schema proprio:
 *  - «cosa e' aperto presso ciascun ufficio» (pratiche, richieste, risposte, scadenze);
 *  - le regole del territorio di un immobile con stato di verifica e data dell'ultimo controllo.
 * Dice solo cio' che risulta dai dati inseriti: non dice se una regola si applica, ne' se qualcosa e' in regola.
 * Nessuna norma, aliquota o termine e' scritto nel codice: sono dati dell'utente.
 */
import type { Db } from "@/platform/db/types";
import { todayInItaly } from "@/platform/clock";
import { getAssetDetail } from "@/modules/assets";
import { getParty, listParties, type Party } from "@/modules/directory";
import { listDeadlines, listOccurrences } from "@/modules/deadlines";
import { getMatterDetail, listMatters } from "@/modules/matters";
import { effectiveVersion, loadActiveRules, type RuleLevel, type RuleVerification } from "@/modules/rules";
import { describeTerritories, territoryChainIds } from "@/modules/territory";
import { buildOfficeView, type OfficeCounts, type OfficeDeadlineInput, type OfficeMatterInput, type OfficeView } from "./domain/office";
import { DEFAULT_REVIEW_MONTHS, classifyReview, countByState, REVIEW_STATE_ORDER, type ReviewState } from "./domain/review";
import { lastVerificationAt } from "./infrastructure/rule-checks";

export { DEFAULT_REVIEW_MONTHS, REVIEW_MONTHS_CHOICES, classifyReview, monthsBefore, type ReviewState } from "./domain/review";
export { type OfficeCounts, type OfficeDeadline, type OfficeMatter, type OfficeView } from "./domain/office";

const OFFICE_ROLE = "public_office" as const;

async function loadSources(db: Db): Promise<{ matters: OfficeMatterInput[]; deadlines: OfficeDeadlineInput[] }> {
  const list = await listMatters(db, { includeClosed: true });
  const details = (await Promise.all(list.map((m) => getMatterDetail(db, m.id)))).flatMap((d) => (d ? [d] : []));
  const matters: OfficeMatterInput[] = details.map((d) => ({
    id: d.id,
    title: d.title,
    status: d.status,
    openedOn: d.openedOn,
    closedOn: d.closedOn,
    assetName: d.assetName,
    assignments: d.assignments.map((a) => ({ partyId: a.partyId, role: a.role })),
    requests: d.requests.map((r) => ({ id: r.id, title: r.title, requestedFromPartyId: r.requestedFromPartyId, status: r.status, requestedOn: r.requestedOn, dueOn: r.dueOn, documentTitle: r.documentTitle })),
    opinions: d.opinions.map((o) => ({ id: o.id, partyId: o.partyId, nature: o.nature, summary: o.summary, issuedOn: o.issuedOn, documentTitle: o.documentTitle })),
    officePartyId: d.officePartyId,
    protocolNumber: d.protocolNumber,
    submittedOn: d.submittedOn,
    responseDueOn: d.responseDueOn,
  }));

  const [definitions, open] = await Promise.all([listDeadlines(db), listOccurrences(db, "open")]);
  const byId = new Map(definitions.map((d) => [d.id, d]));
  const deadlines = open.flatMap((o) => {
    const def = byId.get(o.deadlineId);
    if (!def || o.archived || (!def.responsiblePartyId && !def.professionalPartyId && !def.matterId)) return [];
    return [{ deadlineId: o.deadlineId, occurrenceId: o.id, title: o.title, dueOn: o.dueOn, assetName: o.assetName, responsiblePartyId: def.responsiblePartyId, professionalPartyId: def.professionalPartyId, matterId: def.matterId }];
  });
  return { matters, deadlines };
}

export type OfficeOverviewItem = { party: Party; counts: OfficeCounts };
export type OfficesOverview = { offices: OfficeOverviewItem[]; mattersWithoutOffice: number };

/** Gli uffici della rubrica con cio' che risulta aperto presso ciascuno. */
export async function listOfficesOverview(db: Db, today = todayInItaly()): Promise<OfficesOverview> {
  const [parties, sources] = await Promise.all([listParties(db, { role: OFFICE_ROLE }), loadSources(db)]);
  const officeIds = new Set(parties.map((p) => p.id));
  const offices = parties.map((party) => ({ party, counts: buildOfficeView(party.id, sources.matters, sources.deadlines, today).counts }));
  offices.sort((a, b) => b.counts.overdue - a.counts.overdue || (a.counts.nextDueOn ?? "9999").localeCompare(b.counts.nextDueOn ?? "9999") || a.party.displayName.localeCompare(b.party.displayName, "it"));
  const mattersWithoutOffice = sources.matters.filter(
    (m) => m.status !== "closed" && !(m.officePartyId && officeIds.has(m.officePartyId)) && !m.assignments.some((a) => officeIds.has(a.partyId)) && !m.requests.some((r) => r.requestedFromPartyId && officeIds.has(r.requestedFromPartyId)),
  ).length;
  return { offices, mattersWithoutOffice };
}

export type OfficeDetail = { party: Party; view: OfficeView };

export async function getOfficeDetail(db: Db, partyId: string, today = todayInItaly()): Promise<OfficeDetail | null> {
  const party = await getParty(db, partyId);
  if (!party || !party.roles.includes(OFFICE_ROLE)) return null;
  const sources = await loadSources(db);
  return { party, view: buildOfficeView(party.id, sources.matters, sources.deadlines, today) };
}

export type RuleReviewRow = {
  ruleId: string;
  title: string;
  level: RuleLevel;
  scope: "territory" | "everywhere";
  territoryLabel: string | null;
  versionNo: number;
  verificationStatus: RuleVerification;
  sourceText: string;
  sourceUrl: string | null;
  validFrom: string | null;
  validTo: string | null;
  /** Data dell'ultima verifica registrata (dal registro delle modifiche); vuota se non ce n'e'. */
  lastCheckedOn: string | null;
  /** Data in cui la versione e' stata inserita. */
  insertedOn: string;
  state: ReviewState;
};

export type RuleReview = {
  asset: { id: string; name: string } | null;
  territoryLabels: string[];
  maxAgeMonths: number;
  rows: RuleReviewRow[];
  counts: Record<ReviewState, number>;
};

const dayOf = (at: Date) => todayInItaly({ now: () => at });

/**
 * Le regole attive con una versione in vigore oggi, per il territorio di un immobile (e quelle senza territorio) oppure,
 * senza immobile, tutte. Per ciascuna: stato di verifica, fonte e data dell'ultimo controllo. NON valuta le condizioni di
 * applicazione: l'elenco dice cosa e' registrato, non cosa si applica al bene.
 */
export async function reviewRules(db: Db, args: { assetId?: string; maxAgeMonths?: number; today?: string } = {}): Promise<RuleReview | null> {
  const today = args.today ?? todayInItaly();
  const maxAgeMonths = args.maxAgeMonths ?? DEFAULT_REVIEW_MONTHS;

  let asset: RuleReview["asset"] = null;
  let chain: Set<string> | null = null;
  let territoryLabels: string[] = [];
  if (args.assetId) {
    const detail = await getAssetDetail(db, args.assetId);
    if (!detail) return null;
    asset = { id: detail.id, name: detail.name };
    const ids = await territoryChainIds(db, detail.territoryId);
    chain = new Set(ids);
    const described = new Map((await describeTerritories(db, ids)).map((t) => [t.id, t.label]));
    territoryLabels = ids.flatMap((id) => (described.has(id) ? [described.get(id)!] : []));
  }

  const [rules, checks] = await Promise.all([loadActiveRules(db), lastVerificationAt(db)]);
  const picked = rules.flatMap((rule) => {
    const version = effectiveVersion(rule, today);
    if (!version) return [];
    if (chain && version.territoryId && !chain.has(version.territoryId)) return [];
    return [{ rule, version }];
  });
  const labels = new Map((await describeTerritories(db, [...new Set(picked.flatMap((p) => (p.version.territoryId ? [p.version.territoryId] : [])))])).map((t) => [t.id, t.label]));

  const rows: RuleReviewRow[] = picked.map(({ rule, version }) => {
    const checkedAt = checks.get(version.id);
    const lastCheckedOn = checkedAt ? dayOf(checkedAt) : null;
    return {
      ruleId: rule.id,
      title: version.title,
      level: version.level,
      scope: version.territoryId ? "territory" : "everywhere",
      territoryLabel: version.territoryId ? (labels.get(version.territoryId) ?? null) : null,
      versionNo: version.versionNo,
      verificationStatus: version.verificationStatus,
      sourceText: version.sourceText,
      sourceUrl: version.sourceUrl,
      validFrom: version.validFrom,
      validTo: version.validTo,
      lastCheckedOn,
      insertedOn: dayOf(version.createdAt),
      state: classifyReview({ status: version.verificationStatus, lastCheckedOn, today, maxAgeMonths }),
    };
  });
  rows.sort((a, b) => REVIEW_STATE_ORDER.indexOf(a.state) - REVIEW_STATE_ORDER.indexOf(b.state) || a.title.localeCompare(b.title, "it"));
  return { asset, territoryLabels, maxAgeMonths, rows, counts: countByState(rows) };
}
