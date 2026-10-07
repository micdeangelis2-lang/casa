import { describe, expect, it } from "vitest";
import { briefCsv, workDate, type BriefCsvLabels } from "@/modules/technical";
import { buildBrief, type BriefSource } from "@/modules/technical/domain/brief";

const TODAY = "2026-06-15";
const labels: BriefCsvLabels = {
  kind: (c) => `K:${c}`,
  use: (c) => `U:${c}`,
  right: (c) => `R:${c}`,
  workStatus: (c) => `W:${c}`,
  matterStatus: (c) => `M:${c}`,
  dossierStatus: (c) => `D:${c}`,
  verification: (c) => `V:${c}`,
  warrantyState: (c) => `G:${c}`,
};
const asset: BriefSource["asset"] = { id: "a1", name: "Casa", kind: "dwelling", useType: null, territoryLabel: "Comune", locality: null, address: null, postalCode: null, inCondominium: false, notes: null, attributes: {}, cadastral: [], rights: [] };
const source = (over: Partial<BriefSource> = {}): BriefSource => ({ asset, categories: [{ id: "c1", code: "cadastral", name: "Catasto" }], documents: [], dossierItems: [], works: [], warranties: [], plans: [], deadlines: [], matters: [], ...over });
const work = (o: Partial<BriefSource["works"][number]> = {}): BriefSource["works"][number] => ({ id: "w", title: "Lavoro", status: "completed", supplierName: null, scheduledOn: null, startedOn: null, completedOn: null, budgetCents: null, acceptedQuotesCents: 0, invoicedCents: 0, paidCents: 0, lastPercent: null, ...o });

describe("scheda tecnico: casi limite del dominio", () => {
  it("scheda vuota: nessuna voce, totali a zero, nessun errore", () => {
    const b = buildBrief(source({ categories: [] }), TODAY);
    expect(b.documents).toMatchObject({ groups: [], emptyCategories: [], otherCount: 0, expiredCount: 0, technicalCategoryIds: [] });
    expect(b.dossier).toEqual({ total: 0, counts: {}, toCollect: [] });
    expect(b.works.totals).toEqual({ acceptedQuotesCents: 0, invoicedCents: 0, paidCents: 0 });
  });

  it("documenti: il giorno di scadenza non e' ancora scaduto; ordine per data di emissione decrescente poi titolo; senza data in fondo", () => {
    const d = (id: string, title: string, issuedOn: string | null, validTo: string | null) => ({ id, title, categoryId: "c1", categoryName: "Catasto", issuedOn, validTo, verificationStatus: "draft" });
    const b = buildBrief(source({ documents: [d("1", "Zeta", "2024-01-01", null), d("2", "Alfa", "2024-01-01", TODAY), d("3", "Senza", null, "2026-06-14"), d("4", "Nuovo", "2025-01-01", null)] }), TODAY);
    const rows = b.documents.groups[0]!.documents;
    expect(rows.map((r) => r.title)).toEqual(["Nuovo", "Alfa", "Zeta", "Senza"]);
    expect(rows.find((r) => r.title === "Alfa")?.expired).toBe(false);
    expect(b.documents.expiredCount).toBe(1);
  });

  it("interventi con la stessa data: ordine per titolo; le scadenze si ordinano per data", () => {
    const b = buildBrief(
      source({
        works: [work({ id: "1", title: "Zeta", completedOn: "2024-01-01" }), work({ id: "2", title: "Alfa", completedOn: "2024-01-01" })],
        deadlines: [{ id: "x", title: "B", dueOn: "2026-09-01", overdue: false }, { id: "y", title: "A", dueOn: "2026-07-01", overdue: false }],
      }),
      TODAY,
    );
    expect(b.works.rows.map((w) => w.title)).toEqual(["Alfa", "Zeta"]);
    expect(b.deadlines.map((d) => d.id)).toEqual(["y", "x"]);
    expect(workDate(work())).toBeNull();
  });

  it("CSV di una scheda vuota: intestazioni di sezione, senza righe e senza «undefined» o «null»", () => {
    const csv = briefCsv(buildBrief(source(), TODAY), labels);
    for (const title of ["Bene", "Caratteristiche tecniche", "Titolarità registrata", "Storico degli interventi", "Garanzie registrate", "Pratiche aperte del bene"]) expect(csv).toContain(title);
    expect(csv).not.toMatch(/undefined|null|NaN/);
    expect(csv).toContain("Totali registrati");
  });

  it("CSV completo: etichette, date italiane, importi, booleani, indirizzo con CAP, righe senza valori", () => {
    const b = buildBrief(
      source({
        asset: {
          ...asset,
          useType: "residential",
          address: "Via Roma 1",
          postalCode: "00100",
          inCondominium: true,
          attributes: { riscaldamento: true, vani: 5, tipo: "autonomo", assente: false },
          rights: [{ holderName: "Mario", rightType: "ownership", quotaNumerator: 1, quotaDenominator: 2, validFrom: "2020-03-04", validTo: null }],
          cadastral: [{ sheet: null, parcel: null, subunit: null, cadastralCategory: null, cadastralClass: null, consistency: null, incomeCents: null, validFrom: null, validTo: "2019-12-31", notes: null }],
        },
        dossierItems: [{ id: "i", title: "Agibilità", status: "missing", stale: true, categoryCode: "habitability", categoryName: "Abitabilità", documentCount: 0, expiredDocumentCount: 0 }],
        works: [work({ title: "Tetto", status: "completed", completedOn: "2025-02-03", budgetCents: 0, lastPercent: 100 })],
        warranties: [{ id: "g", title: "Garanzia tetto", startsOn: null, endsOn: "2030-01-31", state: "active", supplierName: "Ditta", workTitle: null }],
        plans: [{ id: "p", title: "Caldaia", intervalMonths: 12, nextDueOn: null, lastDoneOn: "2025-10-01", supplierName: null }],
        matters: [{ id: "m", title: "Sanatoria", status: "open", openedOn: "2026-01-02", assignees: ["Geom. A", "Arch. B"], openRequests: [{ title: "Planimetria", dueOn: null, overdue: false }, { title: "Visura", dueOn: null, overdue: false }] }],
      }),
      TODAY,
    );
    const csv = briefCsv(b, labels);
    expect(csv).toContain("U:residential");
    expect(csv).toContain("Via Roma 1 – 00100");
    expect(csv).toContain("riscaldamento;sì");
    expect(csv).toContain("vani;5");
    expect(csv).toContain("04/03/2020");
    expect(csv).toContain("31/12/2019");
    expect(csv).toContain("1/2");
    expect(csv).toContain("D:missing;sì");
    expect(csv).toContain("03/02/2025");
    expect(csv).toContain("Geom. A / Arch. B");
    expect(csv).toContain("Planimetria / Visura");
    expect(csv).toContain("31/01/2030");
  });
});
