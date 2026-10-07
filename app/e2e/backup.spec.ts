import { expect, test } from "@playwright/test";
import { a11yViolations } from "./support/a11y";
import { E2E_CRON_SECRET, clientIp } from "./support/env";
import { reconfirm } from "./support/reconfirm";
import { STORAGE_STATE } from "./support/secrets";

test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(60) } });
test.describe.configure({ mode: "serial" });

test.describe("backup ed esportazione", () => {
  test("dalle impostazioni si arriva alla pagina, con la chiave configurata e senza violazioni di accessibilita'", async ({ page }) => {
    await page.goto("/impostazioni");
    await page.getByRole("link", { name: /Backup ed esportazione/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Backup ed esportazione" })).toBeVisible();
    await expect(page.getByTestId("backup-status")).toContainText("Configurata");
    await expect(page.getByText("Nessun backup ancora.")).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("si crea un backup, compare nell'elenco e si scarica cifrato", async ({ page }) => {
    // F-04: lo scarico pretende una riconferma recente (la sessione condivisa e' vecchia).
    await reconfirm(page.context());
    await page.goto("/impostazioni/backup");
    await page.getByRole("button", { name: "Crea un backup" }).click();
    await expect(page.getByText("Backup completato.")).toBeVisible();

    const row = page.getByTestId("backup-list").getByRole("row").nth(1);
    await expect(row).toContainText("Manuale");
    await expect(row).toContainText("Riuscito");
    expect(await a11yViolations(page)).toEqual([]);

    const href = await row.getByRole("link", { name: /Scarica/ }).getAttribute("href");
    expect(href).toMatch(/^\/api\/backup\/[0-9a-f-]{36}$/);
    const response = await page.request.get(href!);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-disposition"]).toMatch(/attachment; filename="backup-\d{8}T\d{9}Z-[0-9a-f]{8}\.gibk"/);
    const body = await response.body();
    // Cifrato: inizia con la firma del formato, non con quella di un file ZIP.
    expect(body.subarray(0, 4).toString()).toBe("GIBK");
    expect(body.length).toBeGreaterThan(200);
    expect(body.toString("latin1")).not.toContain("manifest.json");
  });

  test("l'esportazione completa e' uno ZIP in chiaro", async ({ page }) => {
    await reconfirm(page.context());
    const response = await page.request.get("/api/esportazione");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("application/zip");
    expect(response.headers()["content-disposition"]).toMatch(/attachment; filename="gestione-immobili-esportazione-\d{4}-\d{2}-\d{2}\.zip"/);
    const body = await response.body();
    expect(body.subarray(0, 2).toString()).toBe("PK");
    expect(body.toString("latin1")).toContain("manifest.json");
    // Senza credenziali: niente tabelle dell'account.
    expect(body.toString("latin1")).not.toContain("data/user.ndjson");
  });

  test("senza sessione download, esportazione e pagina sono chiusi", async ({ playwright, baseURL }) => {
    const anonymous = await playwright.request.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
      extraHTTPHeaders: { "x-real-ip": clientIp(61) },
    });
    expect((await anonymous.get("/api/esportazione")).status()).toBe(401);
    expect((await anonymous.get("/api/backup/00000000-0000-4000-8000-000000000000")).status()).toBe(401);
    const page = await anonymous.get("/impostazioni/backup", { maxRedirects: 0 });
    expect(page.status()).toBe(307);
    await anonymous.dispose();
  });

  test("il cron parte solo con il segreto giusto", async ({ playwright, baseURL }) => {
    const anonymous = await playwright.request.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
      extraHTTPHeaders: { "x-real-ip": clientIp(62) },
    });
    expect((await anonymous.get("/api/cron/backup")).status()).toBe(401);
    expect((await anonymous.get("/api/cron/backup", { headers: { authorization: "Bearer sbagliato-sbagliato-sbagliato" } })).status()).toBe(401);
    const ok = await anonymous.get("/api/cron/backup", { headers: { authorization: `Bearer ${E2E_CRON_SECRET}` } });
    expect(ok.status()).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, status: "completed" });
    await anonymous.dispose();
  });

  test("l'elenco mostra anche il backup automatico", async ({ page }) => {
    await page.goto("/impostazioni/backup");
    const rows = page.getByTestId("backup-list").getByRole("row");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(1)).toContainText("Automatico");
  });
});
