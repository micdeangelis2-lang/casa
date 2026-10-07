import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { auditLog, listingEngagement, listingEvent, territory } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { LocalFileStorage } from "@/platform/storage";
import { createAsset } from "@/modules/assets";
import { addEngagement, addListingEvent, listEngagements, removeEngagement, removeListingEvent, setEngagementStatus } from "@/modules/agent";
import { createParty } from "@/modules/directory";
import { createDocument, listDocumentCategories } from "@/modules/documents";
import { importIstat } from "@/modules/territory";
import { createTestDb, type TestDb } from "./helpers/test-db";
import { makePdf } from "./helpers/sample-pdf";

const actor = { type: "owner", id: "o1" } as const;
const owner = { displayName: "Proprietario Prova", email: "prova@example.test" };
const MISSING = "00000000-0000-4000-8000-000000000000";

describe("mandati di vendita o affitto, visite e proposte", () => {
  let t: TestDb;
  let dir: string;
  let storage: LocalFileStorage;
  let assetId: string;
  let agentId: string;
  let buyerId: string;
  let docId: string;
  const run = <T>(work: Parameters<typeof runInUnitOfWork<T>>[2]) => runInUnitOfWork(t.db, actor, work);
  const okValue = <V>(r: { ok: boolean; value?: V }): V => {
    if (!r.ok) throw new Error(`atteso successo: ${JSON.stringify(r)}`);
    return r.value as V;
  };

  beforeAll(async () => {
    t = await createTestDb();
    dir = await mkdtemp(join(tmpdir(), "listings-test-"));
    storage = new LocalFileStorage(dir);
    await run((uow) => importIstat(uow, [{ regionCode: "90", regionName: "Regione di prova", provinceCode: "900", provinceName: "Provincia di prova", provinceSigla: "PP", municipalityCode: "900001", municipalityName: "Comune Uno", cadastralCode: "Z101" }]));
    const municipalityId = (await t.db.select().from(territory).where(eq(territory.kind, "municipality")))[0]!.id;
    assetId = okValue(await run((uow) => createAsset(uow, owner, { kind: "dwelling", name: "Casa in vendita", territoryId: municipalityId }))).id;
    agentId = okValue(await run((uow) => createParty(uow, { displayName: "Agenzia Esempio" }))).id;
    buyerId = okValue(await run((uow) => createParty(uow, { displayName: "Interessato Esempio" }))).id;
    const categoryId = (await listDocumentCategories(t.db))[0]!.id;
    docId = okValue(await run((uow) => createDocument(uow, { title: "Incarico firmato", categoryId }, { name: "incarico.pdf", bytes: makePdf("incarico") }, storage))).id;
  }, 60_000);
  afterAll(async () => {
    await t.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("registra un mandato con agente dalla rubrica, durata, prezzo richiesto e provvigione come testo; l'audit non riporta i valori", async () => {
    expect(await run((uow) => addEngagement(uow, { assetId, kind: "permuta" }))).toMatchObject({ ok: false, errors: { kind: expect.any(Array) } });
    expect(await run((uow) => addEngagement(uow, { assetId: MISSING, kind: "sale" }))).toMatchObject({ ok: false, errors: { assetId: expect.any(Array) } });
    expect(await run((uow) => addEngagement(uow, { assetId, kind: "sale", agentPartyId: MISSING }))).toMatchObject({ ok: false });
    expect(await run((uow) => addEngagement(uow, { assetId, kind: "sale", documentId: MISSING }))).toMatchObject({ ok: false, errors: { documentId: expect.any(Array) } });
    expect(await run((uow) => addEngagement(uow, { assetId, kind: "sale", startsOn: "2026-06-01", endsOn: "2026-05-01" }))).toMatchObject({ ok: false, errors: { endsOn: expect.any(Array) } });
    expect(await run((uow) => addEngagement(uow, { assetId, kind: "sale", asking: "-1" }))).toMatchObject({ ok: false, errors: { asking: expect.any(Array) } });

    okValue(await run((uow) => addEngagement(uow, { assetId, kind: "sale", agentPartyId: agentId, startsOn: "2026-03-01", endsOn: "2026-09-01", exclusive: true, asking: "250.000,00", commission: "PROVVIGIONE-SEGRETA 3%", documentId: docId })));
    const [e] = await listEngagements(t.db, assetId);
    expect(e).toMatchObject({ kind: "sale", status: "active", exclusive: true, agentName: "Agenzia Esempio", askingCents: 25_000_000, commission: "PROVVIGIONE-SEGRETA 3%", documentTitle: "Incarico firmato", counts: { visits: 0, proposals: 0 } });
    const audits = await t.db.select().from(auditLog).where(eq(auditLog.entityId, e!.id));
    expect(audits.some((a) => a.action === "agent.engagement.add")).toBe(true);
    expect(JSON.stringify(audits.map((a) => a.diff))).not.toMatch(/SEGRETA|250/);
  });

  it("visite e proposte: tipo, data, importo ed esito solo per le proposte, contatto dalla rubrica; i conteggi vengono dai dati", async () => {
    const [e] = await listEngagements(t.db, assetId);
    expect(await run((uow) => addListingEvent(uow, MISSING, { kind: "visit", occurredOn: "2026-04-01" }))).toMatchObject({ ok: false });
    expect(await run((uow) => addListingEvent(uow, e!.id, { kind: "boh", occurredOn: "2026-04-01" }))).toMatchObject({ ok: false, errors: { kind: expect.any(Array) } });
    expect(await run((uow) => addListingEvent(uow, e!.id, { kind: "visit", occurredOn: "" }))).toMatchObject({ ok: false, errors: { occurredOn: expect.any(Array) } });
    expect(await run((uow) => addListingEvent(uow, e!.id, { kind: "visit", occurredOn: "2026-04-01", amount: "100" }))).toMatchObject({ ok: false, errors: { amount: expect.any(Array) } });
    expect(await run((uow) => addListingEvent(uow, e!.id, { kind: "note", occurredOn: "2026-04-01", outcome: "open" }))).toMatchObject({ ok: false, errors: { outcome: expect.any(Array) } });
    expect(await run((uow) => addListingEvent(uow, e!.id, { kind: "proposal", occurredOn: "2026-04-01", outcome: "quasi" }))).toMatchObject({ ok: false, errors: { outcome: expect.any(Array) } });
    expect(await run((uow) => addListingEvent(uow, e!.id, { kind: "proposal", occurredOn: "2026-04-01", contactPartyId: MISSING }))).toMatchObject({ ok: false });
    await expect(t.db.insert(listingEvent).values({ engagementId: e!.id, kind: "visit", occurredOn: "2026-04-01", amountCents: -5 })).rejects.toThrow();

    okValue(await run((uow) => addListingEvent(uow, e!.id, { kind: "visit", occurredOn: "2026-04-02", note: "Prima visita" })));
    okValue(await run((uow) => addListingEvent(uow, e!.id, { kind: "visit", occurredOn: "2026-04-05" })));
    okValue(await run((uow) => addListingEvent(uow, e!.id, { kind: "proposal", occurredOn: "2026-04-10", amount: "230.000,00", outcome: "open", contactPartyId: buyerId })));
    okValue(await run((uow) => addListingEvent(uow, e!.id, { kind: "counterproposal", occurredOn: "2026-04-12", amount: "240.000,00", outcome: "rejected" })));
    okValue(await run((uow) => addListingEvent(uow, e!.id, { kind: "note", occurredOn: "2026-04-13", note: "Chiamato l'agente" })));

    const [after] = await listEngagements(t.db, assetId);
    expect(after!.counts).toEqual({ visits: 2, proposals: 2 });
    expect(after!.events.map((x) => [x.occurredOn, x.kind, x.amountCents, x.outcome, x.contactName])).toEqual([
      ["2026-04-02", "visit", null, null, null],
      ["2026-04-05", "visit", null, null, null],
      ["2026-04-10", "proposal", 23_000_000, "open", "Interessato Esempio"],
      ["2026-04-12", "counterproposal", 24_000_000, "rejected", null],
      ["2026-04-13", "note", null, null, null],
    ]);

    const audits = await t.db.select().from(auditLog).where(eq(auditLog.entityId, e!.id));
    // Gli importi si cercano interi (centesimi): «230» o «240» possono comparire per caso dentro un identificativo casuale.
    expect(JSON.stringify(audits.map((a) => a.diff))).not.toMatch(/23000000|24000000|Interessato|agente/);

    expect(await run((uow) => removeListingEvent(uow, after!.events[4]!.id))).toMatchObject({ ok: true });
    expect(await run((uow) => removeListingEvent(uow, MISSING))).toMatchObject({ ok: false });
    expect((await listEngagements(t.db, assetId))[0]!.events).toHaveLength(4);
  });

  it("il mandato si conclude, si riapre e si toglie con le sue visite e proposte", async () => {
    const [e] = await listEngagements(t.db, assetId);
    expect(await run((uow) => setEngagementStatus(uow, e!.id, "boh"))).toMatchObject({ ok: false });
    okValue(await run((uow) => setEngagementStatus(uow, e!.id, "ended")));
    expect((await listEngagements(t.db, assetId))[0]!.status).toBe("ended");
    okValue(await run((uow) => setEngagementStatus(uow, e!.id, "active")));
    expect(await run((uow) => setEngagementStatus(uow, MISSING, "ended"))).toMatchObject({ ok: false });

    okValue(await run((uow) => removeEngagement(uow, e!.id)));
    expect(await listEngagements(t.db, assetId)).toEqual([]);
    expect(await t.db.select().from(listingEvent)).toEqual([]);
    expect(await t.db.select().from(listingEngagement)).toEqual([]);
    expect(await run((uow) => removeEngagement(uow, e!.id))).toMatchObject({ ok: false });
  });
});
