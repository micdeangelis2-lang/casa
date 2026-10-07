import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { desc, eq } from "drizzle-orm";
import { asset, auditLog, territory } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { createAsset, getAssetDetail, listAssets, parseEuroToCents, setAssetArchived, updateAsset } from "@/modules/assets";
import { createParty } from "@/modules/directory";
import { importIstat } from "@/modules/territory";
import { createTestDb, type TestDb } from "./helpers/test-db";

const actor = { type: "owner", id: "o1" } as const;
const owner = { displayName: "Proprietario Prova", email: "prova@example.test" };

describe("beni", () => {
  let t: TestDb;
  let municipalityId: string;
  let provinceId: string;
  let coOwnerId: string;

  const run = <T>(work: Parameters<typeof runInUnitOfWork<T>>[2]) => runInUnitOfWork(t.db, actor, work);
  const create = (input: unknown) => run((uow) => createAsset(uow, owner, input));
  const base = () => ({ kind: "dwelling", name: "Bene di prova", territoryId: municipalityId });
  const idOf = (r: { ok: boolean; value?: { id: string } }) => {
    if (!r.ok || !r.value) throw new Error(`atteso successo: ${JSON.stringify(r)}`);
    return r.value.id;
  };

  beforeAll(async () => {
    t = await createTestDb();
    await run((uow) =>
      importIstat(uow, [
        { regionCode: "90", regionName: "Regione di prova", provinceCode: "900", provinceName: "Provincia di prova", provinceSigla: "PP", municipalityCode: "900001", municipalityName: "Comune Uno", cadastralCode: "Z101" },
      ]),
    );
    municipalityId = (await t.db.select().from(territory).where(eq(territory.kind, "municipality")))[0]!.id;
    provinceId = (await t.db.select().from(territory).where(eq(territory.kind, "province")))[0]!.id;
    const co = await run((uow) => createParty(uow, { displayName: "Co-proprietario", roles: ["co_owner"] }));
    coOwnerId = co.ok ? co.value.id : "";
  });
  afterAll(async () => {
    await t.close();
  });

  it("converte importi in euro in centesimi", () => {
    expect(parseEuroToCents("1.234,56")).toBe(123456);
    expect(parseEuroToCents("1234.5")).toBe(123450);
    expect(parseEuroToCents("€ 99")).toBe(9900);
    expect(parseEuroToCents("abc")).toBeNull();
    expect(parseEuroToCents("1,234,56")).toBeNull();
  });

  it("il modulo e' lo stesso per qualunque bene: bastano tipo, denominazione e Comune", async () => {
    const id = idOf(await create({ kind: "other", name: "Qualcosa di particolare", territoryId: municipalityId }));
    const detail = await getAssetDetail(t.db, id);
    expect(detail).toMatchObject({ kind: "other", name: "Qualcosa di particolare", rights: [], cadastral: [], linkedTo: [], linkedFrom: [], territoryLabel: "Comune Uno (PP) · Regione di prova" });
  });

  it("registra titolarita' con quote, catasto a storico e uso", async () => {
    const id = idOf(
      await create({
        ...base(),
        name: "Appartamento in condominio",
        address: "Via Esempio 1",
        postalCode: "80062",
        useType: "primary_residence",
        inCondominium: true,
        rights: [
          { holder: { type: "self" }, rightType: "co_ownership", quotaNumerator: 1, quotaDenominator: 2 },
          { holder: { type: "party", partyId: coOwnerId }, rightType: "co_ownership", quotaNumerator: 1, quotaDenominator: 2, validFrom: "2020-05-01" },
        ],
        cadastral: [{ sheet: "5", parcel: "120", subunit: "7", cadastralCategory: "A/2", income: "1.234,56", validFrom: "2019-01-01", validTo: "2022-12-31" }, { sheet: "5", parcel: "120", subunit: "7", cadastralCategory: "A/3", income: "" }],
      }),
    );
    const d = (await getAssetDetail(t.db, id))!;
    expect(d.inCondominium).toBe(true);
    expect(d.rights.map((r) => [r.holder.displayName, r.quotaNumerator, r.quotaDenominator])).toEqual([
      ["Proprietario Prova", 1, 2],
      ["Co-proprietario", 1, 2],
    ]);
    expect(d.cadastral[0]).toMatchObject({ sheet: "5", incomeCents: 123456, validTo: "2022-12-31" });
    expect(d.cadastral[1]!.incomeCents).toBeNull();
  });

  it("accetta quote che sommano meno dell'intero e diritti di tipo diverso sullo stesso bene", async () => {
    const ok1 = await create({ ...base(), rights: [{ holder: { type: "self" }, rightType: "co_ownership", quotaNumerator: 1, quotaDenominator: 3 }] });
    const ok2 = await create({
      ...base(),
      rights: [
        { holder: { type: "self" }, rightType: "bare_ownership", quotaNumerator: 1, quotaDenominator: 1 },
        { holder: { type: "party", partyId: coOwnerId }, rightType: "usufruct", quotaNumerator: 1, quotaDenominator: 1 },
      ],
    });
    expect([ok1.ok, ok2.ok]).toEqual([true, true]);
  });

  it("rifiuta quote impossibili", async () => {
    const tooBig = await create({ ...base(), rights: [{ holder: { type: "self" }, rightType: "full", quotaNumerator: 3, quotaDenominator: 2 }] });
    expect(tooBig).toMatchObject({ ok: false, errors: { "rights.0.quotaNumerator": ["La quota non può superare l'intero"] } });

    const sum = await create({
      ...base(),
      rights: [
        { holder: { type: "self" }, rightType: "co_ownership", quotaNumerator: 2, quotaDenominator: 3 },
        { holder: { type: "party", partyId: coOwnerId }, rightType: "co_ownership", quotaNumerator: 2, quotaDenominator: 3 },
      ],
    });
    expect(sum.ok).toBe(false);
    if (!sum.ok) expect(Object.keys(sum.errors).sort()).toEqual(["rights.0.quotaNumerator", "rights.1.quotaNumerator"]);

    const zero = await create({ ...base(), rights: [{ holder: { type: "self" }, rightType: "full", quotaNumerator: 0, quotaDenominator: 1 }] });
    expect(zero.ok).toBe(false);
  });

  it("le quote si sommano in modo esatto, senza errori di arrotondamento", async () => {
    const thirds = await create({
      ...base(),
      rights: ["a", "b", "c"].map(() => ({ holder: { type: "self" }, rightType: "co_ownership", quotaNumerator: 1, quotaDenominator: 3 })),
    });
    expect(thirds.ok).toBe(true); // 1/3 + 1/3 + 1/3 = 1 esatto
    const over = await create({
      ...base(),
      rights: ["a", "b", "c", "d"].map(() => ({ holder: { type: "self" }, rightType: "co_ownership", quotaNumerator: 1, quotaDenominator: 3 })),
    });
    expect(over.ok).toBe(false);
  });

  it("rifiuta riferimenti inesistenti o di tipo sbagliato", async () => {
    const ghost = "00000000-0000-4000-8000-000000000000";
    expect(await create({ ...base(), territoryId: ghost })).toMatchObject({ ok: false, errors: { territoryId: ["Il Comune scelto non esiste"] } });
    expect(await create({ ...base(), territoryId: provinceId })).toMatchObject({ ok: false, errors: { territoryId: ["Scegli un Comune o una località"] } });
    expect(
      await create({ ...base(), rights: [{ holder: { type: "party", partyId: ghost }, rightType: "full", quotaNumerator: 1, quotaDenominator: 1 }] }),
    ).toMatchObject({ ok: false, errors: { "rights.0.holder": ["Il titolare non esiste più nella rubrica"] } });
    expect(await create({ ...base(), links: [{ mainAssetId: ghost }] })).toMatchObject({ ok: false, errors: { "links.0.mainAssetId": ["Il bene scelto non esiste"] } });
  });

  it("rifiuta righe catastali vuote, rendite malformate e date incoerenti, con errori in italiano", async () => {
    const r = await create({
      ...base(),
      cadastral: [{}, { sheet: "1", income: "tanto" }, { sheet: "1", validFrom: "2024-01-01", validTo: "2023-01-01" }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors["cadastral.0.sheet"]).toEqual(["Compila almeno un dato catastale o elimina la riga"]);
    expect(r.errors["cadastral.1.income"]).toEqual(["Rendita non valida (es. 1.234,56)"]);
    expect(r.errors["cadastral.2.validTo"]).toEqual(["La data di fine è precedente a quella di inizio"]);
  });

  it("non scrive nulla quando la validazione fallisce", async () => {
    const before = (await t.db.select().from(asset)).length;
    await create({ ...base(), name: "", rights: [{ holder: { type: "self" }, rightType: "full", quotaNumerator: 9, quotaDenominator: 2 }] });
    expect((await t.db.select().from(asset)).length).toBe(before);
  });

  it("collega una pertinenza a un bene principale senza presumere nulla, e il collegamento si vede da entrambi i lati", async () => {
    const main = idOf(await create({ ...base(), name: "Appartamento principale" }));
    const garage = idOf(
      await create({ kind: "garage", name: "Box", territoryId: municipalityId, links: [{ mainAssetId: main, declaredBasis: "Citato nell'atto di acquisto", validationStatus: "documented" }] }),
    );
    const g = (await getAssetDetail(t.db, garage))!;
    const m = (await getAssetDetail(t.db, main))!;
    expect(g.linkedTo).toMatchObject([{ asset: { id: main, name: "Appartamento principale" }, declaredBasis: "Citato nell'atto di acquisto", validationStatus: "documented" }]);
    expect(m.linkedFrom).toMatchObject([{ asset: { id: garage, name: "Box" } }]);

    // Non si puo' ricollegare in senso inverso, ne' a se stessi, ne' ripetere lo stesso collegamento.
    const reverse = await run((uow) => updateAsset(uow, owner, main, { ...base(), name: "Appartamento principale", links: [{ mainAssetId: garage }] }));
    expect(reverse).toMatchObject({ ok: false, errors: { "links.0.mainAssetId": [expect.stringContaining("reciproco")] } });
    const self = await run((uow) => updateAsset(uow, owner, main, { ...base(), name: "Appartamento principale", links: [{ mainAssetId: main }] }));
    expect(self).toMatchObject({ ok: false, errors: { "links.0.mainAssetId": ["Un bene non può essere collegato a se stesso"] } });
    const dup = await create({ ...base(), links: [{ mainAssetId: main }, { mainAssetId: main }] });
    expect(dup.ok).toBe(false);
  });

  it("la modifica sostituisce le liste e l'audit riporta solo i NOMI dei campi cambiati", async () => {
    const id = idOf(
      await create({
        ...base(),
        name: "Da modificare",
        address: "Via Segreta 99",
        rights: [{ holder: { type: "self" }, rightType: "full", quotaNumerator: 1, quotaDenominator: 1 }],
        cadastral: [{ sheet: "1" }],
      }),
    );
    const result = await run((uow) =>
      updateAsset(uow, owner, id, {
        ...base(),
        name: "Da modificare",
        address: "Via Nuova 1",
        useType: "let",
        rights: [{ holder: { type: "self" }, rightType: "full", quotaNumerator: 1, quotaDenominator: 1 }],
        cadastral: [{ sheet: "1" }, { sheet: "2" }],
      }),
    );
    expect(result.ok).toBe(true);
    const [last] = await t.db.select().from(auditLog).orderBy(desc(auditLog.seq)).limit(1);
    expect(last).toMatchObject({ action: "asset.update", entityId: id });
    expect(last!.diff).toEqual({ changed: ["address", "useType"], rightsChanged: false, cadastralChanged: true, linksChanged: false, attributesChanged: false });
    expect(JSON.stringify(last!.diff)).not.toContain("Via ");
    expect((await getAssetDetail(t.db, id))!.cadastral.map((c) => c.sheet)).toEqual(["1", "2"]);
  });

  it("archivia e ripristina, e la lista filtra per tipo, testo e stato", async () => {
    const id = idOf(await create({ kind: "cellar", name: "Cantina da archiviare", territoryId: municipalityId, address: "Vicolo Prova" }));
    expect((await listAssets(t.db, { kind: "cellar" })).map((a) => a.name)).toEqual(["Cantina da archiviare"]);
    expect((await listAssets(t.db, { query: "vicolo" })).map((a) => a.name)).toEqual(["Cantina da archiviare"]);
    await run((uow) => setAssetArchived(uow, id, true));
    expect(await listAssets(t.db, { kind: "cellar" })).toEqual([]);
    expect((await listAssets(t.db, { kind: "cellar", includeArchived: true }))[0]).toMatchObject({ archived: true, territoryLabel: "Comune Uno (PP) · Regione di prova" });
    await run((uow) => setAssetArchived(uow, id, false));
    expect(await listAssets(t.db, { kind: "cellar" })).toHaveLength(1);
  });

  it("un bene inesistente non si puo' modificare ne' archiviare", async () => {
    const ghost = "00000000-0000-4000-8000-000000000000";
    expect(await run((uow) => updateAsset(uow, owner, ghost, base()))).toEqual({ ok: false, errors: { _: ["Bene non trovato"] } });
    expect(await run((uow) => setAssetArchived(uow, ghost, true))).toEqual({ ok: false, errors: { _: ["Bene non trovato"] } });
  });

  it("registra caratteristiche tecniche tipizzate e rifiuta nomi o valori sbagliati", async () => {
    const id = idOf(
      await create({
        ...base(),
        attributes: [
          { key: "anno_costruzione", type: "number", value: "1985" },
          { key: "ascensore", type: "boolean", value: "true" },
          { key: "classe_energetica", type: "text", value: "D" },
        ],
      }),
    );
    expect((await getAssetDetail(t.db, id))!.attributes).toEqual({ anno_costruzione: 1985, ascensore: true, classe_energetica: "D" });

    const bad = await create({ ...base(), attributes: [{ key: "Anno Costruzione", type: "number", value: "abc" }, { key: "ok", type: "boolean", value: "forse" }] });
    expect(bad).toMatchObject({ ok: false, errors: { "attributes.0.key": expect.any(Array), "attributes.1.value": ["Scegli sì o no"] } });
    const dup = await create({ ...base(), attributes: [{ key: "a", type: "text", value: "x" }, { key: "a", type: "text", value: "y" }] });
    expect(dup).toMatchObject({ ok: false, errors: { "attributes.1.key": ["Caratteristica ripetuta"] } });

    await run((uow) => updateAsset(uow, owner, id, { ...base(), attributes: [{ key: "anno_costruzione", type: "number", value: "1990" }] }));
    const [last] = await t.db.select().from(auditLog).orderBy(desc(auditLog.seq)).limit(1);
    expect(last!.diff).toMatchObject({ attributesChanged: true });
    expect(JSON.stringify(last!.diff)).not.toContain("1990");
  });
});
