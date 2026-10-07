import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { territory } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { createAsset } from "@/modules/assets";
import { dossierCsv, getDossier } from "@/modules/economy";
import { overlapsYear, proofState, sortGaps, type DossierGap } from "@/modules/economy/domain/dossier";
import { addPremium, createPolicy } from "@/modules/insurance";
import { addInvoice, createWork } from "@/modules/maintenance";
import { createObligation, createReturn, createTaxType, recordPayment as payTax } from "@/modules/taxes";
import { createLetting, generateRentSchedule } from "@/modules/lettings";
import { importIstat } from "@/modules/territory";
import { conclusiveClaims } from "./helpers/neutral";
import { createTestDb, type TestDb } from "./helpers/test-db";

const actor = { type: "owner", id: "o1" } as const;
const owner = { displayName: "Proprietario Prova", email: "prova@example.test" };

describe("dossier per il commercialista: dominio", () => {
  it("la prova di un movimento e' collegata, mancante o non prevista", () => {
    expect(proofState({ documentId: "d" })).toBe("present");
    expect(proofState({ documentId: null })).toBe("missing");
    expect(proofState({})).toBe("notTracked");
  });

  it("un periodo tocca l'anno anche con estremi mancanti", () => {
    expect(overlapsYear(null, null, 2025)).toBe(true);
    expect(overlapsYear("2025-12-31", null, 2025)).toBe(true);
    expect(overlapsYear("2026-01-01", null, 2025)).toBe(false);
    expect(overlapsYear(null, "2024-12-31", 2025)).toBe(false);
  });

  it("le segnalazioni hanno un ordine stabile", () => {
    const g = (kind: DossierGap["kind"], subject: string): DossierGap => ({ kind, subject, assetName: null, date: null, amountCents: null, href: "/" });
    expect(sortGaps([g("return_not_filed", "a"), g("asset_no_rights", "z"), g("asset_no_rights", "b")]).map((x) => x.subject)).toEqual(["b", "z", "a"]);
  });
});

describe("dossier per il commercialista: dai moduli", () => {
  let t: TestDb;
  const run = <V>(work: Parameters<typeof runInUnitOfWork<V>>[2]) => runInUnitOfWork(t.db, actor, work);
  const okValue = <V>(r: { ok: boolean; value?: V }): V => {
    if (!r.ok) throw new Error(`atteso successo: ${JSON.stringify(r)}`);
    return r.value as V;
  };

  beforeAll(async () => {
    t = await createTestDb();
    await run((uow) => importIstat(uow, [{ regionCode: "90", regionName: "Regione di prova", provinceCode: "900", provinceName: "Provincia di prova", provinceSigla: "PP", municipalityCode: "900001", municipalityName: "Comune Uno", cadastralCode: "Z101" }]));
    const municipalityId = (await t.db.select().from(territory).where(eq(territory.kind, "municipality")))[0]!.id;
    const assetId = okValue(await run((uow) => createAsset(uow, owner, { kind: "dwelling", name: "Appartamento Dossier", territoryId: municipalityId }))).id;

    const typeId = okValue(await run((uow) => createTaxType(uow, { name: "Imposta locale" }))).id;
    const obligation = okValue(await run((uow) => createObligation(uow, { assetId, taxTypeId: typeId, year: 2024, label: "Saldo", askAdviser: true, note: "Verificare la quota" }))).id;
    await run((uow) => payTax(uow, obligation, { paidOn: "2024-06-16", amount: "300,00" }));
    await run((uow) => createReturn(uow, { title: "Dichiarazione di prova", assetId, year: 2024, dueOn: "2024-09-30" }));

    const work = okValue(await run((uow) => createWork(uow, { assetId, title: "Rifacimento bagno" }))).id;
    await run((uow) => addInvoice(uow, work, { issuedOn: "2024-05-01", amount: "1.000,00", paidOn: "2024-05-05" }));

    const policy = okValue(await run((uow) => createPolicy(uow, { title: "Polizza casa", assetIds: [assetId] }))).id;
    await run((uow) => addPremium(uow, policy, { dueOn: "2024-03-01", amount: "240,00" }));

    const letting = okValue(await run((uow) => createLetting(uow, { assetId, type: "residential", title: "Locazione Dossier" }))).id;
    await run((uow) => generateRentSchedule(uow, letting, { firstDueOn: "2024-06-01", months: "1", amount: "650,00" }));
  }, 90_000);
  afterAll(async () => {
    await t.close();
  });

  it("riporta i movimenti con la prova e segnala cosa non risulta registrato", async () => {
    const d = await getDossier(t.db, 2024, "2025-02-01");
    expect(d.movements.map((m) => [m.area, m.amountCents, m.proof])).toEqual([
      ["maintenance", 100_000, "missing"],
      ["taxes", 30_000, "missing"],
    ]);
    const kinds = d.gaps.map((g) => g.kind);
    expect(kinds).toEqual(expect.arrayContaining(["asset_no_rights", "asset_no_cadastral", "payment_no_proof", "rent_not_collected", "premium_not_paid", "letting_no_registration", "letting_no_contract_document", "tax_no_expected", "return_not_filed"]));
    expect(kinds.filter((k) => k === "payment_no_proof")).toHaveLength(2);
    expect(d.gaps.find((g) => g.kind === "rent_not_collected")).toMatchObject({ amountCents: 65_000, date: "2024-06-01" });
    expect(d.tax.toAsk.obligations).toHaveLength(1);
    expect(d.areaTotals.find((a) => a.area === "taxes")).toMatchObject({ totalCents: 30_000, count: 1, withoutProof: 1 });
  });

  it("un anno senza dati non ha movimenti ne' segnalazioni sui pagamenti e il CSV e' neutro", async () => {
    const d = await getDossier(t.db, 1999, "2025-02-01");
    expect(d.movements).toEqual([]);
    expect(d.gaps.map((g) => g.kind).sort()).toEqual(["asset_no_cadastral", "asset_no_rights", "letting_no_contract_document", "letting_no_registration"]); // la locazione senza date non ha un periodo: tocca ogni anno
    const csv = dossierCsv(await getDossier(t.db, 2024, "2025-02-01"));
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("Dossier annuale per il consulente 2024");
    expect(csv).toContain("Rifacimento bagno");
    expect(csv).toContain("Verificare la quota");
    expect(conclusiveClaims(csv)).toEqual([]);
  });
});
