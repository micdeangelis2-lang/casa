import { describe, expect, it } from "vitest";
import { buildNotarySheet } from "@/modules/notary";
import { agentSheetCsv, notarySheetCsv, plantRegisterCsv, policiesByAssetCsv, type AgentCsvLabels, type NotaryCsvLabels, type PlantCsvLabels } from "@/lib/sheet-csv";
import { limitBrief, limitNotarySheet } from "@/lib/share-sheets";
import { parseCsv } from "@/modules/sharing/domain/sheet";
import type { TechnicalBrief } from "@/modules/technical";

const TODAY = "2026-06-15";
const same = (c: string) => c;

const expectCsvShape = (csv: string) => {
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  expect(csv.endsWith("\r\n")).toBe(true);
  expect(csv.replace(/\r\n/g, "")).not.toMatch(/\n/);
};

describe("registro impianti in CSV", () => {
  const labels: PlantCsvLabels = { typeName: (c) => `Tipo ${c}`, state: (c) => `Stato ${c}`, dueKind: (c) => `Cosa ${c}`, workStatus: (c) => `Lavoro ${c}` };
  const register = {
    assets: [{ id: "a1", name: "Casa" }],
    due: [{ kind: "inspection", id: "p1", title: "Verifica caldaia", assetId: "a1", assetName: "Casa", type: "gas", date: "2026-07-01", state: "soon" }],
    groups: [
      {
        assetId: "a1",
        assetName: "Casa",
        type: "gas",
        plant: { id: "i1", name: "=SOMMA(A1)", kind: "gas", installedOn: "2019-03-04", serialNumber: "SN-1", installerName: "Ditta A", maintainerName: null, note: null, documents: [] },
        plans: [{ id: "p1", title: "Verifica caldaia", intervalMonths: 12, supplierName: "Ditta A", lastDoneOn: "2025-07-01", nextDueOn: "2026-07-01", deadlineId: null, note: null }],
        warranties: [{ id: "w1", title: "Garanzia", startsOn: null, endsOn: "2027-01-31", supplierName: null, documentTitle: "Fattura" }],
        works: [{ id: "k1", title: "Sostituzione", status: "completed", supplierName: "Ditta A", completedOn: "2019-03-04", scheduledOn: null }],
        documents: [{ id: "d1", title: "Libretto", categoryName: "Impianti", validTo: null }],
        lastDoneOn: "2025-07-01",
        nextDueOn: "2026-07-01",
        nextState: "soon",
        warrantyEndsOn: "2027-01-31",
        suppliers: ["Ditta A"],
      },
    ],
  } as unknown as Parameters<typeof plantRegisterCsv>[0];

  it("elenca impianti, verifiche, garanzie, interventi, documenti e date, con date gg/mm/aaaa e formule neutralizzate", () => {
    const csv = plantRegisterCsv(register, TODAY, labels);
    expectCsvShape(csv);
    const rows = parseCsv(csv);
    const flat = rows.map((r) => r.join("|"));
    expect(flat).toContain("Casa|'=SOMMA(A1)|Tipo gas|04/03/2019|SN-1|Ditta A||01/07/2025|01/07/2026|Stato soon|31/01/2027|Ditta A");
    expect(flat).toContain("Casa|'=SOMMA(A1)|Verifica caldaia|12|01/07/2025|01/07/2026|Ditta A");
    expect(flat).toContain("Casa|'=SOMMA(A1)|Garanzia||31/01/2027||Fattura");
    expect(flat).toContain("01/07/2026|Cosa inspection|Verifica caldaia|Casa|Tipo gas|Stato soon");
    expect(csv).toContain("Non dice se un impianto sia a norma");
  });
});

describe("polizze per immobile in CSV", () => {
  const data = {
    rows: [
      { assetId: "a1", assetName: "Casa", status: "current", policies: [{ id: "p1", title: "Polizza casa", insurerName: "Compagnia", policyNumber: "N-1", startsOn: "2026-01-01", endsOn: "2026-12-31", state: "active", premiumCents: 24_000, assetIds: ["a1"], openClaims: 1, coverages: [{ title: "Incendio", sumInsuredCents: 10_000_000, deductibleCents: null }] }] },
      { assetId: "a2", assetName: "Box", status: "none", policies: [] },
    ],
    withoutAsset: [{ id: "p2", title: "Polizza generica", insurerName: null, policyNumber: null, startsOn: null, endsOn: null, state: "undated", premiumCents: null, assetIds: [], openClaims: 0, coverages: [] }],
  } as unknown as Parameters<typeof policiesByAssetCsv>[0];

  it("una riga per polizza, una per ogni immobile senza polizza, e le polizze senza immobile", () => {
    const csv = policiesByAssetCsv(data, TODAY, { status: (c) => `Situazione ${c}`, policyState: (c) => `Stato ${c}` });
    expectCsvShape(csv);
    const flat = parseCsv(csv).map((r) => r.join("|"));
    expect(flat).toContain("Casa|Situazione current|Polizza casa|Compagnia|N-1|01/01/2026|31/12/2026|Stato active|240,00|1|Incendio, somma assicurata 100.000,00 €");
    expect(flat).toContain("Box|Situazione none|||||||||");
    expect(flat).toContain("Polizza generica|||||Stato undated||0|");
    expect(flat.some((r) => r.startsWith("Polizze registrate senza immobile collegato"))).toBe(true);
  });
});

describe("scheda per il notaio in CSV", () => {
  const sheet = buildNotarySheet({
    today: TODAY,
    asset: {
      id: "a1",
      kind: "dwelling",
      name: "Casa",
      territoryLabel: "Comune Uno",
      locality: null,
      address: "Via Prova 1",
      postalCode: "00100",
      useType: null,
      inCondominium: false,
      notes: null,
      rights: [{ holder: { id: "h1", displayName: "Mario Rossi" }, rightType: "full", quotaNumerator: 1, quotaDenominator: 2, validFrom: "2020-05-01", validTo: null, notes: null }],
      cadastral: [{ sheet: "10", parcel: "20", subunit: "3", cadastralCategory: "A/2", cadastralClass: "2", consistency: "5 vani", incomeCents: 40_000, validFrom: "2019-01-01", validTo: null, notes: null }],
      attributes: {},
    },
    parties: [{ id: "h1", displayName: "Mario Rossi", taxCode: "RSSMRA80A01H501U", address: null, pec: null, email: null, phone: null }],
    documents: [
      { id: "d-ok", title: "Atto di acquisto", categoryId: "c1", issuedOn: "2020-05-01", validTo: null, verificationStatus: "verified_by_owner" },
      { id: "d-secret", title: "Cartella sanitaria", categoryId: "c1", issuedOn: null, validTo: null, verificationStatus: "draft" },
    ],
    categories: [{ id: "c1", code: "title_deed", name: "Titoli" }],
    dossierItems: [],
    related: [],
    provenances: [{ id: "pr1", kind: "purchase", occurredOn: "2020-05-01", fromName: "Venditore", notaryName: null, deedReference: "Rep. 1", documentId: "d-secret", documentTitle: "Cartella sanitaria", note: null }],
    encumbranceRecords: [],
  });
  const labels: NotaryCsvLabels = { kind: (c) => `Tipo ${c}`, use: same, right: (c) => `Diritto ${c}`, docStatus: (c) => `Verifica ${c}`, provenanceKind: (c) => `Titolo ${c}`, encumbranceKind: same, gap: (g) => `Segnalazione ${g.code}` };

  it("riporta titolarita' con dati dei titolari, catasto, documenti, provenienza e le segnalazioni", () => {
    const csv = notarySheetCsv(sheet, labels);
    expectCsvShape(csv);
    const flat = parseCsv(csv).map((r) => r.join("|"));
    expect(flat).toContain("Mario Rossi|RSSMRA80A01H501U|||Diritto full|1/2|sì|01/05/2020||");
    expect(flat).toContain("10|20|3|A/2|2|5 vani|400,00|01/01/2019||sì");
    expect(flat).toContain("Titoli|Cartella sanitaria|Verifica draft|||no");
    expect(flat.some((r) => r.startsWith("Titolo purchase|01/05/2020|Venditore"))).toBe(true);
    expect(csv).toContain("Non dice se un atto sia possibile");
  });

  it("con un tetto di riservatezza i documenti piu' riservati non compaiono, ne' per titolo ne' come documento collegato", () => {
    const limited = limitNotarySheet(sheet, new Set(["d-ok"]));
    expect(limited.withheld).toBe(1);
    const csv = notarySheetCsv(limited.sheet, labels, { withheldDocuments: limited.withheld });
    expect(csv).toContain("Atto di acquisto");
    expect(csv).not.toContain("Cartella sanitaria");
    expect(csv).toContain("1 documenti non sono elencati perché più riservati del livello scelto");
    expect(limited.sheet.documentTotals.total).toBe(1);
    expect(limited.sheet.provenances[0]).toMatchObject({ documentId: null, documentTitle: null });
  });
});

describe("scheda per l'agente in CSV", () => {
  const base = {
    today: TODAY,
    cap: "ordinary",
    asset: { id: "a1", kind: "dwelling", name: "Casa", useType: null, territoryLabel: "Comune Uno", locality: null, address: "Via Prova 1", postalCode: null, notes: null, attributes: { Vani: 5, Ascensore: true }, cadastral: [], rights: [{ id: "r1", holder: { id: "h1", displayName: "Mario Rossi" }, rightType: "full", quotaNumerator: 1, quotaDenominator: 1, validFrom: null, validTo: null }] },
    condominium: { id: "c1", name: "Condominio Prova", administratorName: "Amministratore X", unitLabel: "Int. 4", expenses: [{ yearLabel: "2025", title: "Ordinario", dueCents: 120_000, paidCents: 100_000 }] },
    works: [{ id: "w1", title: "Tinteggiatura", status: "completed", scheduledOn: null, startedOn: null, completedOn: "2025-09-01", supplierName: "Ditta B", referenceOn: "2025-09-01" }],
    lettings: [{ id: "l1", title: "Locazione 4+4", type: "residential", status: "active", startsOn: "2024-01-01", endsOn: null, monthlyRentCents: 65_000 }],
    documents: { groups: [{ category: { id: "c1", name: "Titoli" }, documents: [{ id: "d1", title: "Atto", categoryId: "c1", confidentiality: "ordinary", issuedOn: null, validTo: null, verificationStatus: "draft" }], withheld: 2 }], checklist: [{ kind: "category_empty", categoryName: "Energia" }], withheldTotal: 2 },
    tracking: { matters: [], deadlines: [] },
  };
  const labels: AgentCsvLabels = { kind: same, use: same, right: (c) => `Diritto ${c}`, docStatus: (c) => `Verifica ${c}`, workStatus: (c) => `Lavoro ${c}`, lettingType: same, lettingStatus: same, level: (c) => `Livello ${c}`, checklist: (c) => `Da fare ${c.kind}` };

  it("i titolari restano fuori se non scelti, gli inquilini non compaiono mai, e i documenti oltre il tetto sono solo contati", () => {
    const hidden = agentSheetCsv({ ...base, rightsHidden: true, asset: { ...base.asset, rights: [] } } as unknown as Parameters<typeof agentSheetCsv>[0], labels);
    expectCsvShape(hidden);
    expect(hidden).not.toContain("Mario Rossi");
    expect(hidden).toContain("I nomi dei titolari non sono inclusi in questa scheda");
    expect(hidden).toContain("Livello ordinary");
    expect(hidden).toContain("2 documenti non sono elencati perché più riservati del livello scelto");
    expect(hidden).toContain("Da fare category_empty");
    expect(hidden).not.toMatch(/inquilin/i);
    const flat = parseCsv(hidden).map((r) => r.join("|"));
    expect(flat).toContain("Locazione 4+4|residential|active|dal 01/01/2024|650,00");
    expect(flat).toContain("2025|Ordinario|1.200,00|1.000,00");
  });

  it("con i titolari scelti compaiono i nomi dei titolari", () => {
    const shown = agentSheetCsv({ ...base, rightsHidden: false } as unknown as Parameters<typeof agentSheetCsv>[0], labels);
    expect(shown).toContain("Mario Rossi");
    expect(shown).not.toContain("I nomi dei titolari non sono inclusi");
  });
});

describe("scheda per il tecnico con tetto di riservatezza", () => {
  it("toglie i documenti non ammessi dai gruppi", () => {
    const brief = { documents: { groups: [{ category: { id: "c", code: "x", name: "X" }, documents: [{ id: "ok" }, { id: "no" }] }], emptyCategories: [], otherCount: 0, expiredCount: 0, technicalCategoryIds: [] } } as unknown as TechnicalBrief;
    expect(limitBrief(brief, new Set(["ok"])).documents.groups[0]!.documents).toEqual([{ id: "ok" }]);
  });
});
