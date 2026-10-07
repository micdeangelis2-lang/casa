import { expect, test } from "@playwright/test";
import { a11yViolations } from "./support/a11y";
import { clientIp } from "./support/env";
import { STORAGE_STATE } from "./support/secrets";

test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(180) } });

test.describe("pagine «non trovato»", () => {
  test("un elemento inesistente dentro l'app resta nella cornice dell'app, con stato 404 e in italiano", async ({ page }) => {
    const response = await page.goto("/immobili/00000000-0000-4000-8000-000000000000");
    expect(response?.status()).toBe(404);
    await expect(page.getByTestId("not-found")).toContainText("Pagina non trovata");
    await expect(page.getByRole("link", { name: "Immobili", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Torna alla panoramica" }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("un indirizzo sconosciuto mostra la stessa pagina, accessibile", async ({ page }) => {
    const response = await page.goto("/questa-pagina-non-esiste");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "Pagina non trovata" })).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);
  });
});

test.describe("pagine «non trovato» senza sessione", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("un indirizzo sconosciuto non rivela nulla dell'app", async ({ page }) => {
    const response = await page.goto("/questa-pagina-non-esiste");
    expect(response?.status()).toBe(404);
    await expect(page.getByTestId("not-found")).toBeVisible();
    await expect(page.getByRole("link", { name: "Immobili", exact: true })).toHaveCount(0);
  });
});
