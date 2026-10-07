import { afterEach, describe, expect, it, vi } from "vitest";

const execute = vi.fn();
vi.mock("@/platform/db/client", () => ({ getDb: () => ({ execute }) }));

import { GET } from "@/app/api/health/route";

afterEach(() => {
  execute.mockReset();
  vi.useRealTimers();
});

describe("controllo di salute", () => {
  it("risponde 200 quando il database risponde, senza altri dati", async () => {
    execute.mockResolvedValue({ rows: [{ "?column?": 1 }] });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("risponde 503 se il database da' errore, senza rivelarne il motivo", async () => {
    execute.mockRejectedValue(new Error("password authentication failed for user casa at 10.0.0.5"));
    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ status: "error" });
    expect(body).not.toMatch(/password|10\.0\.0\.5|casa/);
  });

  it("risponde 503 se il database non risponde entro il limite, invece di restare appesa", async () => {
    vi.useFakeTimers();
    execute.mockReturnValue(new Promise(() => {}));
    const pending = GET();
    await vi.advanceTimersByTimeAsync(3100);
    const response = await pending;
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "error" });
  });
});
