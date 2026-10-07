import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { territory } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { LocalFileStorage } from "@/platform/storage";
import { todayInItaly } from "@/platform/clock";
import { addDays } from "@/shared/dates";
import { createAsset } from "@/modules/assets";
import { createParty } from "@/modules/directory";
import { createDocument, listDocumentCategories } from "@/modules/documents";
import { createInspectionPlan, createWarranty, createWork, getPlantRegister, type PlantTypeDef } from "@/modules/maintenance";
import { importIstat } from "@/modules/territory";
import { buildDueEntries, buildPlantGroups, classifyPlantType, dueState, OTHER_PLANT_TYPE } from "@/modules/maintenance/domain/plants";
import { createTestDb, type TestDb } from "./helpers/test-db";
import { makePdf } from "./helpers/sample-pdf";

const actor = { type: "owner", id: "o1" } as const;
const owner = { displayName: "Proprietario Prova", email: "prova@example.test" };
const TYPES: PlantTypeDef[] = [
  { code: "heating", keywords: ["caldai", "termic"] },
  { code: "lift", keywords: ["ascensor"] },
];

describe("registro impianti: logica pura", () => {
  it("il tipo si ricava dall'inizio di una parola del titolo, senza badare ad accenti e maiuscole", () => {
    expect(classifyPlantType("Manutenzione CALDAIA a condensazione", TYPES)).toBe("heating");
    expect(classifyPlantType("Verifica ascensore", TYPES)).toBe("lift");
    expect(classifyPlantType("Imbiancatura", TYPES)).toBe(OTHER_PLANT_TYPE);
    expect(classifyPlantType("Una a b", [{ code: "x", keywords: ["a"] }])).toBe("x");
  });

  it("lo stato di una data dipende solo da oggi e dalla finestra scelta", () => {
    expect(dueState(null, "2026-06-15", 60)).toBe("none");
    expect(dueState("2026-06-14", "2026-06-15", 60)).toBe("overdue");
    expect(dueState("2026-06-15", "2026-06-15", 60)).toBe("soon");
    expect(dueState("2026-08-14", "2026-06-15", 60)).toBe("soon");
    expect(dueState("2026-08-15", "2026-06-15", 60)).toBe("later");
    expect(dueState("2026-08-15", "2026-06-15", 90)).toBe("soon");
  });

  it("interventi e documenti senza tipo noto non entrano; piani e garanzie senza tipo vanno in «altro»; le scadenze sono ordinate", () => {
    const sources = [
      {
        assetId: "a1",
        assetName: "Casa",
        plans: [
          { id: "p1", title: "Controllo caldaia", intervalMonths: 12, supplierName: "Ditta B", lastDoneOn: "2025-01-10", nextDueOn: "2026-01-10", deadlineId: null, note: null },
          { id: "p2", title: "Verifica ascensore", intervalMonths: 24, supplierName: null, lastDoneOn: null, nextDueOn: "2026-09-01", deadlineId: null, note: null },
          { id: "p3", title: "Giardino", intervalMonths: 6, supplierName: null, lastDoneOn: null, nextDueOn: null, deadlineId: null, note: null },
        ],
        warranties: [{ id: "w1", title: "Garanzia caldaia", startsOn: null, endsOn: "2027-01-01", supplierName: "Ditta A", documentTitle: null }],
        works: [
          { id: "k1", title: "Sostituzione caldaia", status: "completed", supplierName: "Ditta A", completedOn: "2024-01-01", scheduledOn: null },
          { id: "k2", title: "Imbiancatura", status: "completed", supplierName: null, completedOn: null, scheduledOn: null },
        ],
        documents: [
          { id: "d1", title: "Libretto caldaia", categoryName: "Tecnici", validTo: "2026-12-31" },
          { id: "d2", title: "Contratto", categoryName: "Altro", validTo: null },
        ],
      },
    ];
    const groups = buildPlantGroups(sources, TYPES, "2026-06-15", 60);
    expect(groups.map((g) => g.type)).toEqual(["heating", "lift", OTHER_PLANT_TYPE]);
    const heating = groups[0]!;
    expect(heating).toMatchObject({ lastDoneOn: "2025-01-10", nextDueOn: "2026-01-10", nextState: "overdue", warrantyEndsOn: "2027-01-01", suppliers: ["Ditta A", "Ditta B"] });
    expect(heating.works.map((w) => w.id)).toEqual(["k1"]);
    expect(heating.documents.map((d) => d.id)).toEqual(["d1"]);
    expect(groups[2]!.plans.map((p) => p.id)).toEqual(["p3"]);
    expect(groups[2]!.works).toEqual([]);
    expect(buildPlantGroups(sources, TYPES, "2026-06-15", 60, "lift").map((g) => g.type)).toEqual(["lift"]);
    expect(buildDueEntries(groups, "2026-06-15", 60).map((e) => `${e.kind}:${e.id}`)).toEqual(["inspection:p1", "inspection:p2", "document:d1", "warranty:w1"]);
  });
});

describe("registro impianti: dati reali", () => {
  let t: TestDb;
  let dir: string;
  let assetId: string;
  let otherAssetId: string;
  const run = <T>(work: Parameters<typeof runInUnitOfWork<T>>[2]) => runInUnitOfWork(t.db, actor, work);
  const okValue = <V>(r: { ok: boolean; value?: V }): V => {
    if (!r.ok) throw new Error(`atteso successo: ${JSON.stringify(r)}`);
    return r.value as V;
  };

  beforeAll(async () => {
    t = await createTestDb();
    dir = await mkdtemp(join(tmpdir(), "plants-test-"));
    const storage = new LocalFileStorage(dir);
    await run((uow) => importIstat(uow, [{ regionCode: "90", regionName: "Regione di prova", provinceCode: "900", provinceName: "Provincia di prova", provinceSigla: "PP", municipalityCode: "900001", municipalityName: "Comune Uno", cadastralCode: "Z101" }]));
    const municipalityId = (await t.db.select().from(territory).where(eq(territory.kind, "municipality")))[0]!.id;
    assetId = okValue(await run((uow) => createAsset(uow, owner, { kind: "dwelling", name: "Casa Impianti", territoryId: municipalityId }))).id;
    otherAssetId = okValue(await run((uow) => createAsset(uow, owner, { kind: "dwelling", name: "Altra Casa", territoryId: municipalityId }))).id;
    const supplierId = okValue(await run((uow) => createParty(uow, { displayName: "Termoidraulica Prova", roles: ["supplier"] }))).id;
    const categoryId = (await listDocumentCategories(t.db))[0]!.id;
    await run((uow) => createInspectionPlan(uow, { assetId, title: "Controllo caldaia", intervalMonths: "12", firstDueOn: addDays(todayInItaly(), 20), supplierPartyId: supplierId }));
    await run((uow) => createWarranty(uow, { assetId, title: "Garanzia caldaia", endsOn: addDays(todayInItaly(), 400) }));
    await run((uow) => createWork(uow, { assetId, title: "Sostituzione caldaia" }));
    await run((uow) => createWork(uow, { assetId, title: "Imbiancatura" }));
    await run((uow) => createDocument(uow, { title: "Libretto caldaia", categoryId, assetIds: [assetId] }, { name: "libretto.pdf", bytes: makePdf("libretto") }, storage));
    await run((uow) => createDocument(uow, { title: "Libretto caldaia altro immobile", categoryId, assetIds: [otherAssetId] }, { name: "libretto2.pdf", bytes: makePdf("libretto due") }, storage));
  }, 60_000);
  afterAll(async () => {
    await t.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("unisce per immobile piani, garanzie, interventi e documenti dello stesso tipo, con il manutentore dalla rubrica", async () => {
    const today = todayInItaly();
    const reg = await getPlantRegister(t.db, { assetId, types: TYPES, today, soonDays: 60 });
    expect(reg.assets.map((a) => a.id).sort()).toEqual([assetId, otherAssetId].sort());
    expect(reg.groups).toHaveLength(1);
    const g = reg.groups[0]!;
    expect(g).toMatchObject({ assetName: "Casa Impianti", type: "heating", nextState: "soon", suppliers: ["Termoidraulica Prova"] });
    expect(g.plans).toHaveLength(1);
    expect(g.warranties).toHaveLength(1);
    expect(g.works.map((w) => w.title)).toEqual(["Sostituzione caldaia"]);
    expect(g.documents.map((d) => d.title)).toEqual(["Libretto caldaia"]);
    expect(reg.due.map((d) => d.kind)).toEqual(["inspection", "warranty"]);
  });

  it("senza filtro include tutti gli immobili e rispetta il filtro per tipo", async () => {
    const all = await getPlantRegister(t.db, { types: TYPES, today: todayInItaly(), soonDays: 60 });
    expect(all.groups.map((g) => g.assetName).sort()).toEqual(["Altra Casa", "Casa Impianti"]);
    const none = await getPlantRegister(t.db, { types: TYPES, type: "lift", today: todayInItaly(), soonDays: 60 });
    expect(none.groups).toEqual([]);
  });
});
