import { expect, test } from "@playwright/test";
import { a11yViolations } from "./support/a11y";
import { STORAGE_STATE } from "./support/secrets";
import { clientIp } from "./support/env";

// Stato autenticato prodotto dal setup (proprietario con TOTP e passkey gia' configurati).
test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(30) } });

test.describe("struttura dell'app autenticata (build di produzione)", () => {
  test("carica in italiano, senza violazioni CSP ne' errori in console", async ({ page }) => {
    const problems: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") problems.push(`console: ${msg.text()}`);
    });
    page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));

    const response = await page.goto("/");
    expect(response?.status()).toBe(200);

    await expect(page.locator("html")).toHaveAttribute("lang", "it");
    await expect(page.getByRole("heading", { level: 1, name: "Panoramica" })).toBeVisible();
    await expect(page.getByTestId("dashboard")).toBeVisible();

    // L'interazione dimostra che gli script (con nonce) sono davvero stati eseguiti:
    // senza idratazione la scorciatoia da tastiera non cambierebbe lo stato della sidebar.
    const sidebar = page.locator('[data-slot="sidebar"]').first();
    await expect(sidebar).toHaveAttribute("data-state", "expanded");
    await page.keyboard.press("Control+b");
    await expect(sidebar).toHaveAttribute("data-state", "collapsed");

    expect(problems, problems.join("\n")).toEqual([]);
  });

  test("la CSP ha un nonce diverso a ogni richiesta e gli header di sicurezza sono presenti", async ({
    request,
  }) => {
    const nonceOf = (csp: string | undefined) => /'nonce-([^']+)'/.exec(csp ?? "")?.[1];

    const a = await request.get("/");
    const b = await request.get("/");
    const cspA = a.headers()["content-security-policy"];
    const cspB = b.headers()["content-security-policy"];

    expect(cspA).toContain("default-src 'self'");
    expect(cspA).toContain("frame-ancestors 'none'");
    expect(cspA).not.toContain("'unsafe-eval'");
    expect(cspA).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(nonceOf(cspA)).toBeTruthy();
    expect(nonceOf(cspA)).not.toBe(nonceOf(cspB));

    const h = a.headers();
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["strict-transport-security"]).toContain("max-age=");
    expect(h["x-powered-by"]).toBeUndefined();
  });

  test("tutti i moduli sono costruiti: nessuna voce del menu e' «in arrivo» e ognuna e' un link", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("In arrivo")).toHaveCount(0);
    for (const name of ["Immobili", "Documenti", "Regole", "Scadenze", "Condominio", "Tributi e pagamenti", "Manutenzioni e lavori", "Assicurazioni", "Locazioni e ricettività", "Rubrica", "Pratiche", "Condivisione", "Impostazioni"]) {
      await expect(page.getByRole("link", { name, exact: true }), name).toBeVisible();
    }
    await expect(page.getByRole("link", { name: "Panoramica" })).toHaveAttribute("aria-current", "page");
  });

  test("l'avviso sui limiti dell'assistenza e' visibile", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("non attesta la conformità di un immobile")).toBeVisible();
    await expect(page.getByText("non sostituisce il parere di un professionista")).toBeVisible();
  });

  test("nessuna violazione di accessibilita' automatica (WCAG 2.x A/AA)", async ({ page }) => {
    await page.goto("/");
    expect(await a11yViolations(page)).toEqual([]);
  });
});
