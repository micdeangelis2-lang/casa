import { csvDocument, type CsvCell } from "@/shared/csv";
import type { AdviserSummary } from "@/modules/taxes";
import { COST_AREAS, INCOME_AREAS, type Area, type LedgerEntry } from "../domain/economy";
import { AREA_HREF, overlapsYear, proofState, sortGaps, type DossierGap, type GapKind, type ProofState } from "../domain/dossier";

export type DossierAsset = {
  id: string;
  name: string;
  address: string | null;
  territoryLabel: string;
  rights: { holderName: string; rightType: string; quotaNumerator: number; quotaDenominator: number; validFrom: string | null; validTo: string | null }[];
  cadastral: { sheet: string | null; parcel: string | null; subunit: string | null; category: string | null; cadastralClass: string | null; consistency: string | null; incomeCents: number | null; validFrom: string | null; validTo: string | null }[];
};

export type DossierLettingInput = {
  id: string;
  assetId: string;
  assetName: string;
  title: string;
  type: string;
  isContract: boolean;
  status: string;
  startsOn: string | null;
  endsOn: string | null;
  people: string[];
  registeredOn: string | null;
  registrationNumber: string | null;
  registrationOffice: string | null;
  hasContractDocument: boolean;
  rents: { dueOn: string; amountCents: number; paidCents: number }[];
};

export type DossierPremiumInput = { id: string; policyId: string; policyTitle: string; assetName: string | null; dueOn: string; amountCents: number; paidOn: string | null };

export interface DossierCollaborators {
  ledger(from: string, to: string): Promise<LedgerEntry[]>;
  assets(): Promise<DossierAsset[]>;
  lettings(): Promise<DossierLettingInput[]>;
  premiums(): Promise<DossierPremiumInput[]>;
  taxSummary(year: number): Promise<AdviserSummary>;
}

export type DossierMovement = LedgerEntry & { assetName: string | null; proof: ProofState; href: string };
export type DossierLetting = Omit<DossierLettingInput, "rents" | "assetId" | "isContract"> & { collectedCents: number; collectedCount: number };

export type DossierView = {
  year: number;
  assets: (DossierAsset & { rights: DossierAsset["rights"]; cadastral: DossierAsset["cadastral"] })[];
  lettings: DossierLetting[];
  movements: DossierMovement[];
  areaTotals: { area: Area; totalCents: number; count: number; withoutProof: number }[];
  tax: AdviserSummary;
  gaps: DossierGap[];
};

/** Il dossier di un anno: cio' che il proprietario ha registrato, piu' l'elenco di cio' che manca. Nessun calcolo fiscale. */
export async function getDossier(deps: DossierCollaborators, year: number, today: string): Promise<DossierView> {
  const [all, assetsAll, lettingsAll, premiums, tax] = await Promise.all([deps.ledger(`${year}-01-01`, `${year}-12-31`), deps.assets(), deps.lettings(), deps.premiums(), deps.taxSummary(year)]);
  const names = new Map(assetsAll.map((a) => [a.id, a.name]));
  const assets = assetsAll.map((a) => ({ ...a, rights: a.rights.filter((r) => overlapsYear(r.validFrom, r.validTo, year)), cadastral: a.cadastral.filter((c) => overlapsYear(c.validFrom, c.validTo, year)) }));
  const movements: DossierMovement[] = all
    .map((e) => ({ ...e, assetName: e.assetId ? (names.get(e.assetId) ?? null) : null, proof: proofState(e), href: `${AREA_HREF[e.area]}/${e.refId}` }))
    .sort((a, b) => a.area.localeCompare(b.area) || a.date.localeCompare(b.date) || a.label.localeCompare(b.label, "it"));
  const areaTotals = [...COST_AREAS, ...INCOME_AREAS].map((area) => {
    const rows = movements.filter((m) => m.area === area);
    return { area, totalCents: rows.reduce((n, m) => n + m.amountCents, 0), count: rows.length, withoutProof: rows.filter((m) => m.proof === "missing").length };
  });

  const lettings = lettingsAll
    .filter((l) => overlapsYear(l.startsOn, l.endsOn, year) || movements.some((m) => m.area === "lettings" && m.refId === l.id))
    .map((l) => {
      const paid = movements.filter((m) => m.area === "lettings" && m.refId === l.id);
      return {
        id: l.id,
        assetName: l.assetName,
        title: l.title,
        type: l.type,
        status: l.status,
        startsOn: l.startsOn,
        endsOn: l.endsOn,
        people: l.people,
        registeredOn: l.registeredOn,
        registrationNumber: l.registrationNumber,
        registrationOffice: l.registrationOffice,
        hasContractDocument: l.hasContractDocument,
        collectedCents: paid.reduce((n, m) => n + m.amountCents, 0),
        collectedCount: paid.length,
      };
    });

  const gaps: DossierGap[] = [];
  const gap = (g: DossierGap) => gaps.push(g);
  for (const a of assets) {
    if (a.rights.length === 0) gap({ kind: "asset_no_rights", subject: a.name, assetName: a.name, date: null, amountCents: null, href: `/immobili/${a.id}` });
    if (a.cadastral.length === 0) gap({ kind: "asset_no_cadastral", subject: a.name, assetName: a.name, date: null, amountCents: null, href: `/immobili/${a.id}` });
  }
  for (const m of movements) if (m.proof === "missing") gap({ kind: "payment_no_proof", subject: m.label, assetName: m.assetName, date: m.date, amountCents: m.amountCents, href: m.href });
  for (const l of lettingsAll.filter((x) => overlapsYear(x.startsOn, x.endsOn, year))) {
    for (const r of l.rents) {
      if (r.dueOn >= `${year}-01-01` && r.dueOn <= `${year}-12-31` && r.dueOn < today && r.paidCents < r.amountCents) gap({ kind: "rent_not_collected", subject: l.title, assetName: l.assetName, date: r.dueOn, amountCents: r.amountCents - r.paidCents, href: `/locazioni/${l.id}` });
    }
    if (l.isContract && !l.registeredOn && !l.registrationNumber) gap({ kind: "letting_no_registration", subject: l.title, assetName: l.assetName, date: null, amountCents: null, href: `/locazioni/${l.id}` });
    if (l.isContract && !l.hasContractDocument) gap({ kind: "letting_no_contract_document", subject: l.title, assetName: l.assetName, date: null, amountCents: null, href: `/locazioni/${l.id}` });
  }
  for (const p of premiums) {
    if (p.paidOn === null && p.dueOn >= `${year}-01-01` && p.dueOn <= `${year}-12-31` && p.dueOn < today) gap({ kind: "premium_not_paid", subject: p.policyTitle, assetName: p.assetName, date: p.dueOn, amountCents: p.amountCents, href: `/assicurazioni/${p.policyId}` });
  }
  for (const i of tax.items) {
    const subject = `${i.typeName}${i.label ? ` – ${i.label}` : ""}`;
    if (i.state === "unpaid") gap({ kind: "tax_no_payment", subject, assetName: i.assetName, date: i.dueOn, amountCents: i.expectedCents, href: `/tributi/${i.id}` });
    if (i.state === "recorded") gap({ kind: "tax_no_expected", subject, assetName: i.assetName, date: i.dueOn, amountCents: null, href: `/tributi/${i.id}` });
  }
  for (const r of tax.returns) if (r.state !== "filed") gap({ kind: "return_not_filed", subject: r.title, assetName: r.assetName, date: r.dueOn, amountCents: null, href: "/tributi/dichiarazioni" });

  return { year, assets, lettings, movements, areaTotals, tax, gaps: sortGaps(gaps) };
}

const euros = (cents: number | null): number | null => (cents === null ? null : cents / 100);

const AREA_LABEL: Record<Area, string> = { taxes: "Tributi", insurance: "Assicurazioni", maintenance: "Manutenzioni", condominium: "Condominio", lettings: "Locazioni (incassi)" };
const TAX_KIND_LABEL = { ordinary: "Ordinario", late_payment_correction: "Correzione di un pagamento tardivo", other: "Altra natura" } as const;
const PROOF_LABEL: Record<ProofState, string> = { present: "Collegata", missing: "Non collegata", notTracked: "Non prevista in questa sezione" };
const GAP_LABEL: Record<GapKind, string> = {
  asset_no_rights: "Nessuna titolarità registrata per l'anno",
  asset_no_cadastral: "Nessun dato catastale registrato per l'anno",
  payment_no_proof: "Pagamento o incasso senza documento di prova collegato",
  rent_not_collected: "Canone con scadenza nell'anno non incassato per intero (importo residuo)",
  premium_not_paid: "Premio con scadenza nell'anno senza pagamento registrato",
  letting_no_registration: "Contratto senza dati di registrazione inseriti",
  letting_no_contract_document: "Contratto senza documento collegato",
  tax_no_payment: "Voce di tributo senza pagamenti registrati",
  tax_no_expected: "Voce di tributo con pagamenti ma senza importo atteso indicato",
  return_not_filed: "Dichiarazione o comunicazione senza presentazione registrata",
};
const RIGHT_LABEL: Record<string, string> = { full: "Piena proprietà", co_ownership: "Comproprietà", usufruct: "Usufrutto", bare_ownership: "Nuda proprietà" };

/** Il dossier in CSV (UTF-8 con BOM, «;»): le stesse sezioni della pagina, da consegnare al consulente. */
export function dossierCsv(d: DossierView): string {
  const rows: CsvCell[][] = [
    [`Dossier annuale per il consulente ${d.year}`],
    ["Riepilogo di quanto registrato dal proprietario: non contiene calcoli di imposta, aliquote né indicazioni di deducibilità. Le segnalazioni indicano solo dati non registrati."],
    [],
    ["Immobili: titolarità e dati catastali"],
    ["Immobile", "Indirizzo", "Territorio", "Titolare", "Diritto", "Quota", "Titolarità dal", "Titolarità al", "Foglio", "Particella", "Sub.", "Categoria", "Classe", "Consistenza", "Rendita (€)"],
    ...d.assets.flatMap((a): CsvCell[][] => {
      const n = Math.max(a.rights.length, a.cadastral.length, 1);
      return Array.from({ length: n }, (_, i): CsvCell[] => {
        const r = a.rights[i];
        const c = a.cadastral[i];
        return [i === 0 ? a.name : "", i === 0 ? a.address : "", i === 0 ? a.territoryLabel : "", r?.holderName ?? "", r ? (RIGHT_LABEL[r.rightType] ?? r.rightType) : "", r ? `${r.quotaNumerator}/${r.quotaDenominator}` : "", r?.validFrom ?? "", r?.validTo ?? "", c?.sheet ?? "", c?.parcel ?? "", c?.subunit ?? "", c?.category ?? "", c?.cadastralClass ?? "", c?.consistency ?? "", euros(c?.incomeCents ?? null)];
      });
    }),
    [],
    ["Locazioni"],
    ["Locazione", "Immobile", "Persone", "Stato", "Dal", "Al", "Registrazione: data", "Registrazione: numero", "Registrazione: ufficio", "Incassato nell'anno (€)", "Canoni incassati"],
    ...d.lettings.map((l): CsvCell[] => [l.title, l.assetName, l.people.join(", "), l.status, l.startsOn, l.endsOn, l.registeredOn, l.registrationNumber, l.registrationOffice, euros(l.collectedCents), l.collectedCount]),
    [],
    ["Pagamenti e incassi registrati nell'anno"],
    ["Data", "Area", "Descrizione", "Immobile", "Importo (€)", "Documento di prova", "Natura (tributi)", "Di cui sanzioni dichiarate (€)", "Di cui interessi dichiarati (€)"],
    ...d.movements.map((m): CsvCell[] => [m.date, AREA_LABEL[m.area], m.label, m.assetName ?? "Non ripartito", euros(m.amountCents), PROOF_LABEL[m.proof], m.taxDetail ? TAX_KIND_LABEL[m.taxDetail.kind] : "", euros(m.taxDetail?.penaltyCents ?? null), euros(m.taxDetail?.interestCents ?? null)]),
    [],
    ["Totali per area"],
    ["Area", "Totale (€)", "Movimenti", "Senza prova collegata"],
    ...d.areaTotals.map((t): CsvCell[] => [AREA_LABEL[t.area], euros(t.totalCents), t.count, t.withoutProof]),
    [],
    ["Tributi: voci dell'anno (importi attesi indicati dal proprietario)"],
    ["Immobile", "Tributo", "Scadenza", "Importo atteso (€)", "Pagato (€)", "Da chiedere al consulente", "Nota"],
    ...d.tax.items.map((i): CsvCell[] => [i.assetName, `${i.typeName}${i.label ? ` – ${i.label}` : ""}`, i.dueOn, euros(i.expectedCents), euros(i.paidCents), i.askAdviser ? "sì" : "", i.note]),
    [],
    ["Dichiarazioni e comunicazioni"],
    ["Titolo", "Immobile", "Scadenza", "Presentata il", "Protocollo", "Da chiedere al consulente", "Nota"],
    ...d.tax.returns.map((r): CsvCell[] => [r.title, r.assetName, r.dueOn, r.filedOn, r.protocol, r.askAdviser ? "sì" : "", r.note]),
    [],
    ["Dati mancanti"],
    ["Segnalazione", "Riferimento", "Immobile", "Data", "Importo (€)"],
    ...d.gaps.map((g): CsvCell[] => [GAP_LABEL[g.kind], g.subject, g.assetName, g.date, euros(g.amountCents)]),
  ];
  return csvDocument(rows);
}
