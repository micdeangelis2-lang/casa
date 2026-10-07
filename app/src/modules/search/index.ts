/**
 * Interfaccia pubblica del modulo Ricerca: cerca un testo in tutte le sezioni (immobili, documenti, rubrica, scadenze, tributi,
 * condominio, manutenzioni, assicurazioni, locazioni, pratiche, regole) leggendo gli indici degli altri moduli. Sola lettura,
 * nessuno schema proprio. Non registra cosa si cerca.
 */
import type { Db } from "@/platform/db/types";
import { listAssets } from "@/modules/assets";
import { listCondominiums } from "@/modules/condominium";
import { listDeadlines } from "@/modules/deadlines";
import { listParties } from "@/modules/directory";
import { documentTitles, listDocuments } from "@/modules/documents";
import { listClaims, listPolicies } from "@/modules/insurance";
import { listLettings } from "@/modules/lettings";
import { listWorks } from "@/modules/maintenance";
import { listMatters } from "@/modules/matters";
import { listRules } from "@/modules/rules";
import { listObligations, listReturns } from "@/modules/taxes";
import { SEARCH_GROUPS, cleanQuery, limitGroup, matchesAll, type GroupResult, type Hit, type SearchGroup } from "./domain/search";

export { MIN_QUERY, PER_GROUP, cleanQuery, matchesAll, normalize, type GroupResult, type Hit, type SearchGroup } from "./domain/search";

export type SearchOutcome = { query: string; groups: GroupResult[]; total: number };

const hit = (group: SearchGroup, id: string, title: string, subtitle: string | null, href: string): Hit => ({ id, group, title, subtitle, href });
const join = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" · ") || null;

/** Cerca `rawQuery` ovunque; null se il testo e' troppo corto. I gruppi senza risultati non compaiono. */
export async function searchAll(db: Db, rawQuery: string | null | undefined): Promise<SearchOutcome | null> {
  const query = cleanQuery(rawQuery);
  if (!query) return null;
  const match = (...fields: (string | null | undefined)[]) => matchesAll(query, ...fields);

  const [assets, documentHits, titles, parties, deadlines, obligations, returns, condominiums, works, policies, claims, lettings, matters, rules] = await Promise.all([
    listAssets(db),
    // Il database cerca nel testo dei file e nei titoli (con le sue regole sugli accenti); i titoli si confrontano anche qui, senza accenti.
    listDocuments(db, { query, limit: 50 }),
    documentTitles(db),
    listParties(db),
    listDeadlines(db, {}),
    listObligations(db, {}),
    listReturns(db, {}),
    listCondominiums(db, true),
    listWorks(db, { includeClosed: true }),
    listPolicies(db, true),
    listClaims(db, { includeClosed: true }),
    listLettings(db, { includeEnded: true }),
    listMatters(db, { includeClosed: true }),
    listRules(db),
  ]);

  // Documenti: quelli trovati dal database, piu' quelli il cui titolo corrisponde senza badare agli accenti.
  const found = new Set(documentHits.map((d) => d.id));
  const documents: Hit[] = [
    ...documentHits.map((d) => hit("documents", d.id, d.title, join(d.categoryName), `/documenti/${d.id}`)),
    ...[...titles].filter(([id, title]) => !found.has(id) && match(title)).map(([id, title]) => hit("documents", id, title, null, `/documenti/${id}`)),
  ];

  const results: GroupResult[] = [
    limitGroup("assets", assets.filter((a) => match(a.name, a.address, a.locality, a.territoryLabel)).map((a) => hit("assets", a.id, a.name, join(a.territoryLabel, a.address), `/immobili/${a.id}`))),
    limitGroup("documents", documents),
    limitGroup("parties", parties.filter((p) => match(p.displayName, p.taxCode, p.email, p.phone, p.address)).map((p) => hit("parties", p.id, p.displayName, join(p.taxCode, p.email, p.phone), `/rubrica/${p.id}/modifica`))),
    limitGroup("deadlines", deadlines.filter((d) => match(d.title)).map((d) => hit("deadlines", d.id, d.title, null, `/scadenze/${d.id}`))),
    limitGroup("taxes", [
      ...obligations.filter((o) => match(o.typeName, String(o.year), o.label, o.assetName, o.note)).map((o) => hit("taxes", o.id, `${o.typeName} ${o.year}${o.label ? ` – ${o.label}` : ""}`, join(o.assetName), `/tributi/${o.id}`)),
      ...returns.filter((r) => match(r.title, r.protocol, r.assetName)).map((r) => hit("taxes", r.id, `${r.title} ${r.year}`, join(r.assetName, r.protocol), "/tributi/dichiarazioni")),
    ]),
    limitGroup("condominium", condominiums.filter((c) => match(c.name, c.address, c.administratorName)).map((c) => hit("condominium", c.id, c.name, join(c.address), `/condominio/${c.id}`))),
    limitGroup("maintenance", works.filter((w) => match(w.title, w.assetName, w.supplierName, w.description ?? "")).map((w) => hit("maintenance", w.id, w.title, join(w.assetName, w.supplierName), `/manutenzioni/${w.id}`))),
    limitGroup("insurance", [
      ...policies.filter((p) => match(p.title, p.policyNumber, p.insurerName, p.assets.map((a) => a.name).join(" "))).map((p) => hit("insurance", p.id, p.title, join(p.insurerName, p.policyNumber), `/assicurazioni/${p.id}`)),
      ...claims.filter((c) => match(c.title, c.claimNumber, c.policyTitle)).map((c) => hit("insurance", c.id, c.title, join(c.policyTitle, c.claimNumber), `/assicurazioni/sinistri/${c.id}`)),
    ]),
    limitGroup("lettings", lettings.filter((l) => match(l.title, l.assetName, l.managerName, l.people.join(" "))).map((l) => hit("lettings", l.id, l.title, join(l.assetName, l.people.join(", ")), `/locazioni/${l.id}`))),
    limitGroup("matters", matters.filter((m) => match(m.title, m.assetName, m.assignees.join(" "))).map((m) => hit("matters", m.id, m.title, join(m.assetName), `/pratiche/${m.id}`))),
    limitGroup("rules", rules.filter((r) => match(r.current.title, r.key)).map((r) => hit("rules", r.id, r.current.title, null, `/regole/${r.id}`))),
  ];

  const groups = SEARCH_GROUPS.map((g) => results.find((r) => r.group === g)!).filter((g) => g.total > 0);
  return { query, groups, total: groups.reduce((n, g) => n + g.total, 0) };
}
