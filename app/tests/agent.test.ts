import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { territory } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { LocalFileStorage } from "@/platform/storage";
import { getAgentSheet } from "@/modules/agent";
import { createAsset, getAssetDetail } from "@/modules/assets";
import { addMember, createBudget, createCondominium, createFiscalYear, createTable, generateInstallments, getCondominiumDetail, saveShares } from "@/modules/condominium";
import { createDocument, listDocumentCategories } from "@/modules/documents";
import { createLetting } from "@/modules/lettings";
import { createWork } from "@/modules/maintenance";
import { createMatter } from "@/modules/matters";
import { importIstat } from "@/modules/territory";
import { createTestDb, type TestDb } from "./helpers/test-db";
import { makePdf } from "./helpers/sample-pdf";

const actor = { type: "owner", id: "o1" } as const;
const owner = { displayName: "Proprietario Prova", email: "prova@example.test" };
const TODAY = "2026-10-06";

describe("scheda per l'agente: dai moduli", () => {
  let t: TestDb;
  let dir: string;
  let storage: LocalFileStorage;
  let assetId: string;

  const run = <V>(work: Parameters<typeof runInUnitOfWork<V>>[2]) => runInUnitOfWork(t.db, actor, work);
  const okValue = <V>(r: { ok: boolean; value?: V }): V => {
    if (!r.ok) throw new Error(`atteso successo: ${JSON.stringify(r)}`);
    return r.value as V;
  };

  beforeAll(async () => {
    t = await createTestDb();
    dir = await mkdtemp(join(tmpdir(), "agent-test-"));
    storage = new LocalFileStorage(dir);
    await run((uow) => importIstat(uow, [{ regionCode: "90", regionName: "Regione di prova", provinceCode: "900", provinceName: "Provincia di prova", provinceSigla: "PP", municipalityCode: "900001", municipalityName: "Comune Uno", cadastralCode: "Z101" }]));
    const municipalityId = (await t.db.select().from(territory).where(eq(territory.kind, "municipality")))[0]!.id;
    assetId = okValue(await run((uow) => createAsset(uow, owner, { kind: "dwelling", name: "Appartamento Agente", territoryId: municipalityId, address: "Via Prova 1" }))).id;
  }, 60_000);
  afterAll(async () => {
    await t.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("immobile inesistente: nessuna scheda", async () => {
    expect(await getAgentSheet(t.db, "00000000-0000-4000-8000-000000000000", { today: TODAY })).toBeNull();
  });

  it("raccoglie spese ordinarie, interventi, locazione, documenti entro il livello e pratiche, senza nomi di terzi", async () => {
    const asset = await getAssetDetail(t.db, assetId);
    expect(asset).not.toBeNull();
    const condoId = okValue(await run((uow) => createCondominium(uow, { name: "Condominio Agente" }))).id;
    okValue(await run((uow) => addMember(uow, condoId, { assetId, unitLabel: "Interno 4" })));
    okValue(await run((uow) => createTable(uow, condoId, { name: "Generale" })));
    const tableId = (await getCondominiumDetail(t.db, condoId))!.tables[0]!.id;
    okValue(await run((uow) => saveShares(uow, tableId, [{ assetId, value: "1000" }])));
    okValue(await run((uow) => createFiscalYear(uow, condoId, { label: "2026", startsOn: "2026-01-01", endsOn: "2026-12-31" })));
    const yearId = (await getCondominiumDetail(t.db, condoId))!.years[0]!.id;
    okValue(await run((uow) => createBudget(uow, yearId, { kind: "ordinary", title: "Preventivo ordinario", total: "1.200,00", millesimalTableId: tableId })));
    okValue(await run((uow) => createBudget(uow, yearId, { kind: "extraordinary", title: "Straordinario", total: "500,00", millesimalTableId: tableId })));
    const budgets = (await getCondominiumDetail(t.db, condoId))!.years[0]!.budgets;
    await run((uow) => generateInstallments(uow, budgets.find((b) => b.kind === "ordinary")!.id, { count: 4, firstDueOn: "2026-03-01", everyMonths: 3 }));

    okValue(await run((uow) => createWork(uow, { assetId, title: "Rifacimento bagno", status: "completed", completedOn: "2026-02-10" })));
    okValue(await run((uow) => createLetting(uow, { assetId, type: "residential", title: "Contratto in corso", status: "active", startsOn: "2025-01-01", monthlyRent: "700,00" })));
    okValue(await run((uow) => createMatter(uow, { title: "Vendita con agenzia", assetId }, TODAY)));

    const categories = await listDocumentCategories(t.db);
    const cadastral = categories.find((c) => c.code === "cadastral")!;
    okValue(await run((uow) => createDocument(uow, { title: "Planimetria", categoryId: cadastral.id, assetIds: [assetId] }, { name: "plan.pdf", bytes: makePdf("planimetria") }, storage)));
    okValue(await run((uow) => createDocument(uow, { title: "Atto riservato", categoryId: cadastral.id, assetIds: [assetId], confidentiality: "highly_reserved" }, { name: "atto.pdf", bytes: makePdf("atto") }, storage)));

    const sheet = (await getAgentSheet(t.db, assetId, { today: TODAY, focusCategoryIds: [cadastral.id, categories.find((c) => c.code === "energy")!.id] }))!;
    expect(sheet.condominium).toMatchObject({ name: "Condominio Agente", unitLabel: "Interno 4", expenses: [{ yearLabel: "2026", title: "Preventivo ordinario", dueCents: 120_000, paidCents: 0 }] });
    expect(sheet.works.map((w) => [w.title, w.referenceOn])).toEqual([["Rifacimento bagno", "2026-02-10"]]);
    expect(sheet.lettings).toMatchObject([{ title: "Contratto in corso", monthlyRentCents: 70_000 }]);
    // Riservatezza: il documento molto riservato non e' elencato, e' solo contato.
    expect(sheet.documents.groups.flatMap((g) => g.documents.map((d) => d.title))).toEqual(["Planimetria"]);
    expect(sheet.documents.withheldTotal).toBe(1);
    expect(sheet.documents.checklist.map((c) => c.kind)).toEqual(["category_empty"]);
    expect(sheet.tracking.matters.map((m) => m.title)).toEqual(["Vendita con agenzia"]);
    // Titolari: esclusi per impostazione predefinita.
    expect(sheet.asset.rights).toEqual([]);
    expect(JSON.stringify(sheet)).not.toContain("Proprietario Prova");
  });
});
