import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { account, party, passkey, session, twoFactor, user } from "@/platform/db/schema";
import { createTestDb, type TestDb } from "./helpers/test-db";

describe("un solo proprietario (indice user_single_owner)", () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  it("accetta il primo utente", async () => {
    await t.db.insert(user).values({ id: "u1", name: "Proprietario", email: "uno@example.test" });
    const rows = await t.db.select().from(user);
    expect(rows).toHaveLength(1);
  });

  it("rifiuta un secondo utente, anche con email e id diversi", async () => {
    const attempt = t.db.insert(user).values({ id: "u2", name: "Intruso", email: "due@example.test" });
    const error = await attempt.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    const chain: string[] = [];
    for (let e: unknown = error; e instanceof Error; e = e.cause) chain.push(`${e.message} ${(e as { code?: string }).code ?? ""}`);
    expect(chain.join(" | ")).toMatch(/user_single_owner|23505|unique/i);
    expect((await t.db.select().from(user)).length).toBe(1);
  });

  it("il vincolo resiste anche a un tentativo con SQL diretto", async () => {
    await expect(
      t.db.execute(sql`insert into "user" (id, name, email) values ('u3', 'Altro', 'tre@example.test')`),
    ).rejects.toBeTruthy();
  });
});

describe("ultima risorsa se si perde ogni accesso (docs/RUNBOOK.md)", () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  it("togliere l'utente porta via tutto l'accesso ma lascia i dati, e rende di nuovo possibile la configurazione iniziale", async () => {
    await t.db.insert(user).values({ id: "u1", name: "Proprietario", email: "uno@example.test" });
    await t.db.insert(account).values({ id: "a1", accountId: "u1", providerId: "credential", userId: "u1", password: "hash", updatedAt: new Date() });
    await t.db.insert(session).values({ id: "s1", token: "t1", userId: "u1", expiresAt: new Date(Date.now() + 60_000), updatedAt: new Date() });
    await t.db.insert(passkey).values({ id: "p1", publicKey: "k", userId: "u1", credentialID: "c1", counter: 0, deviceType: "singleDevice", backedUp: false });
    await t.db.insert(twoFactor).values({ id: "f1", secret: "s", backupCodes: "b", userId: "u1" });
    await t.db.insert(party).values({ displayName: "Dato di prova" });

    await t.db.execute(sql`delete from "user"`);

    for (const table of [user, account, session, passkey, twoFactor]) expect(await t.db.select().from(table)).toEqual([]);
    expect(await t.db.select().from(party)).toHaveLength(1);
    // Con nessun utente il controllo della configurazione iniziale (`count(*) from user = 0`) lascia passare di nuovo, e l'indice
    // `user_single_owner` accetta un nuovo proprietario.
    await t.db.insert(user).values({ id: "u2", name: "Nuovo proprietario", email: "nuovo@example.test" });
    expect(await t.db.select().from(user)).toHaveLength(1);
  });
});
