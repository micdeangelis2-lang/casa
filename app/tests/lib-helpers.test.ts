import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { count } from "drizzle-orm";
import { auditLog } from "@/platform/db/schema";
import { fail, ok } from "@/shared/result";
import { changedKeys } from "@/shared/changed";
import { formatDate, formatEuro } from "@/lib/format";
import { THEMES, parseTheme } from "@/lib/theme";
import { createTestDb, type TestDb } from "./helpers/test-db";

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  requireOwner: vi.fn(),
  headerValue: null as string | null,
  db: null as unknown,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: (name: string) => (name === "sec-fetch-site" ? mocks.headerValue : null) }) }));
vi.mock("next/server", () => ({ NextResponse: class { constructor(public body: unknown, public init: { status: number; headers: Record<string, string> }) {} } }));
vi.mock("@/platform/auth/owner", () => ({ requireOwner: mocks.requireOwner }));
vi.mock("@/platform/db/client", () => ({ getDb: () => mocks.db }));

describe("formattazione", () => {
  it("date di calendario senza scarto di fuso e importi in centesimi, anche a zero e negativi", () => {
    // Lo zero davanti al mese dipende dalla versione di ICU del runtime: conta il giorno di calendario.
    expect(formatDate("2026-03-15")).toMatch(/^15\/0?3\/2026$/);
    expect(formatDate("2026-12-31")).toBe("31/12/2026");
    expect(formatDate("2024-02-29")).toMatch(/^29\/0?2\/2024$/);
    expect(formatEuro(0)).toBe("0,00");
    expect(formatEuro(123456)).toBe("1.234,56");
    expect(formatEuro(-5)).toBe("-0,05");
  });
});

describe("tema", () => {
  it("accetta solo i valori noti; il resto (anche ostile) ripiega su «system»", () => {
    for (const theme of THEMES) expect(parseTheme(theme)).toBe(theme);
    for (const bad of [undefined, "", "Dark", "dark ", "<script>", "__proto__", "constructor"]) expect(parseTheme(bad)).toBe("system");
  });
});

describe("changedKeys: solo i nomi dei campi cambiati", () => {
  it("nessuna modifica, modifica di un valore, null equivale ad assente, oggetti e array confrontati per contenuto", () => {
    expect(changedKeys({ a: 1, b: "x" }, { a: 1, b: "x" })).toEqual([]);
    expect(changedKeys({ a: 1, b: "x" }, { a: 2, b: "x" })).toEqual(["a"]);
    expect(changedKeys({ a: null as string | null }, { a: undefined as unknown as string | null })).toEqual([]);
    expect(changedKeys({ a: [1, 2], o: { k: 1 } }, { a: [1, 2], o: { k: 1 } })).toEqual([]);
    expect(changedKeys({ a: [1, 2] }, { a: [2, 1] })).toEqual(["a"]);
    expect(changedKeys({ a: 0 }, { a: null as unknown as number })).toEqual(["a"]);
    expect(changedKeys({ a: "" }, { a: "x" })).toEqual(["a"]);
  });

  it("un campo che compare solo dopo e' un campo cambiato; uno che sparisce non e' elencato (si guardano le chiavi nuove)", () => {
    expect(changedKeys<Record<string, unknown>>({}, { nuovo: 1 })).toEqual(["nuovo"]);
    expect(changedKeys<Record<string, unknown>>({ vecchio: 1 }, {})).toEqual([]);
  });
});

describe("ownerAction", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    mocks.db = t.db;
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(() => {
    mocks.revalidatePath.mockReset();
    mocks.requireOwner.mockReset();
  });
  const auditRows = async () => Number((await t.db.select({ n: count() }).from(auditLog))[0]!.n);

  it("senza proprietario non esegue il lavoro ne' ricarica pagine (l'errore di accesso risale)", async () => {
    const { ownerAction, ownerActionWithValue } = await import("@/lib/owner-action");
    mocks.requireOwner.mockRejectedValue(new Error("NEXT_REDIRECT"));
    const work = vi.fn(async () => ok(1));
    await expect(ownerAction(work, ["/a"])).rejects.toThrow("NEXT_REDIRECT");
    await expect(ownerActionWithValue(work, ["/a"])).rejects.toThrow("NEXT_REDIRECT");
    expect(work).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("esito positivo: nessun errore, audit scritto nella stessa transazione, ogni percorso ricaricato", async () => {
    const { ownerAction } = await import("@/lib/owner-action");
    mocks.requireOwner.mockResolvedValue({ userId: "u1", name: "N", email: "e@example.test", sessionId: "s1" });
    const before = await auditRows();
    const result = await ownerAction(async (uow) => {
      await uow.audit.record({ action: "test.action", entityType: "test", entityId: "e1", diff: {} });
      return ok(true);
    }, ["/a", "/b"]);
    expect(result).toEqual({});
    expect(await auditRows()).toBe(before + 1);
    expect(mocks.revalidatePath.mock.calls.map((c) => c[0])).toEqual(["/a", "/b"]);
  });

  it("esito negativo: restituisce gli errori; se il lavoro lancia, la scrittura si annulla e nulla si ricarica", async () => {
    const { ownerAction, ownerActionWithValue } = await import("@/lib/owner-action");
    mocks.requireOwner.mockResolvedValue({ userId: "u1", name: "N", email: "e@example.test", sessionId: "s1" });
    expect(await ownerAction(async () => fail({ nome: ["Obbligatorio"] }), [])).toEqual({ errors: { nome: ["Obbligatorio"] } });
    expect(await ownerActionWithValue(async () => ok({ id: "x" }), ["/c"])).toEqual({ ok: true, value: { id: "x" } });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/c");

    mocks.revalidatePath.mockReset();
    const before = await auditRows();
    await expect(
      ownerAction(async (uow) => {
        await uow.audit.record({ action: "test.rollback", entityType: "test", entityId: "e2", diff: {} });
        throw new Error("boom");
      }, ["/d"]),
    ).rejects.toThrow("boom");
    expect(await auditRows()).toBe(before);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("rejectCrossSite", () => {
  it("risponde 403 senza cache a una richiesta cross-site e lascia passare le altre", async () => {
    const { rejectCrossSite } = await import("@/platform/auth/request-guard");
    mocks.headerValue = "cross-site";
    const res = (await rejectCrossSite()) as unknown as { body: unknown; init: { status: number; headers: Record<string, string> } };
    expect(res.init.status).toBe(403);
    expect(res.init.headers["Cache-Control"]).toBe("private, no-store");
    expect(res.body).toBeNull();
    for (const ok of [null, "same-origin", "none", " NONE "]) {
      mocks.headerValue = ok;
      expect(await rejectCrossSite()).toBeNull();
    }
  });
});
