import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, sql } from "drizzle-orm";
import { auditHead, listAuditAreas, listAuditEntries, verifyAuditChain, type AuditActor } from "@/platform/audit";
import { auditLog } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { createTestDb, type TestDb } from "./helpers/test-db";

const owner: AuditActor = { type: "owner", id: "owner-1" };

async function rows(t: TestDb) {
  return t.db.select().from(auditLog).orderBy(asc(auditLog.seq));
}

/** Drizzle incapsula l'errore di Postgres in "Failed query": il testo vero e' in `cause`. */
async function expectRejected(promise: Promise<unknown>, message: RegExp) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, "l'operazione doveva essere rifiutata").toBeInstanceOf(Error);
  const chain: string[] = [];
  for (let e: unknown = error; e instanceof Error; e = e.cause) chain.push(e.message);
  expect(chain.join(" | ")).toMatch(message);
}

describe("audit_log: catena di hash", () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  it("una catena vuota e' integra", async () => {
    expect(await verifyAuditChain(t.db)).toEqual({ intact: true, headHash: null, rows: 0 });
  });

  it("assegna seq consecutivi e collega ogni riga alla precedente", async () => {
    for (const n of [1, 2, 3]) {
      await runInUnitOfWork(t.db, owner, async ({ audit }) => {
        await audit.record({ action: "test.create", entityType: "test", entityId: `e${n}`, diff: { n } });
      });
    }
    const all = await rows(t);
    expect(all.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(all[0]!.prevHash).toBe("GENESIS");
    expect(all[1]!.prevHash).toBe(all[0]!.hash);
    expect(all[2]!.prevHash).toBe(all[1]!.hash);
    expect(new Set(all.map((r) => r.hash)).size).toBe(3);
    const verification = await verifyAuditChain(t.db);
    expect(verification).toMatchObject({ intact: true, rows: 3, headHash: all[2]!.hash });
  });

  it("ignora seq, istante e hash forniti dall'applicazione", async () => {
    await t.db.insert(auditLog).values({
      seq: 999,
      at: new Date("2000-01-01T00:00:00Z"),
      prevHash: "forged-prev",
      hash: "forged-hash",
      actorType: "owner",
      actorId: "owner-1",
      action: "test.forge",
      entityType: "test",
      entityId: "forged",
    });
    const last = (await rows(t)).at(-1)!;
    expect(last.seq).toBe(4);
    expect(last.hash).not.toBe("forged-hash");
    expect(last.prevHash).not.toBe("forged-prev");
    expect(last.at.getUTCFullYear()).toBeGreaterThanOrEqual(2026);
    expect((await verifyAuditChain(t.db)).intact).toBe(true);
  });

  it("rifiuta UPDATE, DELETE e TRUNCATE", async () => {
    await expectRejected(
      t.db.update(auditLog).set({ action: "x" }).where(sql`seq = 1`),
      /append-only/,
    );
    await expectRejected(t.db.delete(auditLog).where(sql`seq = 1`), /append-only/);
    await expectRejected(t.db.execute(sql`truncate table audit_log`), /append-only/);
    expect((await rows(t)).length).toBeGreaterThan(0);
  });

  it("l'esito non dipende dal fuso orario della sessione", async () => {
    await t.db.execute(sql`set time zone 'Asia/Tokyo'`);
    expect((await verifyAuditChain(t.db)).intact).toBe(true);
    await t.db.execute(sql`set time zone 'America/Los_Angeles'`);
    expect((await verifyAuditChain(t.db)).intact).toBe(true);
    await t.db.execute(sql`reset time zone`);
  });

  it("e' atomico: se il caso d'uso fallisce non resta nessuna riga di audit", async () => {
    const before = (await rows(t)).length;
    await expect(
      runInUnitOfWork(t.db, owner, async ({ audit }) => {
        await audit.record({ action: "test.rollback", entityType: "test", entityId: "r" });
        throw new Error("errore di dominio");
      }),
    ).rejects.toThrow("errore di dominio");
    expect((await rows(t)).length).toBe(before);
    expect((await verifyAuditChain(t.db)).intact).toBe(true);
  });

  it("scritture concorrenti restano in una catena integra e senza buchi", async () => {
    const before = (await rows(t)).length;
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        runInUnitOfWork(t.db, owner, async ({ audit }) => {
          await audit.record({ action: "test.concurrent", entityType: "test", entityId: `c${i}` });
        }),
      ),
    );
    const all = await rows(t);
    expect(all.length).toBe(before + 12);
    expect(all.map((r) => r.seq)).toEqual(all.map((_, i) => i + 1));
    expect((await verifyAuditChain(t.db)).intact).toBe(true);
  });
});

describe("audit_log: rilevamento di manomissioni", () => {
  async function seeded(): Promise<TestDb> {
    const t = await createTestDb();
    for (const n of [1, 2, 3, 4]) {
      await runInUnitOfWork(t.db, owner, async ({ audit }) => {
        await audit.record({ action: "test.create", entityType: "test", entityId: `e${n}`, diff: { n } });
      });
    }
    return t;
  }

  it("rileva la modifica di un campo anche con i trigger disattivati", async () => {
    const t = await seeded();
    try {
      await t.db.execute(sql`alter table audit_log disable trigger audit_log_no_update_delete`);
      await t.db.execute(sql`update audit_log set diff = '{"n": 999}'::jsonb where seq = 2`);
      expect(await verifyAuditChain(t.db)).toEqual({ intact: false, firstBrokenSeq: 2 });
    } finally {
      await t.close();
    }
  });

  it("rileva una riga rimossa nel mezzo", async () => {
    const t = await seeded();
    try {
      await t.db.execute(sql`alter table audit_log disable trigger audit_log_no_update_delete`);
      await t.db.execute(sql`delete from audit_log where seq = 2`);
      expect(await verifyAuditChain(t.db)).toEqual({ intact: false, firstBrokenSeq: 3 });
    } finally {
      await t.close();
    }
  });

  it("rileva la rimozione delle prime righe", async () => {
    const t = await seeded();
    try {
      await t.db.execute(sql`alter table audit_log disable trigger audit_log_no_update_delete`);
      await t.db.execute(sql`delete from audit_log where seq = 1`);
      expect(await verifyAuditChain(t.db)).toEqual({ intact: false, firstBrokenSeq: 2 });
    } finally {
      await t.close();
    }
  });

  it("NON rileva la rimozione dell'ultima riga senza una copia esterna dell'hash di testa (limite noto)", async () => {
    const t = await seeded();
    try {
      const head = (await verifyAuditChain(t.db)) as { intact: true; headHash: string };
      await t.db.execute(sql`alter table audit_log disable trigger audit_log_no_update_delete`);
      await t.db.execute(sql`delete from audit_log where seq = 4`);
      const after = await verifyAuditChain(t.db);
      expect(after.intact).toBe(true);
      // Confrontando con l'hash di testa conservato altrove (backup/UI) la differenza emerge.
      expect((after as { headHash: string }).headHash).not.toBe(head.headHash);
    } finally {
      await t.close();
    }
  });
});

describe("audit_log: lettura per il visualizzatore", () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await createTestDb();
    const events = [
      { action: "asset.create", entityId: "a1" },
      { action: "asset.update", entityId: "a1" },
      { action: "document.create", entityId: "d1" },
      { action: "a_b.one", entityId: "x1" },
      { action: "axb.two", entityId: "x2" },
    ];
    for (const e of events) {
      await runInUnitOfWork(t.db, owner, async ({ audit }) => {
        await audit.record({ action: e.action, entityType: e.action.split(".")[0]!, entityId: e.entityId, diff: { count: 1 } });
      });
    }
  });
  afterAll(async () => {
    await t.close();
  });

  it("elenca dalla riga piu' recente, con paginazione e totale", async () => {
    const page1 = await listAuditEntries(t.db, { limit: 2, offset: 0 });
    expect(page1.total).toBe(5);
    expect(page1.rows.map((r) => r.action)).toEqual(["axb.two", "a_b.one"]);
    expect(page1.rows[0]).toMatchObject({ seq: 5, actorType: "owner", entityId: "x2", diff: { count: 1 } });
    expect(page1.rows[0]!.at).toBeInstanceOf(Date);
    const page3 = await listAuditEntries(t.db, { limit: 2, offset: 4 });
    expect(page3.rows.map((r) => r.action)).toEqual(["asset.create"]);
  });

  it("filtra per area (la parte prima del punto) e i caratteri speciali di LIKE valgono alla lettera", async () => {
    expect((await listAuditEntries(t.db, { area: "asset", limit: 10, offset: 0 })).rows.map((r) => r.action)).toEqual(["asset.update", "asset.create"]);
    expect((await listAuditEntries(t.db, { area: "a_b", limit: 10, offset: 0 })).rows.map((r) => r.action)).toEqual(["a_b.one"]);
    expect((await listAuditEntries(t.db, { area: "a%", limit: 10, offset: 0 })).total).toBe(0);
    expect((await listAuditEntries(t.db, { area: "asse", limit: 10, offset: 0 })).total).toBe(0);
  });

  it("elenca le aree presenti, una volta sola e in ordine", async () => {
    expect(await listAuditAreas(t.db)).toEqual(["a_b", "asset", "axb", "document"]);
  });

  it("l'ultima riga coincide con l'impronta di testa della verifica", async () => {
    const head = await auditHead(t.db);
    const verification = await verifyAuditChain(t.db);
    expect(head).toMatchObject({ seq: 5 });
    expect(verification).toMatchObject({ intact: true, rows: 5, headHash: head!.hash });
  });

  it("un registro vuoto non ha righe, aree ne' testa", async () => {
    const empty = await createTestDb();
    try {
      expect(await listAuditEntries(empty.db, { limit: 10, offset: 0 })).toEqual({ rows: [], total: 0 });
      expect(await listAuditAreas(empty.db)).toEqual([]);
      expect(await auditHead(empty.db)).toBeNull();
    } finally {
      await empty.close();
    }
  });
});
