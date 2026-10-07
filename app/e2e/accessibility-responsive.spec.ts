import { expect, test } from "@playwright/test";
import { a11yViolations } from "./support/a11y";
import { clientIp } from "./support/env";
import { PAGES } from "./support/pages";
import { STORAGE_STATE } from "./support/secrets";

// Audit di accessibilita' (WCAG 2.x A/AA con le regole di dimensione dei bersagli) e di adattamento a schermo stretto su
// OGNI schermata dell'app, con elenchi vuoti. Le schermate con dati sono verificate dai file dei singoli moduli.
test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(160) } });
test.setTimeout(180_000);

const noHorizontalOverflow = async (page: import("@playwright/test").Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

test.describe("accessibilita' di tutte le schermate", () => {
  test("schermo largo: nessuna violazione WCAG 2.x A/AA", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const problems: string[] = [];
    for (const path of PAGES) {
      await page.goto(path);
      await expect(page.locator("main").first(), path).toBeVisible();
      const violations = await a11yViolations(page);
      if (violations.length > 0) problems.push(`${path}\n  ${violations.join("\n  ")}`);
    }
    expect(problems).toEqual([]);
  });

  test("telefono (390 px): nessuna violazione WCAG e nessuno scorrimento orizzontale", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const problems: string[] = [];
    for (const path of PAGES) {
      await page.goto(path);
      await expect(page.locator("main").first(), path).toBeVisible();
      const violations = await a11yViolations(page);
      if (violations.length > 0) problems.push(`${path}\n  ${violations.join("\n  ")}`);
      if (!(await noHorizontalOverflow(page))) problems.push(`${path}: scorrimento orizzontale a 390 px`);
    }
    expect(problems).toEqual([]);
  });

  test("da tastiera: il collegamento «Vai al contenuto» e' il primo elemento raggiungibile e porta al contenuto principale", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Vai al contenuto" });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main$/);
  });
});
