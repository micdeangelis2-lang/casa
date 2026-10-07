import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { auditLog, maintInspectionPlan, plant, territory } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { LocalFileStorage } from "@/platform/storage";
import { createAsset } from "@/modules/assets";
import { createParty } from "@/modules/directory";
import { createDocument, listDocumentCategories } from "@/modules/documents";
import {
  PLANT_KINDS,
  assignPlant,
  createInspectionPlan,
  createPlant,
  createWarranty,
  createWork,
  getPlantDetail,
  getPlantRegister,
  linkPlantDocument,
  listPlants,
  setPlantArchived,
  unlinkPlantDocument,
  updatePlant,
  updateWork,
  type PlantTypeDef,
} from "@/modules/maintenance";
import { importIstat } from "@/modules/territory";
import { createTestDb, type TestDb } from "./helpers/test-db";
import { makePdf } from "./helpers/sample-pdf";

const actor = { type: "owner", id: "o1" } as const;
const owner = { displayName: "Proprietario Prova", email: "prova@example.test" };
const TYPES: PlantTypeDef[] = [
  { code: "heating", keywords: ["caldai", "termic"] },
  { code: "lift", keywords: ["ascensor"] },
];
const TODAY = "2026-06-15";
const MISSING = "00000000-0000-4000-8000-000000000000";

describe("impianti come entita'", () => {
  let t: TestDb;
  let dir: string;
  let storage: LocalFileStorage;
  let assetA: string;
  let assetB: string;
  let installerId: string;
  let maintainerId: string;
  let docBoiler: string;
  const run = <T>(work: Parameters<typeof runInUnitOfWork<T>>[2]) => runInUnitOfWork(t.db, actor, work);
  const okValue = <V>(r: { ok: boolean; value?: V }): V => {
    if (!r.ok) throw new Error(`atteso successo: ${JSON.stringify(r)}`);
    return r.value as V;
  };

  beforeAll(async () => {
    t = await createTestDb();
    dir = await mkdtemp(join(tmpdir(), "plants-test-"));
    storage = new LocalFileStorage(dir);
    await run((uow) => importIstat(uow, [{ regionCode: "90", regionName: "Regione di prova", provinceCode: "900", provinceName: "Provincia di prova", provinceSigla: "PP", municipalityCode: "900001", municipalityName: "Comune Uno", cadastralCode: "Z101" }]));
    const municipalityId = (await t.db.select().from(territory).where(eq(territory.kind, "municipality")))[0]!.id;
    assetA = okValue(await run((uow) => createAsset(uow, owner, { kind: "dwelling", name: "Casa A", territoryId: municipalityId }))).id;
    assetB = okValue(await run((uow) => createAsset(uow, owner, { kind: "dwelling", name: "Casa B", territoryId: municipalityId }))).id;
    installerId = okValue(await run((uow) => createParty(uow, { displayName: "Ditta Installatrice" }))).id;
    maintainerId = okValue(await run((uow) => createParty(uow, { displayName: "Ditta Manutentrice" }))).id;
    const categoryId = (await listDocumentCategories(t.db))[0]!.id;
    docBoiler = okValue(await run((uow) => createDocument(uow, { title: "Libretto caldaia", categoryId }, { name: "libretto.pdf", bytes: makePdf("libretto") }, storage))).id;
  }, 60_000);
  afterAll(async () => {
    await t.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("i tipi ammessi sono quelli dei dati e il database li fa rispettare", async () => {
    expect([...PLANT_KINDS]).toEqual(["solar", "electrical", "lift", "fire", "cooling", "gas", "heating", "water", "other"]);
    expect(await run((uow) => createPlant(uow, { assetId: assetA, kind: "nucleare", name: "X" }))).toMatchObject({ ok: false, errors: { kind: expect.any(Array) } });
    await expect(t.db.insert(plant).values({ assetId: assetA, kind: "nucleare", name: "X" })).rejects.toThrow();
  });

  it("registra, modifica e archivia un impianto con installatore e manutentore dalla rubrica; l'audit non riporta i valori", async () => {
    expect(await run((uow) => createPlant(uow, { assetId: MISSING, kind: "heating", name: "X" }))).toMatchObject({ ok: false, errors: { assetId: expect.any(Array) } });
    expect(await run((uow) => createPlant(uow, { assetId: assetA, kind: "heating", name: "  " }))).toMatchObject({ ok: false, errors: { name: expect.any(Array) } });
    expect(await run((uow) => createPlant(uow, { assetId: assetA, kind: "heating", name: "X", installerPartyId: MISSING }))).toMatchObject({ ok: false });

    const id = okValue(
      await run((uow) => createPlant(uow, { assetId: assetA, kind: "heating", name: "Caldaia principale", installedOn: "2019-03-01", installerPartyId: installerId, maintainerPartyId: maintainerId, serialNumber: "MATRICOLA-SEGRETA-1" })),
    ).id;
    expect(await getPlantDetail(t.db, id)).toMatchObject({ assetName: "Casa A", kind: "heating", name: "Caldaia principale", installerName: "Ditta Installatrice", maintainerName: "Ditta Manutentrice", serialNumber: "MATRICOLA-SEGRETA-1", archived: false });

    okValue(await run((uow) => updatePlant(uow, id, { kind: "heating", name: "Caldaia a condensazione", installerPartyId: installerId })));
    expect(await getPlantDetail(t.db, id)).toMatchObject({ name: "Caldaia a condensazione", maintainerName: null, serialNumber: null });
    expect(await run((uow) => updatePlant(uow, MISSING, { kind: "heating", name: "X" }))).toMatchObject({ ok: false });

    const audits = await t.db.select().from(auditLog).where(eq(auditLog.entityId, id));
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["maintenance.plant.create", "maintenance.plant.update"]));
    expect(JSON.stringify(audits.map((a) => a.diff))).not.toContain("SEGRETA");
    expect(JSON.stringify(audits.map((a) => a.diff))).not.toContain("condensazione");

    await run((uow) => setPlantArchived(uow, id, true));
    expect((await listPlants(t.db, { assetId: assetA })).map((p) => p.id)).not.toContain(id);
    expect((await listPlants(t.db, { assetId: assetA, includeArchived: true })).map((p) => p.id)).toContain(id);
    await run((uow) => setPlantArchived(uow, id, false));
  });

  it("piani, garanzie, interventi e documenti si collegano all'impianto, solo dello stesso immobile; il registro usa il dato vero", async () => {
    const boiler = (await listPlants(t.db, { assetId: assetA }))[0]!;
    const planId = okValue(await run((uow) => createInspectionPlan(uow, { assetId: assetA, title: "Controllo periodico", intervalMonths: 12, firstDueOn: "2026-09-01", plantId: boiler.id }))).id;
    // Un impianto di un altro immobile o inesistente viene rifiutato.
    const other = okValue(await run((uow) => createPlant(uow, { assetId: assetB, kind: "lift", name: "Ascensore B" }))).id;
    expect(await run((uow) => createInspectionPlan(uow, { assetId: assetA, title: "X", intervalMonths: 12, firstDueOn: "2026-09-01", plantId: other }))).toMatchObject({ ok: false, errors: { plantId: ["L'impianto appartiene a un altro immobile"] } });
    expect(await run((uow) => createWarranty(uow, { assetId: assetA, title: "X", endsOn: "2030-01-01", plantId: MISSING }))).toMatchObject({ ok: false, errors: { plantId: expect.any(Array) } });

    const warrantyId = okValue(await run((uow) => createWarranty(uow, { assetId: assetA, title: "Garanzia generica", endsOn: "2030-01-01", plantId: boiler.id }))).id;
    const workId = okValue(await run((uow) => createWork(uow, { assetId: assetA, title: "Lavori vari", status: "completed", plantId: boiler.id }))).id;
    // Elementi senza collegamento: restano al ripiego per parola chiave.
    okValue(await run((uow) => createInspectionPlan(uow, { assetId: assetA, title: "Verifica ascensore", intervalMonths: 24, firstDueOn: "2026-10-01" })));
    const looseWork = okValue(await run((uow) => createWork(uow, { assetId: assetA, title: "Giardino", status: "completed" }))).id;
    expect(await run((uow) => assignPlant(uow, "work", looseWork, other))).toMatchObject({ ok: false, errors: { plantId: expect.any(Array) } });
    expect(await run((uow) => assignPlant(uow, "boh", looseWork, boiler.id))).toMatchObject({ ok: false });

    expect(await run((uow) => linkPlantDocument(uow, boiler.id, MISSING))).toMatchObject({ ok: false, errors: { documentId: expect.any(Array) } });
    await run((uow) => linkPlantDocument(uow, boiler.id, docBoiler));
    await run((uow) => linkPlantDocument(uow, boiler.id, docBoiler));
    expect((await getPlantDetail(t.db, boiler.id))!.documents.map((d) => d.title)).toEqual(["Libretto caldaia"]);

    const register = await getPlantRegister(t.db, { assetId: assetA, types: TYPES, today: TODAY, soonDays: 60 });
    const group = register.groups.find((g) => g.plant?.id === boiler.id)!;
    expect(group.type).toBe("heating");
    expect(group.plans.map((p) => p.title)).toEqual(["Controllo periodico"]);
    expect(group.warranties.map((w) => w.title)).toEqual(["Garanzia generica"]);
    expect(group.works.map((w) => w.title)).toEqual(["Lavori vari"]);
    expect(group.documents.map((d) => d.title)).toEqual(["Libretto caldaia"]);
    // Il libretto e' collegato: non compare anche nel gruppo ricavato dalle parole del titolo.
    const heuristicHeating = register.groups.find((g) => g.plant === null && g.type === "heating");
    expect(heuristicHeating?.documents ?? []).toEqual([]);
    // Cio' che non e' collegato resta nel ripiego per parola chiave.
    expect(register.groups.find((g) => g.plant === null && g.type === "lift")!.plans.map((p) => p.title)).toEqual(["Verifica ascensore"]);
    expect(register.groups.some((g) => g.works.some((w) => w.id === looseWork))).toBe(false);

    // Scollegare e ricollegare.
    okValue(await run((uow) => assignPlant(uow, "work", workId, null)));
    expect((await getPlantRegister(t.db, { assetId: assetA, types: TYPES, today: TODAY, soonDays: 60 })).groups.find((g) => g.plant?.id === boiler.id)!.works).toEqual([]);
    okValue(await run((uow) => assignPlant(uow, "work", workId, boiler.id)));
    await run((uow) => unlinkPlantDocument(uow, boiler.id, docBoiler));
    expect((await getPlantDetail(t.db, boiler.id))!.documents).toEqual([]);

    // Un impianto archiviato esce dal registro e cio' che vi era collegato torna al ripiego.
    await run((uow) => setPlantArchived(uow, boiler.id, true));
    const withoutBoiler = await getPlantRegister(t.db, { assetId: assetA, types: TYPES, today: TODAY, soonDays: 60 });
    expect(withoutBoiler.groups.some((g) => g.plant?.id === boiler.id)).toBe(false);
    expect(withoutBoiler.groups.find((g) => g.plant === null && g.type === "other")?.plans.map((p) => p.title)).toEqual(["Controllo periodico"]);
    await run((uow) => setPlantArchived(uow, boiler.id, false));
    expect(warrantyId).toBeTruthy();
    expect(planId).toBeTruthy();
  });

  it("cambiando l'immobile di un intervento l'impianto si scollega; togliendo l'impianto i collegamenti diventano nulli", async () => {
    const lift = (await listPlants(t.db, { assetId: assetB }))[0]!;
    const workId = okValue(await run((uow) => createWork(uow, { assetId: assetB, title: "Revisione", status: "planned", plantId: lift.id }))).id;
    okValue(await run((uow) => updateWork(uow, workId, { assetId: assetA, title: "Revisione", status: "planned" }, TODAY)));
    const detail = await getPlantRegister(t.db, { assetId: assetB, types: TYPES, today: TODAY, soonDays: 60 });
    expect(detail.groups.find((g) => g.plant?.id === lift.id)!.works).toEqual([]);

    const planId = okValue(await run((uow) => createInspectionPlan(uow, { assetId: assetB, title: "Piano ascensore B", intervalMonths: 6, firstDueOn: "2026-12-01", plantId: lift.id }))).id;
    await t.db.delete(plant).where(eq(plant.id, lift.id));
    const [row] = await t.db.select({ plantId: maintInspectionPlan.plantId }).from(maintInspectionPlan).where(eq(maintInspectionPlan.id, planId));
    expect(row!.plantId).toBeNull();
  });
});
