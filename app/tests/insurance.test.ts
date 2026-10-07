import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { auditLog, territory } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { LocalFileStorage } from "@/platform/storage";
import { createAsset } from "@/modules/assets";
import { getDeadlineDetail, listDeadlines } from "@/modules/deadlines";
import { createParty } from "@/modules/directory";
import { createDocument, listDocumentCategories } from "@/modules/documents";
import { createMatter } from "@/modules/matters";
import { importIstat } from "@/modules/territory";
import {
  addClaimEntry,
  addCoverage,
  addPremium,
  createClaim,
  createPolicy,
  createPolicyDeadline,
  getClaimDetail,
  getPolicyDetail,
  listClaims,
  listPolicies,
  removeClaimEntry,
  removeCoverage,
  removePremium,
  setClaimStatus,
  setPolicyArchived,
  setPremiumPaid,
  updateClaim,
  updatePolicy,
} from "@/modules/insurance";
import { createTestDb, type TestDb } from "./helpers/test-db";
import { makePdf } from "./helpers/sample-pdf";

const actor = { type: "owner", id: "o1" } as const;
const owner = { displayName: "Proprietario Prova", email: "prova@example.test" };
const TODAY = "2026-06-15";

describe("assicurazioni e sinistri", () => {
  let t: TestDb;
  let dir: string;
  let storage: LocalFileStorage;
  let assetA: string;
  let assetB: string;
  let insurerId: string;
  let adjusterId: string;
  let documentId: string;
  let matterId: string;
  let policyId: string;
  let claimId: string;

  const run = <T>(work: Parameters<typeof runInUnitOfWork<T>>[2]) => runInUnitOfWork(t.db, actor, work);
  const okValue = <V>(r: { ok: boolean; value?: V }): V => {
    if (!r.ok) throw new Error(`atteso successo: ${JSON.stringify(r)}`);
    return r.value as V;
  };
  const policy = () => getPolicyDetail(t.db, policyId, TODAY).then((p) => p!);
  const claim = () => getClaimDetail(t.db, claimId).then((c) => c!);

  beforeAll(async () => {
    t = await createTestDb();
    dir = await mkdtemp(join(tmpdir(), "ins-test-"));
    storage = new LocalFileStorage(dir);
    await run((uow) => importIstat(uow, [{ regionCode: "90", regionName: "Regione di prova", provinceCode: "900", provinceName: "Provincia di prova", provinceSigla: "PP", municipalityCode: "900001", municipalityName: "Comune Uno", cadastralCode: "Z101" }]));
    const municipalityId = (await t.db.select().from(territory).where(eq(territory.kind, "municipality")))[0]!.id;
    assetA = okValue(await run((uow) => createAsset(uow, owner, { kind: "dwelling", name: "Appartamento A", territoryId: municipalityId }))).id;
    assetB = okValue(await run((uow) => createAsset(uow, owner, { kind: "garage", name: "Box B", territoryId: municipalityId }))).id;
    insurerId = okValue(await run((uow) => createParty(uow, { displayName: "Compagnia Esempio", roles: ["insurer"] }))).id;
    adjusterId = okValue(await run((uow) => createParty(uow, { displayName: "Perito Esempio", roles: ["adjuster"] }))).id;
    const categoryId = (await listDocumentCategories(t.db))[0]!.id;
    documentId = okValue(await run((uow) => createDocument(uow, { title: "Ricevuta premio", categoryId }, { name: "ricevuta.pdf", bytes: makePdf("ricevuta") }, storage))).id;
    matterId = okValue(await run((uow) => createMatter(uow, { title: "Pratica sinistro" }))).id;
  }, 60_000);
  afterAll(async () => {
    await t.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("una polizza lega assicuratore, immobili e periodo; il promemoria di rinnovo si crea solo con la data di fine", async () => {
    expect(await run((uow) => createPolicy(uow, { title: "Polizza casa", startsOn: "2026-06-01", endsOn: "2026-05-01" }))).toMatchObject({ ok: false, errors: { endsOn: expect.any(Array) } });
    expect(await run((uow) => createPolicy(uow, { title: "P", insurerPartyId: "00000000-0000-4000-8000-000000000000" }))).toMatchObject({ ok: false, errors: { insurerPartyId: expect.any(Array) } });
    expect(await run((uow) => createPolicy(uow, { title: "P", assetIds: ["00000000-0000-4000-8000-000000000000"] }))).toMatchObject({ ok: false, errors: { assetIds: expect.any(Array) } });
    expect(await run((uow) => createPolicy(uow, { title: "P", createDeadline: true }))).toMatchObject({ ok: false, errors: { endsOn: expect.any(Array) } });

    policyId = okValue(await run((uow) => createPolicy(uow, { title: "Polizza casa", insurerPartyId: insurerId, policyNumber: "POL-123", startsOn: "2025-12-01", endsOn: "2026-11-30", premium: "480,00", assetIds: [assetA, assetA], documentId, createDeadline: true }))).id;
    const p = await policy();
    expect(p).toMatchObject({ title: "Polizza casa", insurerName: "Compagnia Esempio", state: "active", openClaims: 0, nextPremium: null, documentTitle: "Ricevuta premio" });
    expect(p.assets.map((a) => a.name)).toEqual(["Appartamento A"]);
    const deadline = (await listDeadlines(t.db)).find((d) => d.title === "Rinnovo della polizza: Polizza casa")!;
    expect(deadline).toMatchObject({ category: "insurance", level: "contract", assetId: assetA });
    expect(p.deadlineId).toBe(deadline.id);

    // Una polizza che riguarda piu' immobili non lega la scadenza a uno solo.
    const multi = okValue(await run((uow) => createPolicy(uow, { title: "Polizza globale", endsOn: "2027-01-31", assetIds: [assetA, assetB] }))).id;
    expect(await run((uow) => createPolicyDeadline(uow, multi))).toMatchObject({ ok: true });
    expect((await listDeadlines(t.db)).find((d) => d.title === "Rinnovo della polizza: Polizza globale")!.assetId).toBeNull();
    expect(await run((uow) => createPolicyDeadline(uow, multi))).toMatchObject({ ok: false, errors: { _: ["La polizza ha già un promemoria"] } });
    const noDate = okValue(await run((uow) => createPolicy(uow, { title: "Senza fine" }))).id;
    expect(await run((uow) => createPolicyDeadline(uow, noDate))).toMatchObject({ ok: false, errors: { endsOn: expect.any(Array) } });

    await run((uow) => updatePolicy(uow, policyId, { title: "Polizza casa e box", insurerPartyId: insurerId, endsOn: "2026-11-30", assetIds: [assetA, assetB] }));
    expect((await policy()).assets.map((a) => a.name).sort()).toEqual(["Appartamento A", "Box B"]);
    expect((await listPolicies(t.db, false, "2026-12-15")).find((x) => x.id === policyId)!.state).toBe("expired");
    expect((await listPolicies(t.db, false, "2026-11-15")).find((x) => x.id === policyId)!.state).toBe("expiring");
  });

  it("le garanzie si copiano a mano dalla polizza, senza interpretarle", async () => {
    expect(await run((uow) => addCoverage(uow, policyId, { title: " " }))).toMatchObject({ ok: false, errors: { title: expect.any(Array) } });
    await run((uow) => addCoverage(uow, policyId, { title: "Incendio", sumInsured: "200.000,00", deductible: "250,00", note: "Come da polizza" }));
    await run((uow) => addCoverage(uow, policyId, { title: "Responsabilità civile" }));
    const coverages = (await policy()).coverages;
    expect(coverages.map((c) => [c.title, c.sumInsuredCents, c.deductibleCents])).toEqual([["Incendio", 20_000_000, 25_000], ["Responsabilità civile", null, null]]);
    expect(await run((uow) => removeCoverage(uow, coverages[1]!.id))).toMatchObject({ ok: true });
    expect(await run((uow) => removeCoverage(uow, coverages[1]!.id))).toMatchObject({ ok: false });
    expect((await policy()).coverages).toHaveLength(1);
  });

  it("i premi hanno scadenza e importo; il pagamento chiude la scadenza collegata e conserva la ricevuta", async () => {
    expect(await run((uow) => addPremium(uow, policyId, { dueOn: "2026-06-01", amount: "abc" }))).toMatchObject({ ok: false, errors: { amount: expect.any(Array) } });
    await run((uow) => addPremium(uow, policyId, { dueOn: "2026-06-01", amount: "240,00", createDeadline: true }));
    await run((uow) => addPremium(uow, policyId, { dueOn: "2026-12-01", amount: "240,00" }));
    let p = await policy();
    expect(p.premiums.map((x) => [x.dueOn, x.amountCents, x.overdue])).toEqual([["2026-06-01", 24_000, true], ["2026-12-01", 24_000, false]]);
    expect(p.nextPremium).toEqual({ dueOn: "2026-06-01", amountCents: 24_000, overdue: true });
    const first = p.premiums[0]!;
    const deadlineId = (await listDeadlines(t.db)).find((d) => d.title === "Premio della polizza: Polizza casa e box")!.id;
    expect((await getDeadlineDetail(t.db, deadlineId, TODAY))!.occurrences[0]!.status).toBe("open");

    expect(await run((uow) => setPremiumPaid(uow, first.id, { paidOn: "ieri" }))).toMatchObject({ ok: false, errors: { paidOn: expect.any(Array) } });
    await run((uow) => setPremiumPaid(uow, first.id, { paidOn: "2026-06-10", documentId }));
    p = await policy();
    expect(p.premiums[0]).toMatchObject({ paidOn: "2026-06-10", overdue: false, documentTitle: "Ricevuta premio" });
    expect(p.nextPremium).toMatchObject({ dueOn: "2026-12-01", overdue: false });
    expect((await getDeadlineDetail(t.db, deadlineId, TODAY))!.occurrences[0]).toMatchObject({ status: "done", completedOn: "2026-06-10" });

    expect(await run((uow) => removePremium(uow, p.premiums[1]!.id))).toMatchObject({ ok: true });
    expect((await policy()).premiums).toHaveLength(1);
  });

  it("un sinistro si apre su una polizza, con importi scritti dal proprietario; la chiusura compila la data", async () => {
    expect(await run((uow) => createClaim(uow, { policyId: "00000000-0000-4000-8000-000000000000", title: "X", occurredOn: "2026-05-01" }, TODAY))).toMatchObject({ ok: false, errors: { policyId: expect.any(Array) } });
    expect(await run((uow) => createClaim(uow, { policyId, title: "X", occurredOn: "2026-05-10", reportedOn: "2026-05-01" }, TODAY))).toMatchObject({ ok: false, errors: { reportedOn: expect.any(Array) } });
    expect(await run((uow) => createClaim(uow, { policyId, title: "X", occurredOn: "2026-05-10", matterId: "00000000-0000-4000-8000-000000000000" }, TODAY))).toMatchObject({ ok: false, errors: { matterId: expect.any(Array) } });
    expect(await run((uow) => createClaim(uow, { policyId, title: "X", occurredOn: "2026-05-10", adjusterPartyId: "00000000-0000-4000-8000-000000000000" }, TODAY))).toMatchObject({ ok: false, errors: { adjusterPartyId: expect.any(Array) } });

    claimId = okValue(await run((uow) => createClaim(uow, { policyId, assetId: assetA, title: "Infiltrazione dal terrazzo", claimNumber: "SIN-77", occurredOn: "2026-05-10", reportedOn: "2026-05-12", status: "reported", claimed: "1.800,00", adjusterPartyId: adjusterId, matterId, description: "Macchia sul soffitto" }, TODAY))).id;
    expect(await claim()).toMatchObject({ policyTitle: "Polizza casa e box", assetName: "Appartamento A", adjusterName: "Perito Esempio", matterTitle: "Pratica sinistro", status: "reported", claimedCents: 180_000, receivedCents: null, closedOn: null, open: true });
    expect((await policy()).openClaims).toBe(1);

    expect(await run((uow) => setClaimStatus(uow, claimId, "pagato", TODAY))).toMatchObject({ ok: false, errors: { status: expect.any(Array) } });
    await run((uow) => setClaimStatus(uow, claimId, "in_review", TODAY));
    expect(await claim()).toMatchObject({ status: "in_review", closedOn: null });
    await run((uow) => updateClaim(uow, claimId, { policyId, assetId: assetA, title: "Infiltrazione dal terrazzo", occurredOn: "2026-05-10", status: "settled", claimed: "1.800,00", received: "1.500,00", adjusterPartyId: adjusterId }, "2026-07-01"));
    expect(await claim()).toMatchObject({ status: "settled", receivedCents: 150_000, closedOn: "2026-07-01", open: false, matterTitle: null });
    expect((await listClaims(t.db)).map((c) => c.id)).not.toContain(claimId);
    expect((await listClaims(t.db, { includeClosed: true })).map((c) => c.id)).toContain(claimId);
    expect((await policy()).openClaims).toBe(0);
    expect((await policy()).claims.map((c) => c.id)).toEqual([claimId]);
    await run((uow) => setClaimStatus(uow, claimId, "open", TODAY));
    expect(await claim()).toMatchObject({ status: "open", closedOn: null });
  });

  it("le comunicazioni del sinistro registrano cosa e' stato inviato, ricevuto o annotato, con il documento", async () => {
    expect(await run((uow) => addClaimEntry(uow, claimId, { summary: " " }, TODAY))).toMatchObject({ ok: false, errors: { summary: expect.any(Array) } });
    await run((uow) => addClaimEntry(uow, claimId, { summary: "Inviata la denuncia", direction: "sent", entryOn: "2026-05-12", documentId }, TODAY));
    await run((uow) => addClaimEntry(uow, claimId, { summary: "Risposta del perito", direction: "received" }, TODAY));
    const entries = (await claim()).entries;
    expect(entries.map((e) => [e.entryOn, e.direction, e.summary, e.documentTitle])).toEqual([
      ["2026-05-12", "sent", "Inviata la denuncia", "Ricevuta premio"],
      [TODAY, "received", "Risposta del perito", null],
    ]);
    expect(await run((uow) => removeClaimEntry(uow, entries[1]!.id))).toMatchObject({ ok: true });
    expect((await claim()).entries).toHaveLength(1);
  });

  it("archiviare una polizza archivia il promemoria; ripristinarla lo riattiva", async () => {
    const deadlineId = (await policy()).deadlineId!;
    await run((uow) => setPolicyArchived(uow, policyId, true));
    expect((await listPolicies(t.db)).map((x) => x.id)).not.toContain(policyId);
    expect((await listPolicies(t.db, true)).map((x) => x.id)).toContain(policyId);
    expect((await listDeadlines(t.db)).map((d) => d.id)).not.toContain(deadlineId);
    await run((uow) => setPolicyArchived(uow, policyId, false));
    expect((await listDeadlines(t.db)).map((d) => d.id)).toContain(deadlineId);
  });

  it("l'audit registra azioni e identificativi, mai testi, numeri di polizza o importi", async () => {
    const rows = await t.db.select().from(auditLog).where(sql`${auditLog.action} like 'insurance.%'`);
    expect(new Set(rows.map((r) => r.action)).size).toBeGreaterThan(14);
    const text = JSON.stringify(rows);
    for (const secret of ["Polizza casa", "POL-123", "SIN-77", "Infiltrazione", "Macchia sul soffitto", "Inviata la denuncia", "Compagnia Esempio", "Perito Esempio", "Incendio"]) expect(text, secret).not.toContain(secret);
    expect((await t.db.execute(sql`select audit_log_verify() as v`) as unknown as { rows: { v: unknown }[] }).rows[0]!.v).toBeNull();
  });
});
