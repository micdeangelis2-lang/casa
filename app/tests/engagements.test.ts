import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, like, sql } from "drizzle-orm";
import { auditLog, territory } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { LocalFileStorage } from "@/platform/storage";
import { createAsset } from "@/modules/assets";
import { createParty } from "@/modules/directory";
import { createDocument, listDocumentCategories } from "@/modules/documents";
import { addDeliverable, createEngagement, groupByProfessional, listEngagements, removeDeliverable, setEngagementStatus, updateEngagement } from "@/modules/engagements";
import { createMatter } from "@/modules/matters";
import { importIstat } from "@/modules/territory";
import messages from "../messages/it.json";
import { conclusiveClaims } from "./helpers/neutral";
import { createTestDb, type TestDb } from "./helpers/test-db";
import { makePdf } from "./helpers/sample-pdf";

const actor = { type: "owner", id: "o1" } as const;
const owner = { displayName: "Proprietario Prova", email: "prova@example.test" };
const NOBODY = "00000000-0000-4000-8000-000000000000";

describe("incarichi ai professionisti", () => {
  let t: TestDb;
  let dir: string;
  let assetId: string;
  let matterId: string;
  let lawyerId: string;
  let surveyorId: string;
  let documentId: string;

  const run = <T>(work: Parameters<typeof runInUnitOfWork<T>>[2]) => runInUnitOfWork(t.db, actor, work);
  const okValue = <V>(r: { ok: boolean; value?: V }): V => {
    if (!r.ok) throw new Error(`atteso successo: ${JSON.stringify(r)}`);
    return r.value as V;
  };

  beforeAll(async () => {
    t = await createTestDb();
    dir = await mkdtemp(join(tmpdir(), "engagements-test-"));
    const storage = new LocalFileStorage(dir);
    await run((uow) => importIstat(uow, [{ regionCode: "90", regionName: "Regione di prova", provinceCode: "900", provinceName: "Provincia di prova", provinceSigla: "PP", municipalityCode: "900001", municipalityName: "Comune Uno", cadastralCode: "Z101" }]));
    const municipalityId = (await t.db.select().from(territory).where(eq(territory.kind, "municipality")))[0]!.id;
    assetId = okValue(await run((uow) => createAsset(uow, owner, { kind: "dwelling", name: "Casa degli incarichi", territoryId: municipalityId }))).id;
    matterId = okValue(await run((uow) => createMatter(uow, { title: "Pratica degli incarichi", openedOn: "2026-05-01" }, "2026-06-15"))).id;
    lawyerId = okValue(await run((uow) => createParty(uow, { displayName: "Studio Legale Esempio", roles: ["lawyer"] }))).id;
    surveyorId = okValue(await run((uow) => createParty(uow, { displayName: "Geometra Esempio", roles: ["surveyor"] }))).id;
    const categoryId = (await listDocumentCategories(t.db))[0]!.id;
    documentId = okValue(await run((uow) => createDocument(uow, { title: "Relazione ricevuta", categoryId }, { name: "relazione.pdf", bytes: makePdf("relazione") }, storage))).id;
  }, 60_000);
  afterAll(async () => {
    await t.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("registra un incarico con compenso dichiarato e controlla i riferimenti", async () => {
    const base = { partyId: lawyerId, subject: "Assistenza nella pratica", engagedOn: "2026-05-10" };
    expect(await run((uow) => createEngagement(uow, { ...base, subject: " " }))).toMatchObject({ ok: false, errors: { subject: expect.any(Array) } });
    expect(await run((uow) => createEngagement(uow, { ...base, engagedOn: "" }))).toMatchObject({ ok: false, errors: { engagedOn: expect.any(Array) } });
    expect(await run((uow) => createEngagement(uow, { ...base, partyId: "" }))).toMatchObject({ ok: false, errors: { partyId: expect.any(Array) } });
    expect(await run((uow) => createEngagement(uow, { ...base, partyId: NOBODY }))).toMatchObject({ ok: false, errors: { partyId: ["Il contatto non esiste più nella rubrica"] } });
    expect(await run((uow) => createEngagement(uow, { ...base, assetId: NOBODY }))).toMatchObject({ ok: false, errors: { assetId: expect.any(Array) } });
    expect(await run((uow) => createEngagement(uow, { ...base, matterId: NOBODY }))).toMatchObject({ ok: false, errors: { matterId: expect.any(Array) } });
    expect(await run((uow) => createEngagement(uow, { ...base, documentId: NOBODY }))).toMatchObject({ ok: false, errors: { documentId: expect.any(Array) } });
    expect(await run((uow) => createEngagement(uow, { ...base, declaredFee: "-3" }))).toMatchObject({ ok: false, errors: { declaredFee: expect.any(Array) } });
    expect(await run((uow) => createEngagement(uow, { ...base, status: "boh" }))).toMatchObject({ ok: false, errors: { status: expect.any(Array) } });

    const id = okValue(await run((uow) => createEngagement(uow, { ...base, declaredFee: "1.500,00", matterId, assetId, note: "Prima fase" }))).id;
    const [item] = await listEngagements(t.db, { matterId });
    expect(item).toMatchObject({ id, partyName: "Studio Legale Esempio", subject: "Assistenza nella pratica", declaredFeeCents: 150_000, status: "active", matterTitle: "Pratica degli incarichi", assetName: "Casa degli incarichi", open: true, deliverables: [] });
    await expect(t.db.execute(sql`update engagement set declared_fee_cents = -1 where id = ${id}`)).rejects.toThrow();
  });

  it("modifica, cambia lo stato e filtra per professionista, bene e pratica", async () => {
    const [existing] = await listEngagements(t.db, { matterId });
    const id = existing!.id;
    const other = okValue(await run((uow) => createEngagement(uow, { partyId: surveyorId, subject: "Rilievo e planimetria", engagedOn: "2026-06-01", assetId }))).id;

    expect(await run((uow) => updateEngagement(uow, NOBODY, { partyId: lawyerId, subject: "x", engagedOn: "2026-05-10" }))).toMatchObject({ ok: false });
    expect(await run((uow) => updateEngagement(uow, id, { partyId: lawyerId, subject: "Assistenza e udienze", engagedOn: "2026-05-10", declaredFee: "", matterId, assetId }))).toMatchObject({ ok: true });
    expect((await listEngagements(t.db, { matterId }))[0]).toMatchObject({ subject: "Assistenza e udienze", declaredFeeCents: null });

    expect(await run((uow) => setEngagementStatus(uow, id, "boh"))).toMatchObject({ ok: false, errors: { status: expect.any(Array) } });
    expect(await run((uow) => setEngagementStatus(uow, NOBODY, "completed"))).toMatchObject({ ok: false });
    expect(await run((uow) => setEngagementStatus(uow, id, "completed"))).toMatchObject({ ok: true });
    expect((await listEngagements(t.db, { matterId }))[0]).toMatchObject({ status: "completed", open: false });

    expect((await listEngagements(t.db, { partyId: surveyorId })).map((e) => e.id)).toEqual([other]);
    expect((await listEngagements(t.db, { assetId })).map((e) => e.partyName).sort()).toEqual(["Geometra Esempio", "Studio Legale Esempio"]);
    const groups = groupByProfessional(await listEngagements(t.db));
    expect(groups.map((g) => [g.partyName, g.items.length])).toEqual([["Geometra Esempio", 1], ["Studio Legale Esempio", 1]]);
  });

  it("elaborati consegnati e ricevuti, con documento facoltativo", async () => {
    const id = (await listEngagements(t.db, { partyId: surveyorId }))[0]!.id;
    const ok = { direction: "received", kindLabel: "Planimetria aggiornata", occurredOn: "2026-06-20" };
    expect(await run((uow) => addDeliverable(uow, NOBODY, ok))).toMatchObject({ ok: false });
    expect(await run((uow) => addDeliverable(uow, id, { ...ok, direction: "boh" }))).toMatchObject({ ok: false, errors: { direction: expect.any(Array) } });
    expect(await run((uow) => addDeliverable(uow, id, { ...ok, kindLabel: "" }))).toMatchObject({ ok: false, errors: { kindLabel: expect.any(Array) } });
    expect(await run((uow) => addDeliverable(uow, id, { ...ok, occurredOn: "" }))).toMatchObject({ ok: false, errors: { occurredOn: expect.any(Array) } });
    expect(await run((uow) => addDeliverable(uow, id, { ...ok, documentId: NOBODY }))).toMatchObject({ ok: false, errors: { documentId: expect.any(Array) } });

    expect(await run((uow) => addDeliverable(uow, id, { direction: "delivered", kindLabel: "Visura consegnata", occurredOn: "2026-06-05" }))).toMatchObject({ ok: true });
    expect(await run((uow) => addDeliverable(uow, id, { ...ok, documentId }))).toMatchObject({ ok: true });
    const [item] = await listEngagements(t.db, { partyId: surveyorId });
    expect(item!.deliverables.map((d) => [d.direction, d.kindLabel, d.documentTitle])).toEqual([["delivered", "Visura consegnata", null], ["received", "Planimetria aggiornata", "Relazione ricevuta"]]);

    expect(await run((uow) => removeDeliverable(uow, item!.deliverables[0]!.id))).toMatchObject({ ok: true });
    expect(await run((uow) => removeDeliverable(uow, item!.deliverables[0]!.id))).toMatchObject({ ok: false });
    expect((await listEngagements(t.db, { partyId: surveyorId }))[0]!.deliverables).toHaveLength(1);
  });

  it("l'audit registra nomi e identificativi, mai oggetto, compenso o tipo di elaborato", async () => {
    const rows = await t.db.select().from(auditLog).where(like(auditLog.action, "engagement.%"));
    expect(rows.length).toBeGreaterThan(5);
    const text = JSON.stringify(rows.map((r) => r.diff));
    for (const secret of ["Assistenza", "Rilievo", "Planimetria", "Visura", "150000", "1.500", "Prima fase"]) expect(text).not.toContain(secret);
    expect(rows.find((r) => r.action === "engagement.update")!.diff).toMatchObject({ changed: expect.arrayContaining(["subject", "declaredFeeCents"]) });
  });

  it("i messaggi dell'area non suonano come verdetti", () => {
    const texts: string[] = [];
    const walk = (n: unknown) => (typeof n === "string" ? texts.push(n) : n && typeof n === "object" ? Object.values(n).forEach(walk) : undefined);
    walk(messages.engagements);
    expect(texts.flatMap(conclusiveClaims)).toEqual([]);
  });
});
