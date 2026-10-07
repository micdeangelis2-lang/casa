import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { auditLog, partyCompetence } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { LocalFileStorage } from "@/platform/storage";
import { COMPETENCE_KINDS, addCompetence, createParty, listCompetences, removeCompetence, setPartyArchived } from "@/modules/directory";
import { createDocument, listDocumentCategories } from "@/modules/documents";
import { createTestDb, type TestDb } from "./helpers/test-db";
import { makePdf } from "./helpers/sample-pdf";

const actor = { type: "owner", id: "o1" } as const;
const TODAY = "2026-06-15";
const MISSING = "00000000-0000-4000-8000-000000000000";

describe("competenze dei contatti", () => {
  let t: TestDb;
  let dir: string;
  let storage: LocalFileStorage;
  let partyId: string;
  let docId: string;
  const run = <T>(work: Parameters<typeof runInUnitOfWork<T>>[2]) => runInUnitOfWork(t.db, actor, work);
  const okValue = <V>(r: { ok: boolean; value?: V }): V => {
    if (!r.ok) throw new Error(`atteso successo: ${JSON.stringify(r)}`);
    return r.value as V;
  };

  beforeAll(async () => {
    t = await createTestDb();
    dir = await mkdtemp(join(tmpdir(), "competences-test-"));
    storage = new LocalFileStorage(dir);
    partyId = okValue(await run((uow) => createParty(uow, { displayName: "Geometra Esempio", roles: ["technician"] }))).id;
    const categoryId = (await listDocumentCategories(t.db))[0]!.id;
    docId = okValue(await run((uow) => createDocument(uow, { title: "Tessera", categoryId }, { name: "tessera.pdf", bytes: makePdf("tessera") }, storage))).id;
  }, 60_000);
  afterAll(async () => {
    await t.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("registra, elenca con lo stato dalla data di fine e toglie; l'audit non riporta gli estremi", async () => {
    expect([...COMPETENCE_KINDS]).toEqual(["registration", "qualification", "insurance", "authorization", "other"]);
    expect(await run((uow) => addCompetence(uow, MISSING, { kind: "registration", label: "Albo" }))).toMatchObject({ ok: false });
    expect(await run((uow) => addCompetence(uow, partyId, { kind: "titolo", label: "Albo" }))).toMatchObject({ ok: false, errors: { kind: expect.any(Array) } });
    expect(await run((uow) => addCompetence(uow, partyId, { kind: "registration", label: " " }))).toMatchObject({ ok: false, errors: { label: expect.any(Array) } });
    expect(await run((uow) => addCompetence(uow, partyId, { kind: "registration", label: "Albo", documentId: MISSING }))).toMatchObject({ ok: false, errors: { documentId: expect.any(Array) } });
    expect(await run((uow) => addCompetence(uow, partyId, { kind: "insurance", label: "Polizza", validFrom: "2026-05-01", validUntil: "2026-04-01" }))).toMatchObject({ ok: false, errors: { validUntil: expect.any(Array) } });
    await expect(t.db.insert(partyCompetence).values({ partyId, kind: "boh", label: "x" })).rejects.toThrow();

    okValue(await run((uow) => addCompetence(uow, partyId, { kind: "registration", label: "Collegio dei geometri", reference: "ISCR-SEGRETA-77", issuer: "Collegio provinciale", validFrom: "2010-01-01", documentId: docId })));
    okValue(await run((uow) => addCompetence(uow, partyId, { kind: "insurance", label: "Polizza professionale", validFrom: "2026-01-01", validUntil: "2026-07-01" })));
    okValue(await run((uow) => addCompetence(uow, partyId, { kind: "authorization", label: "Autorizzazione scaduta", validUntil: "2025-12-31" })));

    const list = await listCompetences(t.db, partyId, TODAY);
    expect(list.map((c) => [c.label, c.state])).toEqual(expect.arrayContaining([["Collegio dei geometri", "undated"], ["Polizza professionale", "expiring"], ["Autorizzazione scaduta", "expired"]]));
    expect(list.find((c) => c.label === "Collegio dei geometri")).toMatchObject({ reference: "ISCR-SEGRETA-77", documentId: docId, kind: "registration" });

    const audits = await t.db.select().from(auditLog).where(eq(auditLog.entityId, partyId));
    expect(audits.filter((a) => a.action === "directory.competence.add")).toHaveLength(3);
    expect(JSON.stringify(audits.map((a) => a.diff))).not.toMatch(/SEGRETA|Collegio/);

    expect(await run((uow) => removeCompetence(uow, list[0]!.id))).toMatchObject({ ok: true });
    expect(await run((uow) => removeCompetence(uow, MISSING))).toMatchObject({ ok: false });
    expect(await listCompetences(t.db, partyId, TODAY)).toHaveLength(2);
  });

  it("archiviare il contatto conserva le competenze", async () => {
    await run((uow) => setPartyArchived(uow, partyId, true));
    expect(await listCompetences(t.db, partyId, TODAY)).toHaveLength(2);
  });
});
