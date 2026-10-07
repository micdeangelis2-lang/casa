import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { territory } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { createAsset } from "@/modules/assets";
import { addMember, createBudget, createCondominium, createFiscalYear, createTable, generateInstallments, getCondominiumDetail, recordPayment as payInstallment, saveShares } from "@/modules/condominium";
import { economyCsv, economyYears, getEconomy } from "@/modules/economy";
import { buildEconomy, type LedgerEntry } from "@/modules/economy/domain/economy";
import { addPremium, createPolicy, setPremiumPaid } from "@/modules/insurance";
import { addInvoice, createWork } from "@/modules/maintenance";
import { createObligation, createTaxType, recordPayment as payTax } from "@/modules/taxes";
import { createLetting, generateRentSchedule, getLettingDetail, recordRentPayment } from "@/modules/lettings";
import { importIstat } from "@/modules/territory";
import { createTestDb, type TestDb } from "./helpers/test-db";

const actor = { type: "owner", id: "o1" } as const;
const owner = { displayName: "Proprietario Prova", email: "prova@example.test" };

describe("quadro economico: dominio", () => {
  const assets = [
    { id: "a", name: "Appartamento" },
    { id: "b", name: "Box" },
  ];
  const entry = (over: Partial<LedgerEntry>): LedgerEntry => ({ area: "taxes", id: "1", refId: "r", date: "2026-01-01", amountCents: 100, assetId: "a", label: "x", ...over });

  it("somma per immobile e per area; gli incassi non sono costi; la differenza puo' essere negativa", () => {
    const { rows, totals } = buildEconomy([entry({ amountCents: 500 }), entry({ area: "maintenance", amountCents: 300 }), entry({ area: "lettings", amountCents: 400 }), entry({ assetId: "b", area: "insurance", amountCents: 50 })], assets);
    expect(rows.map((r) => [r.assetName, r.costsTotal, r.income, r.balance])).toEqual([["Appartamento", 800, 400, -400], ["Box", 50, 0, -50]]);
    expect(totals).toMatchObject({ costsTotal: 850, income: 400, balance: -450, costs: { taxes: 500, maintenance: 300, insurance: 50, condominium: 0 } });
  });

  it("un movimento senza bene (o di un bene sconosciuto) va nella riga «non ripartito», in fondo", () => {
    const { rows } = buildEconomy([entry({ assetId: null, area: "insurance", amountCents: 70 }), entry({ assetId: "sconosciuto", amountCents: 30 })], assets);
    expect(rows.map((r) => r.assetName)).toEqual(["Appartamento", "Box", ""]);
    expect(rows.at(-1)).toMatchObject({ assetId: null, costsTotal: 100 });
  });

  it("senza movimenti ogni bene compare a zero e non c'e' la riga «non ripartito»", () => {
    const { rows, totals } = buildEconomy([], assets);
    expect(rows).toHaveLength(2);
    expect(totals).toMatchObject({ costsTotal: 0, income: 0, balance: 0 });
  });
});

describe("quadro economico: dai moduli", () => {
  let t: TestDb;
  let assetA: string;
  let assetB: string;

  const run = <V>(work: Parameters<typeof runInUnitOfWork<V>>[2]) => runInUnitOfWork(t.db, actor, work);
  const okValue = <V>(r: { ok: boolean; value?: V }): V => {
    if (!r.ok) throw new Error(`atteso successo: ${JSON.stringify(r)}`);
    return r.value as V;
  };

  beforeAll(async () => {
    t = await createTestDb();
    await run((uow) => importIstat(uow, [{ regionCode: "90", regionName: "Regione di prova", provinceCode: "900", provinceName: "Provincia di prova", provinceSigla: "PP", municipalityCode: "900001", municipalityName: "Comune Uno", cadastralCode: "Z101" }]));
    const municipalityId = (await t.db.select().from(territory).where(eq(territory.kind, "municipality")))[0]!.id;
    assetA = okValue(await run((uow) => createAsset(uow, owner, { kind: "dwelling", name: "Appartamento A", territoryId: municipalityId, inCondominium: true }))).id;
    assetB = okValue(await run((uow) => createAsset(uow, owner, { kind: "garage", name: "Box B", territoryId: municipalityId }))).id;

    // Tributi: un pagamento nel 2026 e uno nel 2025 (anno diverso).
    const typeId = okValue(await run((uow) => createTaxType(uow, { name: "Imposta locale" }))).id;
    const obligation = okValue(await run((uow) => createObligation(uow, { assetId: assetA, taxTypeId: typeId, year: 2026, label: "Acconto", expected: "400,00" }))).id;
    await run((uow) => payTax(uow, obligation, { paidOn: "2026-03-10", amount: "200,00" }));
    await run((uow) => payTax(uow, obligation, { paidOn: "2025-12-30", amount: "55,00" }));

    // Assicurazioni: una polizza su un immobile e una su due (premio non ripartito); uno non pagato non conta.
    const single = okValue(await run((uow) => createPolicy(uow, { title: "Polizza casa", assetIds: [assetA] }))).id;
    await run((uow) => addPremium(uow, single, { dueOn: "2026-02-01", amount: "240,00", paidOn: "2026-02-01" }));
    await run((uow) => addPremium(uow, single, { dueOn: "2026-09-01", amount: "999,00" }));
    const both = okValue(await run((uow) => createPolicy(uow, { title: "Polizza globale", assetIds: [assetA, assetB] }))).id;
    await run((uow) => addPremium(uow, both, { dueOn: "2026-02-02", amount: "100,00" }));
    const premiumId = (await t.db.query.insPremium.findFirst({ where: (p, { and, eq: same }) => and(same(p.policyId, both)) }))!.id;
    await run((uow) => setPremiumPaid(uow, premiumId, { paidOn: "2026-02-02" }));

    // Manutenzioni: una fattura pagata e una no.
    const work = okValue(await run((uow) => createWork(uow, { assetId: assetB, title: "Rifacimento porta" }))).id;
    await run((uow) => addInvoice(uow, work, { issuedOn: "2026-05-01", amount: "1.000,00", paidOn: "2026-05-05" }));
    await run((uow) => addInvoice(uow, work, { issuedOn: "2026-06-01", amount: "500,00" }));

    // Condominio: una rata pagata in parte dall'immobile A.
    const condo = okValue(await run((uow) => createCondominium(uow, { name: "Condominio Prova" }))).id;
    await run((uow) => addMember(uow, condo, { assetId: assetA }));
    await run((uow) => createTable(uow, condo, { name: "Generale" }));
    const detail = (await getCondominiumDetail(t.db, condo))!;
    await run((uow) => saveShares(uow, detail.tables[0]!.id, [{ assetId: assetA, value: "1000" }]));
    await run((uow) => createFiscalYear(uow, condo, { label: "2026", startsOn: "2026-01-01", endsOn: "2026-12-31" }));
    const year = (await getCondominiumDetail(t.db, condo))!.years[0]!;
    await run((uow) => createBudget(uow, year.id, { kind: "ordinary", title: "Preventivo 2026", total: "1.200,00", millesimalTableId: detail.tables[0]!.id }));
    const budget = (await getCondominiumDetail(t.db, condo))!.years[0]!.budgets[0]!;
    await run((uow) => generateInstallments(uow, budget.id, { count: 1, firstDueOn: "2026-04-01", everyMonths: 1 }));
    const installment = (await getCondominiumDetail(t.db, condo))!.years[0]!.budgets[0]!.installments[0]!;
    await run((uow) => payInstallment(uow, installment.id, { paid: "300,00", paidOn: "2026-04-02" }, "2026-04-02"));

    // Locazioni: due canoni, uno incassato.
    const letting = okValue(await run((uow) => createLetting(uow, { assetId: assetA, type: "residential", title: "Locazione a Esempio" }))).id;
    await run((uow) => generateRentSchedule(uow, letting, { firstDueOn: "2026-06-01", months: "2", amount: "650,00" }));
    const rent = (await getLettingDetail(t.db, letting, "2026-06-15"))!.rents[0]!;
    await run((uow) => recordRentPayment(uow, rent.id, { paid: "650,00", paidOn: "2026-06-05" }, "2026-06-15"));
  }, 90_000);
  afterAll(async () => {
    await t.close();
  });

  it("somma per immobile e per area solo i pagamenti con data nell'anno, senza inventare ripartizioni", async () => {
    const view = await getEconomy(t.db, 2026);
    const a = view.rows.find((r) => r.assetId === assetA)!;
    const b = view.rows.find((r) => r.assetId === assetB)!;
    expect(a).toMatchObject({ assetName: "Appartamento A", costs: { taxes: 20_000, insurance: 24_000, maintenance: 0, condominium: 30_000 }, costsTotal: 74_000, income: 65_000, balance: -9_000 });
    expect(b).toMatchObject({ assetName: "Box B", costs: { taxes: 0, insurance: 0, maintenance: 100_000, condominium: 0 }, costsTotal: 100_000, income: 0, balance: -100_000 });
    const unassigned = view.rows.at(-1)!;
    expect(unassigned).toMatchObject({ assetId: null, costs: { insurance: 10_000 } });
    expect(view.totals).toMatchObject({ costsTotal: 74_000 + 100_000 + 10_000, income: 65_000 });
  });

  it("i movimenti sono elencati per data con la loro origine; il pagamento del 2025 non conta nel 2026", async () => {
    const view = await getEconomy(t.db, 2026);
    expect(view.entries.map((e) => [e.date, e.area, e.amountCents])).toEqual([
      ["2026-02-01", "insurance", 24_000],
      ["2026-02-02", "insurance", 10_000],
      ["2026-03-10", "taxes", 20_000],
      ["2026-04-02", "condominium", 30_000],
      ["2026-05-05", "maintenance", 100_000],
      ["2026-06-05", "lettings", 65_000],
    ]);
    expect(view.entries.find((e) => e.area === "taxes")).toMatchObject({ label: "Imposta locale 2026 – Acconto", assetName: "Appartamento A" });
    expect(view.entries.find((e) => e.area === "maintenance")!.label).toBe("Rifacimento porta");
    expect(view.entries.find((e) => e.area === "condominium")!.label).toBe("Rata 1: Preventivo 2026");
    const previous = await getEconomy(t.db, 2025);
    expect(previous.entries.map((e) => [e.date, e.amountCents])).toEqual([["2025-12-30", 5_500]]);
    expect(await economyYears(t.db)).toEqual([2026, 2025]);
  });

  it("con un immobile scelto restano solo i suoi movimenti: quelli non ripartiti non sono suoi", async () => {
    const view = await getEconomy(t.db, 2026, assetB);
    expect(view.rows).toHaveLength(1);
    expect(view.entries.map((e) => e.area)).toEqual(["maintenance"]);
    expect(view.totals).toMatchObject({ costsTotal: 100_000, income: 0 });
  });

  it("il CSV riporta la tabella e i movimenti, con l'avvertenza che non e' un bilancio", async () => {
    const csv = economyCsv(await getEconomy(t.db, 2026), "Non ripartito");
    const lines = csv.slice(1).split("\r\n");
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(lines[0]).toBe("Quadro economico 2026");
    expect(lines[1]).toContain("non e' un bilancio");
    expect(lines).toContain("Immobile;Tributi (€);Assicurazioni (€);Manutenzioni (€);Condominio (€);Pagamenti totali (€);Incassi da locazioni (€);Differenza (€)");
    expect(lines.find((l) => l.startsWith("Appartamento A;"))).toBe("Appartamento A;200;240;0;300;740;650;-90");
    expect(lines.find((l) => l.startsWith("Non ripartito;"))).toContain("100");
    expect(lines.find((l) => l.startsWith("Totale;"))).toBe("Totale;200;340;1000;300;1840;650;-1190");
    expect(lines).toContain("Data;Area;Descrizione;Immobile;Importo (€)");
  });
});
