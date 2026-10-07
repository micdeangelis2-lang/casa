import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { territory } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { LocalFileStorage } from "@/platform/storage";
import { createAsset } from "@/modules/assets";
import { getAttention } from "@/modules/attention";
import { createDocument, listDocumentCategories } from "@/modules/documents";
import { evaluateDossier } from "@/modules/dossier";
import { addPremium, createPolicy } from "@/modules/insurance";
import { addInvoice, createWork } from "@/modules/maintenance";
import { createLetting, generateRentSchedule } from "@/modules/lettings";
import { createRule } from "@/modules/rules";
import { createObligation, createTaxType, recordPayment } from "@/modules/taxes";
import { importIstat } from "@/modules/territory";
import { createTestDb, type TestDb } from "./helpers/test-db";
import { makePdf } from "./helpers/sample-pdf";

const actor = { type: "owner", id: "o1" } as const;
const owner = { displayName: "Proprietario Prova", email: "prova@example.test" };
const TODAY = "2026-06-15";

describe("da controllare: dai moduli", () => {
  let t: TestDb;
  let dir: string;
  let storage: LocalFileStorage;
  let assetId: string;

  const run = <V>(work: Parameters<typeof runInUnitOfWork<V>>[2]) => runInUnitOfWork(t.db, actor, work);
  const okValue = <V>(r: { ok: boolean; value?: V }): V => {
    if (!r.ok) throw new Error(`atteso successo: ${JSON.stringify(r)}`);
    return r.value as V;
  };
  const kinds = async () => (await getAttention(t.db, TODAY)).map((f) => f.kind);

  beforeAll(async () => {
    t = await createTestDb();
    dir = await mkdtemp(join(tmpdir(), "attention-test-"));
    storage = new LocalFileStorage(dir);
    await run((uow) => importIstat(uow, [{ regionCode: "90", regionName: "Regione di prova", provinceCode: "900", provinceName: "Provincia di prova", provinceSigla: "PP", municipalityCode: "900001", municipalityName: "Comune Uno", cadastralCode: "Z101" }]));
    const municipalityId = (await t.db.select().from(territory).where(eq(territory.kind, "municipality")))[0]!.id;
    assetId = okValue(await run((uow) => createAsset(uow, owner, { kind: "dwelling", name: "Appartamento A", territoryId: municipalityId }))).id;
  }, 60_000);
  afterAll(async () => {
    await t.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("senza altri dati: l'immobile senza polizza e il backup non configurato (nei test non c'e' una chiave)", async () => {
    expect((await kinds()).sort()).toEqual(["asset_no_policy", "backup_not_configured"]);
  });

  it("raccoglie cio' che i moduli dicono: documento scaduto, tributo in ritardo e senza prova, premio, canone, fattura, dossier", async () => {
    const categoryId = (await listDocumentCategories(t.db))[0]!.id;
    okValue(await run((uow) => createDocument(uow, { title: "Certificato di prova", categoryId, validTo: "2026-05-01" }, { name: "certificato.pdf", bytes: makePdf("certificato") }, storage)));

    const typeId = okValue(await run((uow) => createTaxType(uow, { name: "Imposta locale" }))).id;
    const obligation = okValue(await run((uow) => createObligation(uow, { assetId, taxTypeId: typeId, year: 2026, dueOn: "2026-06-01", expected: "400,00" }))).id;
    await run((uow) => recordPayment(uow, obligation, { paidOn: "2026-05-20", amount: "100,00" }));

    const policy = okValue(await run((uow) => createPolicy(uow, { title: "Polizza casa", assetIds: [assetId], startsOn: "2025-07-01", endsOn: "2026-07-05" }))).id;
    await run((uow) => addPremium(uow, policy, { dueOn: "2026-06-01", amount: "240,00" }));

    const letting = okValue(await run((uow) => createLetting(uow, { assetId, type: "residential", title: "Locazione a Esempio", startsOn: "2025-01-01", endsOn: "2026-05-31" }))).id;
    await run((uow) => generateRentSchedule(uow, letting, { firstDueOn: "2026-05-01", months: "2", amount: "650,00" }));

    const work = okValue(await run((uow) => createWork(uow, { assetId, title: "Sostituzione caldaia" }))).id;
    await run((uow) => addInvoice(uow, work, { issuedOn: "2026-05-10", amount: "1.000,00" }));

    okValue(await run((uow) => createRule(uow, { title: "Regola di prova", level: "national", sourceText: "Esempio", outcomes: [{ type: "checklist", key: "voce", title: "Voce di prova", dossierCategory: "cadastre", expectedDocumentCategory: "cadastral" }] })));
    await run((uow) => evaluateDossier(uow, assetId, TODAY));

    const found = await getAttention(t.db, TODAY);
    const have = new Set(found.map((f) => f.kind));
    for (const kind of ["document_expired", "tax_overdue", "tax_proof_missing", "premium_overdue", "policy_expiring", "rent_overdue", "letting_end_passed", "work_invoice_unpaid", "dossier_missing", "rules_to_review", "backup_not_configured"]) expect(have, kind).toContain(kind);

    // Ogni risultato rimanda a una pagina dell'app e riporta solo fatti.
    expect(found.every((f) => f.href.startsWith("/"))).toBe(true);
    expect(found.find((f) => f.kind === "rent_overdue")).toMatchObject({ severity: "high", params: { count: 2 } });
    expect(found.find((f) => f.kind === "work_invoice_unpaid")!.params).toMatchObject({ title: "Sostituzione caldaia", cents: 100_000 });
    expect(found.find((f) => f.kind === "tax_overdue")!.params).toMatchObject({ title: "Imposta locale 2026", asset: "Appartamento A" });
    // Le priorita' alte vengono prima di quelle normali.
    const firstNormal = found.findIndex((f) => f.severity === "normal");
    expect(found.slice(firstNormal).every((f) => f.severity === "normal")).toBe(true);
  });
  it("immobili e polizze: senza polizza registrata, o con polizze registrate ma nessuna in corso", async () => {
    const municipalityId = (await t.db.select().from(territory).where(eq(territory.kind, "municipality")))[0]!.id;
    const bare = okValue(await run((uow) => createAsset(uow, owner, { kind: "box", name: "Box senza polizza", territoryId: municipalityId }))).id;
    const old = okValue(await run((uow) => createAsset(uow, owner, { kind: "box", name: "Box con polizza vecchia", territoryId: municipalityId }))).id;
    okValue(await run((uow) => createPolicy(uow, { title: "Polizza finita", assetIds: [old], startsOn: "2024-01-01", endsOn: "2025-01-01" })));
    const found = await getAttention(t.db, TODAY);
    expect(found.find((f) => f.kind === "asset_no_policy" && f.id.endsWith(bare))).toMatchObject({ severity: "normal", params: { asset: "Box senza polizza" } });
    expect(found.find((f) => f.kind === "asset_no_current_policy" && f.id.endsWith(old))).toMatchObject({ severity: "normal", params: { asset: "Box con polizza vecchia", count: 1 } });
    expect(found.some((f) => f.kind === "asset_no_policy" && f.id.endsWith(assetId))).toBe(false);
  });
});
