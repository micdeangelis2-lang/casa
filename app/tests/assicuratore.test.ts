import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { territory } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { LocalFileStorage } from "@/platform/storage";
import { createAsset } from "@/modules/assets";
import { createDocument, listDocumentCategories } from "@/modules/documents";
import { importIstat } from "@/modules/territory";
import { createWork } from "@/modules/maintenance";
import { addClaimEntry, addCoverage, createClaim, createPolicy, getClaimSheet, policiesByAsset, setPolicyArchived } from "@/modules/insurance";
import { groupPoliciesByAsset, isPolicyCurrent, sheetChecks, type OverviewPolicy } from "@/modules/insurance/domain/assicuratore-overview";
import { conclusiveClaims } from "./helpers/neutral";
import messages from "../messages/it.json";
import { createTestDb, type TestDb } from "./helpers/test-db";

const actor = { type: "owner", id: "o1" } as const;
const owner = { displayName: "Proprietario Prova", email: "prova@example.test" };
const TODAY = "2026-06-15";

const policy = (over: Partial<OverviewPolicy>): OverviewPolicy => ({ id: "p", title: "P", insurerName: null, policyNumber: null, startsOn: null, endsOn: null, state: "active", premiumCents: null, assetIds: [], openClaims: 0, coverages: [], ...over });

describe("assicuratore: logica pura", () => {
  it("una polizza e' in corso se attiva, in scadenza o senza data di fine", () => {
    expect(["active", "expiring", "undated"].every((s) => isPolicyCurrent(s as "active"))).toBe(true);
    expect(isPolicyCurrent("expired")).toBe(false);
    expect(isPolicyCurrent("upcoming")).toBe(false);
  });

  it("raggruppa le polizze per bene e distingue nessuna / nessuna in corso / in corso, senza interpretare", () => {
    const rows = groupPoliciesByAsset(
      [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }],
      [policy({ id: "1", title: "Scaduta", state: "expired", endsOn: "2026-01-01", assetIds: ["b"] }), policy({ id: "2", title: "Globale", assetIds: ["a", "c"], endsOn: "2027-01-01" }), policy({ id: "3", title: "Altra", state: "expired", endsOn: "2025-01-01", assetIds: ["c"] })],
    );
    expect(rows.map((r) => [r.assetId, r.status])).toEqual([["a", "current"], ["b", "notCurrent"], ["c", "current"]]);
    expect(rows[2]!.policies.map((p) => p.id)).toEqual(["3", "2"]);
    expect(groupPoliciesByAsset([{ id: "x", name: "X" }], [])[0]!.status).toBe("none");
  });

  it("l'elenco di controllo dice solo cosa e' registrato", () => {
    const base = { reportedOn: null, claimNumber: null, description: " ", claimedCents: null, adjusterName: null, policyNumber: null, coverageCount: 0, entryCount: 0, documentCount: 0, photoCount: 0, workCount: 0 };
    expect(sheetChecks(base).every((c) => !c.present)).toBe(true);
    const full = sheetChecks({ ...base, reportedOn: "2026-06-01", description: "Acqua", coverageCount: 2, photoCount: 3 });
    expect(full.find((c) => c.key === "reportedOn")!.present).toBe(true);
    expect(full.find((c) => c.key === "photos")).toMatchObject({ present: true, count: 3 });
    expect(full.find((c) => c.key === "claimed")!.present).toBe(false);
  });

  it("i messaggi dell'area non suonano come verdetti", () => {
    const texts: string[] = [];
    const walk = (n: unknown) => (typeof n === "string" ? texts.push(n) : n && typeof n === "object" ? Object.values(n).forEach(walk) : undefined);
    walk(messages.assicuratore);
    expect(texts.flatMap(conclusiveClaims)).toEqual([]);
  });
});

describe("assicuratore: polizze per bene e scheda sinistro", () => {
  let t: TestDb;
  let dir: string;
  let assetA: string;
  let assetB: string;
  let assetC: string;
  let policyId: string;
  let claimId: string;
  const run = <T>(work: Parameters<typeof runInUnitOfWork<T>>[2]) => runInUnitOfWork(t.db, actor, work);
  const ok = <V>(r: { ok: boolean; value?: V }): V => {
    if (!r.ok) throw new Error(`atteso successo: ${JSON.stringify(r)}`);
    return r.value as V;
  };

  beforeAll(async () => {
    t = await createTestDb();
    dir = await mkdtemp(join(tmpdir(), "ass-test-"));
    const storage = new LocalFileStorage(dir);
    await run((uow) => importIstat(uow, [{ regionCode: "90", regionName: "Regione di prova", provinceCode: "900", provinceName: "Provincia di prova", provinceSigla: "PP", municipalityCode: "900001", municipalityName: "Comune Uno", cadastralCode: "Z101" }]));
    const municipalityId = (await t.db.select().from(territory).where(eq(territory.kind, "municipality")))[0]!.id;
    assetA = ok(await run((uow) => createAsset(uow, owner, { kind: "dwelling", name: "Appartamento A", territoryId: municipalityId, address: "Via Prova 1", attributes: [{ key: "anno_costruzione", type: "number", value: "1975" }] }))).id;
    assetB = ok(await run((uow) => createAsset(uow, owner, { kind: "garage", name: "Box B", territoryId: municipalityId }))).id;
    assetC = ok(await run((uow) => createAsset(uow, owner, { kind: "cellar", name: "Cantina C", territoryId: municipalityId }))).id;
    policyId = ok(await run((uow) => createPolicy(uow, { title: "Polizza casa", policyNumber: "POL-1", startsOn: "2026-01-01", endsOn: "2026-12-31", premium: "400,00", assetIds: [assetA, assetB] }))).id;
    await run((uow) => createPolicy(uow, { title: "Polizza vecchia", endsOn: "2025-12-31", assetIds: [assetB] }));
    await run((uow) => createPolicy(uow, { title: "Polizza senza beni" }));
    const archived = ok(await run((uow) => createPolicy(uow, { title: "Archiviata", assetIds: [assetC] }))).id;
    await run((uow) => setPolicyArchived(uow, archived, true));
    await run((uow) => addCoverage(uow, policyId, { title: "Incendio", sumInsured: "100.000,00", deductible: "250,00" }));
    const categoryId = (await listDocumentCategories(t.db))[0]!.id;
    await run((uow) => createDocument(uow, { title: "Foto soffitto", categoryId, assetIds: [assetA] }, { name: "foto.png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])}, storage));
    await run((uow) => createWork(uow, { assetId: assetA, title: "Rifacimento tetto", status: "completed", completedOn: "2024-05-01" }));
    claimId = ok(await run((uow) => createClaim(uow, { policyId, assetId: assetA, title: "Infiltrazione", occurredOn: "2026-05-20", claimed: "1.500,00", description: "Acqua dal soffitto" }, TODAY))).id;
    await run((uow) => createClaim(uow, { policyId, assetId: assetA, title: "Vecchio danno", occurredOn: "2024-02-01", status: "settled", claimed: "800,00", received: "600,00" }, TODAY));
    await run((uow) => addClaimEntry(uow, claimId, { entryOn: "2026-05-21", direction: "sent", summary: "Denuncia inviata" }, TODAY));
  }, 60_000);
  afterAll(async () => {
    await t.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("elenca i beni senza polizza registrata e quelli senza polizza in corso; le archiviate non contano", async () => {
    const { rows, withoutAsset } = await policiesByAsset(t.db, TODAY);
    const byId = new Map(rows.map((r) => [r.assetId, r]));
    expect(byId.get(assetA)!.status).toBe("current");
    expect(byId.get(assetB)!.status).toBe("current");
    expect(byId.get(assetC)!.status).toBe("none");
    expect(byId.get(assetB)!.policies.map((p) => p.title)).toEqual(["Polizza vecchia", "Polizza casa"]);
    expect(byId.get(assetA)!.policies[0]!.coverages).toEqual([{ title: "Incendio", sumInsuredCents: 10_000_000, deductibleCents: 25_000 }]);
    expect(withoutAsset.map((p) => p.title)).toEqual(["Polizza senza beni"]);
    const later = await policiesByAsset(t.db, "2027-02-01");
    expect(later.rows.find((r) => r.assetId === assetA)!.status).toBe("notCurrent");
  });

  it("la scheda sinistro raccoglie bene, polizza, storico, lavori, documenti e cronologia", async () => {
    const sheet = (await getClaimSheet(t.db, claimId, TODAY))!;
    expect(sheet.claim.title).toBe("Infiltrazione");
    expect(sheet.policy.policyNumber).toBe("POL-1");
    expect(sheet.assets).toHaveLength(1);
    const a = sheet.assets[0]!;
    expect(a).toMatchObject({ name: "Appartamento A", kindKey: "dwelling", address: "Via Prova 1" });
    expect(a.attributes).toEqual([{ key: "anno_costruzione", value: 1975 }]);
    expect(a.works.map((w) => w.title)).toEqual(["Rifacimento tetto"]);
    expect(a.documents.map((d) => [d.title, d.isImage])).toEqual([["Foto soffitto", true]]);
    expect(sheet.otherClaims.map((c) => [c.title, c.claimedCents, c.receivedCents])).toEqual([["Vecchio danno", 80_000, 60_000]]);
    expect(sheet.claim.entries).toHaveLength(1);
    const present = Object.fromEntries(sheet.checks.map((c) => [c.key, c.present]));
    expect(present).toMatchObject({ description: true, claimed: true, coverages: true, entries: true, documents: true, photos: true, works: true, reportedOn: false, claimNumber: false, adjuster: false });
    expect(await getClaimSheet(t.db, "00000000-0000-4000-8000-000000000000", TODAY)).toBeNull();
  });
});
