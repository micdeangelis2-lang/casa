import { expect, test } from "@playwright/test";
import { clientIp } from "./support/env";

// Il controllo di salute e' pubblico di proposito (lo interrogano monitoraggio e bilanciatore): niente sessione, niente dati.
test.use({ storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { "x-real-ip": clientIp(240) } });

test.describe("controllo di salute", () => {
  test("risponde senza sessione, con il solo stato e senza metterlo in cache", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/json");
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("accetta anche HEAD, per i controlli che non leggono il corpo", async ({ request }) => {
    const response = await request.head("/api/health");
    expect(response.status()).toBe(200);
  });
});
