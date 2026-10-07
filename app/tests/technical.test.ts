import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { auditLog, territory } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { LocalFileStorage } from "@/platform/storage";
import { createAsset } from "@/modules/assets";
import { createParty } from "@/modules/directory";
import { createDocument, listDocumentCategories } from "@/modules/documents";
import { addInvoice, addQuote, createInspectionPlan, createWarranty, createWork } from "@/modules/maintenance";
import { assignParty, addRequest, createMatter } from "@/modules/matters";
import { briefCsv, getTechnicalBrief, workDate, type BriefCsvLabels } from "@/modules/technical";
import { buildBrief, type BriefSource } from "@/modules/technical/domain/brief";
import { importIstat } from "@/modules/territory";
import { conclusiveClaims } from "./helpers/neutral";
import { createTestDb, type TestDb } from "./helpers/test-db";
import { makePdf } from "./helpers/sample-pdf";

const actor = { type: "owner", id: "o1" } as const;
const owner = { displayName: "Proprietario Prova", email: "prova@example.test" };
const TODAY = "2026-06-15";

const labels: BriefCsvLabels = {
  kind: (c) => c,
  use: (c) => c,
  right: (c) => c,
  workStatus: (c) => c,
  matterStatus: (c) => c,
  dossierStatus: (c) => c,
  verification: (c) => c,
  warrantyState: (c) => c,
};

const baseAsset: BriefSource["asset"] = {
  id: "a1",
  name: "Appartamento",
  kind: "dwelling",
  useType: null,
  territoryLabel: "Comune Uno",
  locality: null,
  address: null,
  postalCode: null,
  inCondominium: false,
  notes: null,
  attributes: {},
  cadastral: [],
  rights: [],
};
const cats = [
  { id: "c1", code: "cadastral", name: "Catasto" },
  { id: "c2", code: "building", name: "Edilizia" },
  { id: "c3", code: "taxes", name: "Tributi" },
];
const source = (over: Partial<BriefSource> = {}): BriefSource => ({ asset: baseAsset, categories: cats, documents: [], dossierItems: [], works: [], warranties: [], plans: [], deadlines: [], matters: [], ...over });
const work = (over: Partial<BriefSource["works"][number]> = {}): BriefSource["works"][number] => ({ id: "w", title: "Lavoro", status: "completed", supplierName: null, scheduledOn: null, startedOn: null, completedOn: null, budgetCents: null, acceptedQuotesCents: 0, invoicedCents: 0, paidCents: 0, lastPercent: null, ...over });

describe("scheda per il tecnico: dominio", () => {
  it("raggruppa i documenti nelle sole categorie tecniche, segnala le categorie vuote e conta gli altri", () => {
    const brief = buildBrief(
      source({
        documents: [
          { id: "d1", title: "Visura", categoryId: "c1", categoryName: "Catasto", issuedOn: "2025-01-01", validTo: "2026-01-01", verificationStatus: "draft" },
          { id: "d2", title: "F24", categoryId: "c3", categoryName: "Tributi", issuedOn: null, validTo: null, verificationStatus: "draft" },
        ],
      }),
      TODAY,
    );
    expect(brief.documents.groups.map((g) => g.category.code)).toEqual(["cadastral", "building"]);
    expect(brief.documents.groups[0]!.documents[0]).toMatchObject({ title: "Visura", expired: true });
    expect(brief.documents.expiredCount).toBe(1);
    expect(brief.documents.emptyCategories.map((c) => c.code)).toEqual(["building"]);
    expect(brief.documents.otherCount).toBe(1);
    expect(brief.documents.technicalCategoryIds).toEqual(["c1", "c2"]);
  });

  it("del dossier prende solo le voci tecniche ancora da raccogliere o da rivedere", () => {
    const item = (id: string, categoryCode: string, status: string, stale = false) => ({ id, title: id, status, stale, categoryCode, categoryName: categoryCode, documentCount: 0, expiredDocumentCount: 0 });
    const brief = buildBrief(source({ dossierItems: [item("a", "cadastre", "missing"), item("b", "cadastre", "present"), item("c", "taxes", "missing"), item("d", "systems", "present", true), item("e", "building", "expired")] }), TODAY);
    expect(brief.dossier.total).toBe(4);
    expect(brief.dossier.counts).toEqual({ missing: 1, present: 2, expired: 1 });
    expect(brief.dossier.toCollect.map((i) => i.id)).toEqual(["a", "d", "e"]);
  });

  it("ordina gli interventi dal piu' recente (fine, inizio o data prevista) e somma gli importi registrati", () => {
    const brief = buildBrief(source({ works: [work({ id: "1", title: "Vecchio", completedOn: "2020-05-01", acceptedQuotesCents: 100, invoicedCents: 90, paidCents: 50 }), work({ id: "2", title: "Previsto", scheduledOn: "2027-01-01" }), work({ id: "3", title: "Senza data", invoicedCents: 10 })] }), TODAY);
    expect(brief.works.rows.map((w) => w.id)).toEqual(["2", "1", "3"]);
    expect(brief.works.totals).toEqual({ acceptedQuotesCents: 100, invoicedCents: 100, paidCents: 50 });
    expect(workDate(work({ startedOn: "2024-01-01", scheduledOn: "2023-01-01" }))).toBe("2024-01-01");
  });

  it("il CSV ha le sezioni, neutralizza le formule e non contiene verdetti", () => {
    const brief = buildBrief(source({ asset: { ...baseAsset, name: "=SOMMA(A1)", cadastral: [{ sheet: "12", parcel: "34", subunit: "5", cadastralCategory: "A/2", cadastralClass: "3", consistency: "5 vani", incomeCents: 123456, validFrom: "2010-01-01", validTo: null, notes: null }] } }), TODAY);
    const csv = briefCsv(brief, labels);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("'=SOMMA(A1)");
    expect(csv).toContain("Dati catastali (storico)");
    expect(csv).toContain("1.234,56");
    expect(csv).toContain("Storico degli interventi");
    expect(conclusiveClaims(csv)).toEqual([]);
  });
});

describe("scheda per il tecnico: dai moduli", () => {
  let t: TestDb;
  let dir: string;
  let storage: LocalFileStorage;
  let assetId: string;
  let otherAssetId: string;
  const run = <V>(work: Parameters<typeof runInUnitOfWork<V>>[2]) => runInUnitOfWork(t.db, actor, work);
  const okValue = <V>(r: { ok: boolean; value?: V }): V => {
    if (!r.ok) throw new Error(`atteso successo: ${JSON.stringify(r)}`);
    return r.value as V;
  };

  beforeAll(async () => {
    t = await createTestDb();
    dir = await mkdtemp(join(tmpdir(), "technical-test-"));
    storage = new LocalFileStorage(dir);
    await run((uow) => importIstat(uow, [{ regionCode: "90", regionName: "Regione di prova", provinceCode: "900", provinceName: "Provincia di prova", provinceSigla: "PP", municipalityCode: "900001", municipalityName: "Comune Uno", cadastralCode: "Z101" }]));
    const municipalityId = (await t.db.select().from(territory).where(eq(territory.kind, "municipality")))[0]!.id;
    assetId = okValue(
      await run((uow) =>
        createAsset(uow, owner, {
          kind: "dwelling",
          name: "Appartamento Tecnico",
          territoryId: municipalityId,
          cadastral: [{ sheet: "10", parcel: "20", subunit: "3", cadastralCategory: "A/3", income: "500,00" }],
          attributes: [{ key: "anno_costruzione", type: "number", value: "1975" }],
        }),
      ),
    ).id;
    otherAssetId = okValue(await run((uow) => createAsset(uow, owner, { kind: "garage", name: "Box Altro", territoryId: municipalityId }))).id;
  }, 60_000);
  afterAll(async () => {
    await t.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("un bene che non esiste non ha scheda", async () => {
    expect(await getTechnicalBrief(t.db, "00000000-0000-4000-8000-000000000000", TODAY)).toBeNull();
  });

  it("mette insieme scheda, catasto, documenti, interventi, garanzie, ispezioni e pratiche del solo bene richiesto", async () => {
    const categories = await listDocumentCategories(t.db);
    const cadastral = categories.find((c) => c.code === "cadastral")!;
    const taxes = categories.find((c) => c.code === "taxes")!;
    await run((uow) => createDocument(uow, { title: "Visura storica", categoryId: cadastral.id, assetIds: [assetId], validTo: "2026-01-31" }, { name: "visura.pdf", bytes: makePdf("visura") }, storage));
    await run((uow) => createDocument(uow, { title: "Ricevuta", categoryId: taxes.id, assetIds: [assetId] }, { name: "ricevuta.pdf", bytes: makePdf("ricevuta") }, storage));
    await run((uow) => createDocument(uow, { title: "Documento di un altro bene", categoryId: cadastral.id, assetIds: [otherAssetId] }, { name: "altro.pdf", bytes: makePdf("altro") }, storage));

    const supplierId = okValue(await run((uow) => createParty(uow, { displayName: "Impresa Esempio", roles: ["supplier"] }))).id;
    const workId = okValue(await run((uow) => createWork(uow, { assetId, title: "Rifacimento tetto", supplierPartyId: supplierId, completedOn: "2024-09-30" }))).id;
    await run((uow) => addQuote(uow, workId, { amount: "10.000,00", status: "accepted" }));
    await run((uow) => addInvoice(uow, workId, { issuedOn: "2024-10-01", amount: "9.500,00", paidOn: "2024-10-15" }));
    await run((uow) => createWork(uow, { assetId: otherAssetId, title: "Lavoro del box" }));
    await run((uow) => createWarranty(uow, { assetId, workId, title: "Garanzia tetto", endsOn: "2034-09-30" }));
    await run((uow) => createInspectionPlan(uow, { assetId, title: "Verifica periodica", intervalMonths: 12, firstDueOn: "2026-09-01" }));
    const matterId = okValue(await run((uow) => createMatter(uow, { title: "Rilievo", assetId }, TODAY))).id;
    const surveyorId = okValue(await run((uow) => createParty(uow, { displayName: "Geometra Esempio", roles: ["surveyor"] }))).id;
    await run((uow) => assignParty(uow, matterId, { partyId: surveyorId }));
    await run((uow) => addRequest(uow, matterId, { title: "Planimetria aggiornata", dueOn: "2026-07-01" }, TODAY));

    const brief = (await getTechnicalBrief(t.db, assetId, TODAY))!;
    expect(brief.asset.attributes).toEqual({ anno_costruzione: 1975 });
    expect(brief.asset.cadastral).toHaveLength(1);
    expect(brief.asset.cadastral[0]).toMatchObject({ sheet: "10", incomeCents: 50000 });

    const docs = brief.documents.groups.find((g) => g.category.code === "cadastral")!.documents;
    expect(docs.map((d) => d.title)).toEqual(["Visura storica"]);
    expect(docs[0]!.expired).toBe(true);
    expect(brief.documents.otherCount).toBe(1);
    expect(brief.documents.emptyCategories.map((c) => c.code)).toContain("building");

    expect(brief.works.rows.map((w) => w.title)).toEqual(["Rifacimento tetto"]);
    expect(brief.works.rows[0]).toMatchObject({ supplierName: "Impresa Esempio", acceptedQuotesCents: 1_000_000, invoicedCents: 950_000, paidCents: 950_000 });
    expect(brief.warranties.map((w) => w.title)).toEqual(["Garanzia tetto"]);
    expect(brief.plans.map((p) => p.title)).toEqual(["Verifica periodica"]);
    expect(brief.matters).toHaveLength(1);
    expect(brief.matters[0]).toMatchObject({ title: "Rilievo", assignees: ["Geometra Esempio"] });
    expect(brief.matters[0]!.openRequests).toEqual([{ title: "Planimetria aggiornata", dueOn: "2026-07-01", overdue: false }]);

    const csv = briefCsv(brief, labels);
    expect(csv).toContain("Visura storica");
    expect(csv).not.toContain("Documento di un altro bene");
    expect(csv).not.toContain("Lavoro del box");
    expect(conclusiveClaims(csv)).toEqual([]);
  });

  it("e' di sola lettura: non scrive nell'audit", async () => {
    const before = (await t.db.select().from(auditLog)).length;
    await getTechnicalBrief(t.db, assetId, TODAY);
    expect((await t.db.select().from(auditLog)).length).toBe(before);
  });
});
