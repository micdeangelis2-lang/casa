import { describe, expect, it } from "vitest";
import { agentPackageHref, buildDocumentSection, ordinaryExpenses, recentWorks } from "@/modules/agent/domain/sheet";

const doc = (id: string, categoryId: string, confidentiality: "ordinary" | "reserved" | "highly_reserved", validTo: string | null = null) => ({ id, title: `Doc ${id}`, categoryId, confidentiality, issuedOn: null, validTo, verificationStatus: "to_verify" });
const categories = [
  { id: "c1", name: "Catasto" },
  { id: "c2", name: "Energia" },
  { id: "c3", name: "Altro" },
];

describe("scheda agente: documenti e elenco da preparare", () => {
  it("non elenca i documenti oltre il livello scelto, ne mostra solo il numero", () => {
    const s = buildDocumentSection({ documents: [doc("1", "c1", "ordinary"), doc("2", "c1", "reserved"), doc("3", "c2", "highly_reserved")], categories, cap: "ordinary", focusCategoryIds: null, dossier: [], today: "2026-10-06" });
    expect(s.groups.find((g) => g.category.id === "c1")).toMatchObject({ withheld: 1 });
    expect(s.groups.flatMap((g) => g.documents.map((d) => d.id))).toEqual(["1"]);
    expect(s.withheldTotal).toBe(2);
    expect(s.checklist).toEqual(expect.arrayContaining([{ kind: "category_withheld", categoryName: "Energia", count: 1 }, { kind: "category_empty", categoryName: "Altro" }]));
  });

  it("segnala date di validita' passate e voci del dossier aperte, e rispetta le categorie scelte", () => {
    const s = buildDocumentSection({
      documents: [doc("1", "c1", "ordinary", "2026-01-01"), doc("2", "c2", "ordinary", "2027-01-01")],
      categories,
      cap: "ordinary",
      focusCategoryIds: ["c1", "c3"],
      dossier: [{ title: "Voce A", status: "missing" }, { title: "Voce B", status: "present" }, { title: "Voce C", status: "requested" }],
      today: "2026-10-06",
    });
    expect(s.checklist).toEqual([
      { kind: "category_empty", categoryName: "Altro" },
      { kind: "document_expired", title: "Doc 1", validTo: "2026-01-01" },
      { kind: "dossier_open", title: "Voce A", status: "missing" },
      { kind: "dossier_open", title: "Voce C", status: "requested" },
    ]);
  });
});

describe("scheda agente: spese, interventi, collegamento", () => {
  it("somma solo le rate ordinarie dell'immobile", () => {
    const years = [{ label: "2026", budgets: [{ kind: "ordinary", title: "Prev", installments: [{ assetId: "a", amountCents: 100, paidCents: 40 }, { assetId: "a", amountCents: 50, paidCents: 50 }, { assetId: "b", amountCents: 999, paidCents: 0 }] }, { kind: "extraordinary", title: "Str", installments: [{ assetId: "a", amountCents: 7, paidCents: 0 }] }] }];
    expect(ordinaryExpenses(years, "a")).toEqual([{ yearLabel: "2026", title: "Prev", dueCents: 150, paidCents: 90 }]);
    expect(ordinaryExpenses(years, "zzz")).toEqual([]);
  });

  it("ordina gli interventi dal piu' recente, esclude gli annullati, senza date in fondo", () => {
    const w = (id: string, status: string, completedOn: string | null, scheduledOn: string | null = null) => ({ id, title: id, status, scheduledOn, startedOn: null, completedOn, supplierName: null });
    const r = recentWorks([w("vecchio", "completed", "2020-01-01"), w("nuovo", "completed", "2026-03-01"), w("annullato", "cancelled", "2026-09-01"), w("senza", "planned", null), w("previsto", "planned", null, "2025-05-05")]);
    expect(r.map((x) => x.id)).toEqual(["nuovo", "previsto", "vecchio", "senza"]);
  });

  it("l'indirizzo del pacchetto usa il livello ordinario e non mette nomi", () => {
    const href = agentPackageHref({ assetId: "A1", categoryIds: ["c1"], contactId: "P1" });
    expect(href).toBe("/condivisione/nuovo?destinatario=agent&livello=ordinary&immobile=A1&categoria=c1&contatto=P1&mostra=1");
  });
});
