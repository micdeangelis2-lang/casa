import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { eq, sql } from "drizzle-orm";
import { auditLog, deadline, deadlineOccurrence, managementMandate, territory } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { LocalFileStorage } from "@/platform/storage";
import { createAsset } from "@/modules/assets";
import { listDeadlines, updateDeadline } from "@/modules/deadlines";
import { createParty } from "@/modules/directory";
import { createDocument, listDocumentCategories } from "@/modules/documents";
import { createMandate, listMandates, setMandateArchived } from "@/modules/management";
import { importIstat } from "@/modules/territory";
import { createTestDb, type TestDb } from "./helpers/test-db";
import { makePdf } from "./helpers/sample-pdf";

const actor = { type: "owner", id: "o1" } as const;
const owner = { displayName: "Proprietario Prova", email: "prova@example.test" };
const TODAY = "2026-10-06";
const MISSING = "00000000-0000-4000-8000-000000000000";

describe("mandati di gestione come dati", () => {
  let t: TestDb;
  let dir: string;
  let storage: LocalFileStorage;
  let assetId: string;
  let otherAssetId: string;
  let managerId: string;
  let docId: string;
  const run = <T>(work: Parameters<typeof runInUnitOfWork<T>>[2]) => runInUnitOfWork(t.db, actor, work);
  const okValue = <V>(r: { ok: boolean; value?: V }): V => {
    if (!r.ok) throw new Error(`atteso successo: ${JSON.stringify(r)}`);
    return r.value as V;
  };

  beforeAll(async () => {
    t = await createTestDb();
    dir = await mkdtemp(join(tmpdir(), "mandates-test-"));
    storage = new LocalFileStorage(dir);
    await run((uow) => importIstat(uow, [{ regionCode: "90", regionName: "Regione di prova", provinceCode: "900", provinceName: "Provincia di prova", provinceSigla: "PP", municipalityCode: "900001", municipalityName: "Comune Uno", cadastralCode: "Z101" }]));
    const municipalityId = (await t.db.select().from(territory).where(eq(territory.kind, "municipality")))[0]!.id;
    assetId = okValue(await run((uow) => createAsset(uow, owner, { kind: "dwelling", name: "Appartamento Gestito", territoryId: municipalityId }))).id;
    otherAssetId = okValue(await run((uow) => createAsset(uow, owner, { kind: "dwelling", name: "Altro immobile", territoryId: municipalityId }))).id;
    managerId = okValue(await run((uow) => createParty(uow, { displayName: "Gestore Prova", roles: ["manager"] }))).id;
    const categoryId = (await listDocumentCategories(t.db))[0]!.id;
    docId = okValue(await run((uow) => createDocument(uow, { title: "Mandato firmato", categoryId }, { name: "mandato.pdf", bytes: makePdf("mandato") }, storage))).id;
  }, 60_000);
  afterAll(async () => {
    await t.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("il mandato e' un dato: sopravvive alla rinomina della scadenza e si archivia con la scadenza collegata", async () => {
    expect(await run((uow) => createMandate(uow, { managerPartyId: MISSING, endsOn: "2026-11-15" }))).toMatchObject({ ok: false, errors: { managerPartyId: expect.any(Array) } });
    expect(await run((uow) => createMandate(uow, { managerPartyId: managerId, endsOn: "2026-11-15", documentId: MISSING }))).toMatchObject({ ok: false, errors: { documentId: expect.any(Array) } });
    expect(await run((uow) => createMandate(uow, { managerPartyId: managerId, startsOn: "2026-12-01", endsOn: "2026-11-15" }))).toMatchObject({ ok: false, errors: { endsOn: expect.any(Array) } });

    const id = okValue(await run((uow) => createMandate(uow, { managerPartyId: managerId, assetId, startsOn: "2026-01-01", endsOn: "2026-11-15", compensation: "COMPENSO-SEGRETO 8%", documentId: docId, note: "Nota riservata" }))).id;
    const [row] = await t.db.select().from(managementMandate).where(eq(managementMandate.id, id));
    expect(row).toMatchObject({ assetId, managerPartyId: managerId, startsOn: "2026-01-01", endsOn: "2026-11-15", compensation: "COMPENSO-SEGRETO 8%", documentId: docId });
    expect(row!.deadlineId).toBeTruthy();

    const [m] = await listMandates(t.db, TODAY);
    expect(m).toMatchObject({ id, managerName: "Gestore Prova", assetName: "Appartamento Gestito", endsOn: "2026-11-15", compensation: "COMPENSO-SEGRETO 8%", documentTitle: "Mandato firmato", state: "expiring", deadlineId: row!.deadlineId });
    expect(await listMandates(t.db, TODAY, otherAssetId)).toEqual([]);

    // Rinominare la scadenza collegata non fa sparire il mandato (prima si riconosceva dal prefisso del titolo).
    const linked = (await listDeadlines(t.db, {})).find((d) => d.id === row!.deadlineId)!;
    okValue(await run((uow) => updateDeadline(uow, linked.id, { title: "Fine incarico", category: linked.category, level: linked.level, calc: { type: "manual" }, firstDueOn: "2026-11-15", assetId, professionalPartyId: managerId })));
    expect((await listMandates(t.db, TODAY)).map((x) => x.id)).toEqual([id]);

    const audits = await t.db.select().from(auditLog).where(eq(auditLog.entityId, id));
    expect(audits.some((a) => a.action === "management.mandate.create")).toBe(true);
    expect(JSON.stringify(audits.map((a) => a.diff))).not.toMatch(/SEGRETO|riservata/);

    expect(await run((uow) => setMandateArchived(uow, MISSING, true))).toMatchObject({ ok: false });
    okValue(await run((uow) => setMandateArchived(uow, id, true)));
    expect(await listMandates(t.db, TODAY)).toEqual([]);
    expect((await listDeadlines(t.db, {})).map((d) => d.id)).not.toContain(row!.deadlineId);
    okValue(await run((uow) => setMandateArchived(uow, id, false)));
    expect((await listMandates(t.db, TODAY)).map((x) => x.id)).toEqual([id]);
  });

  it("la migrazione trasforma le scadenze «Mandato di gestione» gia' registrate in mandati, senza toccarle", async () => {
    const migration = await readFile(resolve(__dirname, "../drizzle/0021_mandates_listings_agent.sql"), "utf8");
    const backfill = migration.slice(migration.indexOf('INSERT INTO "management_mandate"'));
    await t.db.delete(managementMandate);
    const base = { category: "contractual", level: "contract", calc: { type: "manual" } };
    const [withComp] = await t.db.insert(deadline).values({ ...base, title: "Mandato di gestione: Gestore Prova (Casa)", description: "Compenso dichiarato: 5% dei canoni\nNota del proprietario", professionalPartyId: managerId, assetId }).returning();
    const [plain] = await t.db.insert(deadline).values({ ...base, title: "Mandato di gestione: Altro", description: "Solo una nota" }).returning();
    const [archived] = await t.db.insert(deadline).values({ ...base, title: "Mandato di gestione: Vecchio", archivedAt: new Date() }).returning();
    const [unrelated] = await t.db.insert(deadline).values({ ...base, title: "Un'altra scadenza" }).returning();
    await t.db.insert(deadlineOccurrence).values([
      { deadlineId: withComp!.id, dueOn: "2027-03-01", status: "open" },
      { deadlineId: withComp!.id, dueOn: "2026-03-01", status: "done" },
      { deadlineId: plain!.id, dueOn: "2025-01-01", status: "done" },
    ]);
    await t.db.execute(sql.raw(backfill));
    const rows = await t.db.select().from(managementMandate);
    const byDeadline = new Map(rows.map((r) => [r.deadlineId, r]));
    expect(rows).toHaveLength(2);
    expect(byDeadline.get(withComp!.id)).toMatchObject({ assetId, managerPartyId: managerId, endsOn: "2027-03-01", compensation: "5% dei canoni", note: "Nota del proprietario" });
    expect(byDeadline.get(plain!.id)).toMatchObject({ endsOn: "2025-01-01", compensation: null, note: "Solo una nota", managerPartyId: null });
    expect(byDeadline.has(archived!.id)).toBe(false);
    expect(byDeadline.has(unrelated!.id)).toBe(false);
    // Le scadenze originali restano.
    expect((await t.db.select({ id: deadline.id }).from(deadline).where(eq(deadline.id, withComp!.id))).length).toBe(1);
  });
});
