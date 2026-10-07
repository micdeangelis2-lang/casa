import { expect, test } from "@playwright/test";
import { Client } from "./support/pg-client";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, OWNER, clientIp } from "./support/env";
import { STORAGE_STATE, loadSecrets } from "./support/secrets";
import { totp } from "./support/totp";
import { addVirtualAuthenticator, importCredentials } from "./support/webauthn";

// F-04: riconferma recente. Qui NON si usa l'helper `reconfirm()`: si prova il rifiuto senza riconferma e la riconferma vera
// dall'interfaccia (password + codice, passkey), il ritorno alla pagina di partenza e l'anti open redirect.
// Indirizzi x-real-ip: 355-359 (questo file usa il 355).
test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(355) } });
test.describe.configure({ mode: "serial" });

const ZERO_UUID = "00000000-0000-4000-8000-000000000000";
const NAVIGATION = { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", "sec-fetch-site": "same-origin" };

async function db<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

const clearAttempts = () => db((client) => client.query("delete from rate_limit where key like 'owner-password-actions|%'"));

test.afterAll(clearAttempts);

async function reconfirmWithPassword(page: import("@playwright/test").Page, password: string = OWNER.password, code: string = totp(loadSecrets().totpSecret)) {
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Codice a 6 cifre dell'app di autenticazione").fill(code);
  await page.getByRole("button", { name: "Conferma con password e codice" }).click();
}

test.describe("senza riconferma", () => {
  test("le route di scarico rispondono 403 JSON a chi non naviga e reindirizzano chi naviga", async ({ page }) => {
    for (const path of ["/api/esportazione", `/api/backup/${ZERO_UUID}`, `/api/condivisione/${ZERO_UUID}`]) {
      const plain = await page.request.get(path);
      expect(plain.status(), path).toBe(403);
      expect(plain.headers()["content-type"]).toContain("application/json");
      expect(await plain.json()).toEqual({ error: "reconfirm_required", reconfirm: `/riconferma?ritorno=${encodeURIComponent(path)}` });

      const navigation = await page.request.get(path, { headers: NAVIGATION, maxRedirects: 0 });
      expect(navigation.status(), path).toBe(303);
      expect(navigation.headers()["location"]).toMatch(new RegExp(`/riconferma\\?ritorno=${encodeURIComponent(path).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    }
  });

  test("senza sessione resta 401, non 403", async ({ playwright, baseURL }) => {
    const anonymous = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { "x-real-ip": clientIp(355) } });
    try {
      expect((await anonymous.get("/api/esportazione")).status()).toBe(401);
    } finally {
      await anonymous.dispose();
    }
  });

  test("un cookie di riconferma falso o manomesso non vale", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "gi_reconfirm", value: `v1.${Date.now()}.${"a".repeat(64)}`, url: baseURL!, httpOnly: true }]);
    expect((await page.request.get("/api/esportazione")).status()).toBe(403);
  });

  test("le azioni sensibili della pagina Sicurezza non fanno nulla e mandano alla riconferma", async ({ page }) => {
    await page.goto("/impostazioni/sicurezza");
    const banner = page.getByTestId("reconfirm-banner");
    await expect(banner).toHaveAttribute("data-reconfirmed", "false");
    await expect(banner.getByRole("link", { name: "Riconferma l'accesso" })).toHaveAttribute("href", "/riconferma?ritorno=%2Fimpostazioni%2Fsicurezza");

    const password = page.getByRole("heading", { level: 2, name: "Password", exact: true }).locator("xpath=ancestor::*[@data-slot='card'][1]");
    await password.getByLabel("Password attuale").fill(OWNER.password);
    await password.getByLabel("Nuova password", { exact: true }).fill("Tavolo-Lampada-Bicicletta-7");
    await password.getByLabel("Ripeti la nuova password").fill("Tavolo-Lampada-Bicicletta-7");
    await password.getByRole("button", { name: "Cambia password" }).click();
    await expect(password.getByRole("alert")).toContainText("Serve una riconferma recente");
    // Nessuna password cambiata, nessuna riga di audit.
    const changes = await db((client) => client.query("select 1 from audit_log where action = 'owner.password.change'"));
    expect(changes.rowCount).toBe(0);
  });
});

test.describe("riconferma dall'interfaccia", () => {
  test("pagina accessibile; password sbagliata e codice sbagliato sono rifiutati", async ({ page }) => {
    await clearAttempts();
    await page.goto("/riconferma?ritorno=%2Fimpostazioni%2Fsicurezza");
    await expect(page.getByRole("heading", { level: 1, name: "Riconferma dell'accesso" })).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);

    await reconfirmWithPassword(page, "Password-Sbagliata-123");
    await expect(page.getByTestId("reconfirm-error")).toContainText("La password non è corretta.");
    await reconfirmWithPassword(page, OWNER.password, "000000");
    await expect(page.getByTestId("reconfirm-error")).toContainText("Il codice non è valido.");
    expect((await page.request.get("/api/esportazione")).status()).toBe(403);
  });

  test("password e codice: si torna alla pagina di partenza e gli scarichi si sbloccano", async ({ page }) => {
    await clearAttempts();
    await page.goto("/riconferma?ritorno=%2Fimpostazioni%2Fsicurezza");
    await reconfirmWithPassword(page);
    await expect(page).toHaveURL(/\/impostazioni\/sicurezza$/);
    await expect(page.getByTestId("reconfirm-banner")).toHaveAttribute("data-reconfirmed", "true");

    const response = await page.request.get("/api/esportazione");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("application/zip");

    const cookie = (await page.context().cookies()).find((c) => c.name === "gi_reconfirm");
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Strict" });

    // L'audit registra solo il metodo.
    const rows = await db((client) => client.query<{ diff: unknown }>("select diff from audit_log where action = 'owner.reconfirm'"));
    expect(JSON.stringify(rows.rows)).toContain("password_code");
    expect(JSON.stringify(rows.rows)).not.toContain(OWNER.password);
  });

  test("un ritorno esterno non viene seguito (anti open redirect)", async ({ page, baseURL }) => {
    await clearAttempts();
    for (const evil of ["https://evil.test/", "//evil.test", "/\\evil.test"]) {
      await page.goto(`/riconferma?ritorno=${encodeURIComponent(evil)}`);
      await reconfirmWithPassword(page);
      await expect(page.getByRole("heading", { level: 1, name: "Panoramica" })).toBeVisible();
      expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin);
      expect(new URL(page.url()).pathname).toBe("/");
    }
  });

  test("dal link «Scarica l'esportazione completa» si passa dalla riconferma e il file parte", async ({ page, context }) => {
    await clearAttempts();
    await context.clearCookies({ name: "gi_reconfirm" });
    await page.goto("/impostazioni/backup");
    await page.getByRole("link", { name: "Scarica l'esportazione completa" }).click();
    await expect(page).toHaveURL(/\/riconferma\?ritorno=%2Fapi%2Fesportazione$/);

    const download = page.waitForEvent("download");
    await reconfirmWithPassword(page);
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^gestione-immobili-esportazione-\d{4}-\d{2}-\d{2}\.zip$/);
    await expect(page.getByTestId("reconfirm-status")).toContainText("Riconferma eseguita");
  });

  test("con la passkey: la riconferma vale per la nuova sessione e si torna alla pagina", async ({ page, context }) => {
    const before = await db((client) => client.query<{ id: string }>('select id from "session"'));
    try {
      const authenticator = await addVirtualAuthenticator(context, page);
      const counter = await db(async (client) => Number((await client.query<{ n: number }>("select max(counter) as n from passkey")).rows[0]!.n));
      await importCredentials(
        authenticator,
        loadSecrets().credentials.map((credential) => ({ ...credential, signCount: Math.max(credential.signCount, counter) + 1 })),
      );
      await page.goto("/riconferma?ritorno=%2Fimpostazioni%2Fsicurezza");
      await page.getByRole("button", { name: "Conferma con la passkey" }).click();
      await expect(page).toHaveURL(/\/impostazioni\/sicurezza$/);
      await expect(page.getByTestId("reconfirm-banner")).toHaveAttribute("data-reconfirmed", "true");
      expect((await page.request.get("/api/esportazione")).status()).toBe(200);
    } finally {
      // Si toglie la sessione nata dall'accesso con la passkey e si ripristina il contatore: gli altri file condividono entrambi.
      await db(async (client) => {
        await client.query('delete from "session" where not (id = any($1::text[]))', [before.rows.map((r) => r.id)]);
        for (const credential of loadSecrets().credentials) {
          await client.query("update passkey set counter = $1 where credential_id = $2", [credential.signCount, credential.credentialId]);
        }
      });
    }
  });
});
