import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { count } from "drizzle-orm";
import { auditLog, notification } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { todayInItaly } from "@/platform/clock";
import { createDeadline } from "@/modules/deadlines";
import { runDailyJob } from "@/lib/daily-job";
import { createTestDb, type TestDb } from "./helpers/test-db";

vi.mock("@/platform/config/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/platform/config/env")>()),
  getAuthEnv: () => ({ BETTER_AUTH_URL: "http://localhost:3000", BETTER_AUTH_SECRET: "x".repeat(32) }),
  getMailEnv: () => ({}),
}));

const actor = { type: "system", id: "cron" } as const;

describe("giro giornaliero (lib/daily-job)", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  const rows = async (table: typeof auditLog | typeof notification) => Number((await t.db.select({ n: count() }).from(table))[0]!.n);

  it("su un database vuoto non fa nulla e non fallisce", async () => {
    expect(await runDailyJob(t.db, actor)).toEqual({ occurrences: 0, notifications: 0, emails: 0, emailErrors: 0, evaluated: 0 });
  });

  it("crea l'avviso dovuto oggi una volta sola, senza servizio email, anche se il giro parte due volte", async () => {
    const today = todayInItaly();
    const created = await runInUnitOfWork(t.db, { type: "owner", id: "o1" }, (uow) =>
      createDeadline(uow, { title: "Scade oggi", category: "fiscal", level: "national", calc: { type: "manual" }, firstDueOn: today, leadDays: [0] }, today),
    );
    expect(created.ok).toBe(true);

    const first = await runDailyJob(t.db, actor);
    expect(first.notifications).toBe(1);
    expect(first.emails).toBe(0);
    expect(first.emailErrors).toBe(0);
    const afterFirst = await rows(notification);

    const second = await runDailyJob(t.db, actor);
    expect(second.notifications).toBe(0);
    expect(await rows(notification)).toBe(afterFirst);
    expect(await rows(auditLog)).toBeGreaterThan(0);
  });
});
