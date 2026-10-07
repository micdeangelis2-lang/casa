import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { canRemovePasskey, describeUserAgent, maskIpAddress } from "@/shared/account-security";
import {
  listActiveSessions,
  listPasskeys,
  removePasskey,
  renamePasskey,
  revokeOtherSessions,
  revokeSession,
} from "@/platform/auth/account-security";
import { passkey, session, user } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { createTestDb, type TestDb } from "./helpers/test-db";

describe("regole pure della pagina di sicurezza", () => {
  it("l'ultima passkey non si puo' rimuovere", () => {
    expect(canRemovePasskey(0)).toBe(false);
    expect(canRemovePasskey(1)).toBe(false);
    expect(canRemovePasskey(2)).toBe(true);
  });

  it("descrive browser e sistema in modo sintetico", () => {
    const chromeWin = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
    const edgeWin = `${chromeWin} Edg/130.0.0.0`;
    const firefoxLinux = "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0";
    const safariMac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
    const safariIphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
    const chromeAndroid = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
    expect(describeUserAgent(chromeWin)).toEqual({ browser: "Chrome", os: "Windows" });
    expect(describeUserAgent(edgeWin)).toEqual({ browser: "Edge", os: "Windows" });
    expect(describeUserAgent(firefoxLinux)).toEqual({ browser: "Firefox", os: "Linux" });
    expect(describeUserAgent(safariMac)).toEqual({ browser: "Safari", os: "macOS" });
    expect(describeUserAgent(safariIphone)).toEqual({ browser: "Safari", os: "iOS" });
    expect(describeUserAgent(chromeAndroid)).toEqual({ browser: "Chrome", os: "Android" });
    expect(describeUserAgent("curl/8.0")).toEqual({ browser: null, os: null });
    expect(describeUserAgent(null)).toEqual({ browser: null, os: null });
  });

  it("maschera l'ultima parte dell'indirizzo IP", () => {
    expect(maskIpAddress("198.51.100.254")).toBe("198.51.100.x");
    expect(maskIpAddress("2001:db8:1:2:3:4:5:6")).toBe("2001:db8:1:2:…");
    expect(maskIpAddress("2001:db8::1")).toBe("2001:db8:0:0:…");
    expect(maskIpAddress("::1")).toBe("0:0:0:0:…");
    expect(maskIpAddress("::ffff:203.0.113.77")).toBe("203.0.113.x");
    expect(maskIpAddress("")).toBeNull();
    expect(maskIpAddress(null)).toBeNull();
    expect(maskIpAddress("non-un-ip")).toBeNull();
    // Mai l'indirizzo intero.
    expect(maskIpAddress("198.51.100.254")).not.toContain("254");
  });
});

describe("passkey e sessioni del proprietario", () => {
  let t: TestDb;
  const actor = { type: "owner", id: "u1" } as const;
  const uow = <T>(work: Parameters<typeof runInUnitOfWork<T>>[2]) => runInUnitOfWork(t.db, actor, work);
  const auditRows = async () =>
    (await t.db.execute(sql`select action, entity_type, entity_id, diff::text as diff from audit_log order by seq`)) as unknown as {
      rows: { action: string; entity_type: string; entity_id: string; diff: string }[];
    };

  beforeAll(async () => {
    t = await createTestDb();
    await t.db.insert(user).values({ id: "u1", name: "Proprietario", email: "uno@example.test" });
    const base = { userId: "u1", publicKey: "pk", counter: 0, deviceType: "multiDevice", backedUp: true };
    await t.db.insert(passkey).values([
      { id: "p1", credentialID: "c1", name: "telefono", ...base, createdAt: new Date("2026-01-01T10:00:00Z") },
      { id: "p2", credentialID: "c2", name: null, ...base, createdAt: new Date("2026-02-01T10:00:00Z") },
    ]);
    const future = new Date(Date.now() + 3_600_000);
    const sess = { userId: "u1", expiresAt: future, ipAddress: "198.51.100.7", userAgent: "x" };
    await t.db.insert(session).values([
      { id: "s1", token: "t1", ...sess },
      { id: "s2", token: "t2", ...sess },
      { id: "s3", token: "t3", ...sess },
      { id: "sx", token: "tx", ...sess, expiresAt: new Date(Date.now() - 1000) },
    ]);
  });
  afterAll(async () => {
    await t.close();
  });

  it("elenca le passkey e solo le sessioni non scadute, senza il token", async () => {
    expect((await listPasskeys(t.db, "u1")).map((p) => p.id)).toEqual(["p1", "p2"]);
    const sessions = await listActiveSessions(t.db, "u1");
    expect(sessions.map((s) => s.id).sort()).toEqual(["s1", "s2", "s3"]);
    expect(Object.keys(sessions[0]!)).not.toContain("token");
  });

  it("rinomina una passkey e registra solo il nome dell'azione, mai il nome scelto", async () => {
    expect(await uow((u) => renamePasskey(u, "u1", "p2", "  tablet segreto  "))).toEqual({ ok: true });
    expect((await listPasskeys(t.db, "u1")).find((p) => p.id === "p2")?.name).toBe("tablet segreto");
    expect(await uow((u) => renamePasskey(u, "u1", "p2", "   "))).toEqual({ ok: false, error: "invalidName" });
    expect(await uow((u) => renamePasskey(u, "u1", "inesistente", "x"))).toEqual({ ok: false, error: "notFound" });
    expect(await uow((u) => renamePasskey(u, "altro-utente", "p2", "x"))).toEqual({ ok: false, error: "notFound" });
    const rows = (await auditRows()).rows;
    expect(rows).toEqual([{ action: "owner.passkey.rename", entity_type: "passkey", entity_id: "p2", diff: "{}" }]);
    expect(JSON.stringify(rows)).not.toContain("segreto");
  });

  it("rimuove una passkey ma non l'ultima (invariante E6, applicata sul server)", async () => {
    expect(await uow((u) => removePasskey(u, "altro-utente", "p1"))).toEqual({ ok: false, error: "notFound" });
    expect(await uow((u) => removePasskey(u, "u1", "p1"))).toEqual({ ok: true });
    expect(await uow((u) => removePasskey(u, "u1", "p2"))).toEqual({ ok: false, error: "lastPasskey" });
    expect((await listPasskeys(t.db, "u1")).map((p) => p.id)).toEqual(["p2"]);
    const actions = (await auditRows()).rows.map((r) => r.action);
    expect(actions.filter((a) => a === "owner.passkey.remove")).toHaveLength(1);
  });

  it("due rimozioni in parallelo non lasciano il proprietario senza passkey", async () => {
    const base = { userId: "u1", publicKey: "pk", counter: 0, deviceType: "singleDevice", backedUp: false };
    await t.db.insert(passkey).values({ id: "p3", credentialID: "c3", name: "terza", ...base });
    const results = await Promise.all([uow((u) => removePasskey(u, "u1", "p2")), uow((u) => removePasskey(u, "u1", "p3"))]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await listPasskeys(t.db, "u1")).toHaveLength(1);
  });

  it("revoca una sessione, ma non quella in uso", async () => {
    expect(await uow((u) => revokeSession(u, "u1", "s1", "s1"))).toEqual({ ok: false, error: "currentSession" });
    expect(await uow((u) => revokeSession(u, "u1", "s1", "nessuna"))).toEqual({ ok: false, error: "notFound" });
    expect(await uow((u) => revokeSession(u, "altro-utente", "s1", "s2"))).toEqual({ ok: false, error: "notFound" });
    expect(await uow((u) => revokeSession(u, "u1", "s1", "s2"))).toEqual({ ok: true });
    expect((await listActiveSessions(t.db, "u1")).map((s) => s.id).sort()).toEqual(["s1", "s3"]);
  });

  it("«Esci dagli altri dispositivi» lascia solo la sessione in uso (anche quelle scadute vengono tolte) e registra il conteggio", async () => {
    expect(await uow((u) => revokeOtherSessions(u, "u1", "s1"))).toEqual({ ok: true, revoked: 2 });
    expect((await listActiveSessions(t.db, "u1")).map((s) => s.id)).toEqual(["s1"]);
    const last = (await auditRows()).rows.at(-1)!;
    expect(last).toMatchObject({ action: "owner.sessions.revoke_others", diff: '{"revoked": 2}' });
  });
});
