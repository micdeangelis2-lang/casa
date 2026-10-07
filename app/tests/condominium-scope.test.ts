import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { auditLog, condoBudget, territory } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { createAsset } from "@/modules/assets";
import { createBudget, createCondominium, createFiscalYear, createTable, generateInstallments, getCondominiumDetail, getOwnerReview, saveOtherShares, saveShares } from "@/modules/condominium";
import { allocateByShares, allocateOwnerParts, MILLI_SCALE } from "@/modules/condominium/domain/millesimi";
import { importIstat } from "@/modules/territory";
import { createTestDb, type TestDb } from "./helpers/test-db";

const actor = { type: "owner", id: "o1" } as const;
const owner = { displayName: "Proprietario Prova", email: "prova@example.test" };
const M = MILLI_SCALE;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("preventivi del palazzo: ripartizione (logica pura)", () => {
  it("con ambito «solo proprietario» il comportamento di sempre resta invariato", () => {
    const weights = [500 * M, 300 * M, 200 * M];
    expect(allocateOwnerParts(1_000_001, weights, "owner_only", 0)).toEqual(allocateByShares(1_000_001, weights));
    expect(allocateOwnerParts(1_000_001, weights, "owner_only", 999 * M)).toEqual(allocateByShares(1_000_001, weights));
    expect(sum(allocateOwnerParts(1_000_001, [800 * M], "owner_only", 0))).toBe(1_000_001);
  });

  it("con ambito «palazzo» divide per il totale del palazzo, almeno 1000, e non attribuisce l'intero", () => {
    // Il proprietario ha 800 millesimi, nessun altro registrato: il palazzo e' comunque 1000.
    const parts = allocateOwnerParts(100_000, [500 * M, 300 * M], "building", 0);
    expect(parts).toEqual([50_000, 30_000]);
    // Con altri registrati la somma supera 1000: il totale del palazzo e' la somma.
    const withOthers = allocateOwnerParts(110_000, [500 * M, 300 * M], "building", 300 * M);
    expect(sum(withOthers)).toBe(80_000);
    // Tutto il palazzo e' del proprietario: riceve l'intero totale.
    expect(allocateOwnerParts(100_000, [600 * M, 400 * M], "building", 0)).toEqual([60_000, 40_000]);
  });

  it("i centesimi non si inventano: la parte del proprietario e' sempre inferiore o uguale al totale, e le parti sommano", () => {
    for (const total of [1, 7, 999, 100_001, 123_457_89]) {
      const parts = allocateOwnerParts(total, [333_3333, 333_3333, 100 * M], "building", 0);
      expect(sum(parts)).toBeLessThanOrEqual(total);
      const rest = allocateByShares(total, [333_3333, 333_3333, 100 * M, 1000 * M - (333_3333 * 2 + 100 * M)]);
      expect(sum(parts) + rest[3]!).toBe(total);
    }
  });
});

describe("preventivi del palazzo: casi d'uso", () => {
  let t: TestDb;
  let condoId: string;
  let tableId: string;
  let yearId: string;
  let assets: string[];
  const run = <T>(work: Parameters<typeof runInUnitOfWork<T>>[2]) => runInUnitOfWork(t.db, actor, work);
  const okValue = <V>(r: { ok: boolean; value?: V }): V => {
    if (!r.ok) throw new Error(`atteso successo: ${JSON.stringify(r)}`);
    return r.value as V;
  };
  const detail = async () => (await getCondominiumDetail(t.db, condoId))!;

  beforeAll(async () => {
    t = await createTestDb();
    await run((uow) => importIstat(uow, [{ regionCode: "90", regionName: "Regione di prova", provinceCode: "900", provinceName: "Provincia di prova", provinceSigla: "PP", municipalityCode: "900001", municipalityName: "Comune Uno", cadastralCode: "Z101" }]));
    const municipalityId = (await t.db.select().from(territory).where(eq(territory.kind, "municipality")))[0]!.id;
    assets = [];
    for (const name of ["Unità A", "Unità B"]) assets.push(okValue(await run((uow) => createAsset(uow, owner, { kind: "dwelling", name, territoryId: municipalityId, inCondominium: true }))).id);
    condoId = okValue(await run((uow) => createCondominium(uow, { name: "Condominio scope" }))).id;
    for (const a of assets) await t.db.execute(sql`insert into condo_membership (condominium_id, asset_id) values (${condoId}, ${a})`);
    await run((uow) => createTable(uow, condoId, { name: "Generale" }));
    tableId = (await detail()).tables[0]!.id;
    okValue(await run((uow) => saveShares(uow, tableId, [{ assetId: assets[0], value: "500" }, { assetId: assets[1], value: "300" }])));
    okValue(await run((uow) => createFiscalYear(uow, condoId, { label: "2026", startsOn: "2026-01-01", endsOn: "2026-12-31" })));
    yearId = (await detail()).years[0]!.id;
  }, 60_000);
  afterAll(async () => {
    await t.close();
  });

  it("i millesimi degli altri si salvano con nome, si rifiutano se non validi e non compaiono nell'audit", async () => {
    expect(await run((uow) => saveOtherShares(uow, "00000000-0000-4000-8000-000000000000", []))).toMatchObject({ ok: false });
    expect(await run((uow) => saveOtherShares(uow, tableId, [{ label: "Altri", value: "abc" }]))).toMatchObject({ ok: false, errors: { "others.0": expect.any(Array) } });
    expect(await run((uow) => saveOtherShares(uow, tableId, [{ label: "", value: "100" }]))).toMatchObject({ ok: false, errors: { "others.0": expect.any(Array) } });
    expect(await run((uow) => saveOtherShares(uow, tableId, [{ label: "Altri", value: "-5" }]))).toMatchObject({ ok: false });

    expect(await run((uow) => saveOtherShares(uow, tableId, [{ label: "Famiglia SEGRETA", value: "150,5" }, { label: "", value: "" }, { label: "Negozi", value: "49,5" }]))).toMatchObject({ ok: true, value: { total: 200 * M } });
    const table = (await detail()).tables[0]!;
    expect(table.others.map((o) => [o.label, o.milli])).toEqual([["Famiglia SEGRETA", 1_505_000], ["Negozi", 495_000]]);
    expect(table.othersTotal).toBe(200 * M);
    const audits = await t.db.select().from(auditLog).where(eq(auditLog.entityId, condoId));
    expect(audits.some((a) => a.action === "condominium.others.save")).toBe(true);
    expect(JSON.stringify(audits.map((a) => a.diff))).not.toContain("SEGRETA");
    await run((uow) => saveOtherShares(uow, tableId, []));
    expect((await detail()).tables[0]!.others).toEqual([]);
  });

  it("senza ambito il preventivo resta «solo proprietario»; con ambito «palazzo» il proprietario riceve solo la sua parte", async () => {
    await run((uow) => createBudget(uow, yearId, { kind: "ordinary", title: "Predefinito", total: "1.000,00", millesimalTableId: tableId }));
    await run((uow) => createBudget(uow, yearId, { kind: "ordinary", title: "Del palazzo", total: "1.000,00", millesimalTableId: tableId, scope: "building" }));
    expect(await run((uow) => createBudget(uow, yearId, { kind: "ordinary", title: "x", total: "1", scope: "altro" }))).toMatchObject({ ok: false, errors: { scope: expect.any(Array) } });
    const budgets = (await detail()).years[0]!.budgets;
    expect(budgets.map((b) => [b.title, b.scope])).toEqual([["Predefinito", "owner_only"], ["Del palazzo", "building"]]);

    const [byDefault, building] = budgets;
    expect(await run((uow) => generateInstallments(uow, byDefault!.id, { count: 2, firstDueOn: "2026-03-01", everyMonths: 3 }))).toMatchObject({ ok: true, value: { shareTotalCents: 100_000 } });
    // Proprietario 800 millesimi, nessun altro registrato: il palazzo e' 1000, quindi 800,00 su 1.000,00.
    expect(await run((uow) => generateInstallments(uow, building!.id, { count: 2, firstDueOn: "2026-03-01", everyMonths: 3 }))).toMatchObject({ ok: true, value: { shareTotalCents: 80_000 } });
    const rows = (await detail()).years[0]!.budgets.find((b) => b.id === building!.id)!.installments;
    expect(sum(rows.map((r) => r.amountCents))).toBe(80_000);
    expect(rows.filter((r) => r.assetId === assets[0]).reduce((n, r) => n + r.amountCents, 0)).toBe(50_000);

    // Con gli altri condomini registrati il totale del palazzo e' la somma (qui 1100): 800/1100 di 1.000,00.
    okValue(await run((uow) => saveOtherShares(uow, tableId, [{ label: "Altri", value: "300" }])));
    expect(await run((uow) => generateInstallments(uow, building!.id, { count: 2, firstDueOn: "2026-03-01", everyMonths: 3 }))).toMatchObject({ ok: true, value: { shareTotalCents: 72_727 } });
    // Il preventivo predefinito non cambia.
    expect(await run((uow) => generateInstallments(uow, byDefault!.id, { count: 2, firstDueOn: "2026-03-01", everyMonths: 3 }))).toMatchObject({ ok: true, value: { shareTotalCents: 100_000 } });
    const [row] = await t.db.select({ scope: condoBudget.scope }).from(condoBudget).where(eq(condoBudget.id, byDefault!.id));
    expect(row!.scope).toBe("owner_only");
  });

  it("il confronto con il consuntivo usa lo stesso ambito", async () => {
    await run((uow) => createBudget(uow, yearId, { kind: "final", title: "Consuntivo del palazzo", total: "2.000,00", millesimalTableId: tableId, scope: "building" }));
    const review = await getOwnerReview(t.db, "2026-06-15");
    const year = review.condominiums.find((c) => c.condominiumId === condoId)!.years[0]!;
    // 2.000,00 del palazzo, con millesimi 500/300 su 1100 (altri: 300): 909,09 e 545,46.
    expect(year.comparisons.map((c) => c.quotaCents).sort((a, b) => a - b)).toEqual([54_546, 90_909]);
  });
});
