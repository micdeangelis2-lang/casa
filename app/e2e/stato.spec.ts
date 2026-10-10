import { expect, test } from "@playwright/test";
import { a11yViolations } from "./support/a11y";
import { E2E_AUTH_SECRET, E2E_BOOTSTRAP_TOKEN, clientIp } from "./support/env";
import { STORAGE_STATE } from "./support/secrets";

test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(385) } });

test.describe("stato dell'installazione", () => {
  test("dalle Impostazioni si apre la diagnosi, accessibile e senza valori segreti", async ({ page }) => {
    await page.goto("/impostazioni");
    await page.getByRole("link", { name: /Stato dell'installazione/ }).click();
    await expect(page).toHaveURL(/\/impostazioni\/stato$/);
    await expect(page.getByRole("heading", { level: 1, name: "Stato dell'installazione" })).toBeVisible();
    await expect(page.getByTestId("status-summary")).toContainText("controlli a posto");
    expect(await page.getByTestId("status-list").getByRole("listitem").count()).toBeGreaterThan(3);
    const text = await page.locator("body").innerText();
    expect(text).not.toContain(E2E_AUTH_SECRET);
    expect(text).not.toContain(E2E_BOOTSTRAP_TOKEN);
    expect(await a11yViolations(page)).toEqual([]);
  });
});

test.describe("stato senza sessione", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("la pagina e' chiusa", async ({ page }) => {
    await page.goto("/impostazioni/stato");
    await expect(page).not.toHaveURL(/\/impostazioni\/stato$/);
  });
});
