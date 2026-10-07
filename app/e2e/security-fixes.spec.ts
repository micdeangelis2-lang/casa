import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_DATABASE_URL, E2E_ORIGIN, clientIp } from "./support/env";
import { STORAGE_STATE, loadSecrets } from "./support/secrets";
import { addVirtualAuthenticator, importCredentials } from "./support/webauthn";

// Correzioni della revisione di sicurezza (docs/SECURITY_REVIEW.md): F-03 (rotte dirette chiuse + tetto ai tentativi) e F-05
// (Sec-Fetch-Site). Non cambia credenziali condivise: l'unico dato scritto e' il contatore dei tentativi, che si azzera.
test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(350) } });
test.describe.configure({ mode: "serial" });

async function clearAttempts(): Promise<void> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    await client.query("delete from rate_limit where key like 'owner-password-actions|%'");
  } finally {
    await client.end();
  }
}

test.afterAll(clearAttempts);

test.describe("F-03: rotte dirette di Better Auth", () => {
  test("change-password e generate-backup-codes rispondono 403 anche con la sessione del proprietario", async ({ request }) => {
    const headers = { origin: E2E_ORIGIN };
    const change = await request.post("/api/auth/change-password", {
      headers,
      data: { currentPassword: "Password-Sbagliata-123", newPassword: "Un-Altra-Password-Lunga-1" },
    });
    expect(change.status()).toBe(403);
    const codes = await request.post("/api/auth/two-factor/generate-backup-codes", { headers, data: { password: "Password-Sbagliata-123" } });
    expect(codes.status()).toBe(403);
  });
});

test.describe("F-03: tetto ai tentativi di password nelle azioni della pagina", () => {
  test("dopo 5 password sbagliate la sesta richiesta riceve l'errore di troppi tentativi", async ({ page }) => {
    await clearAttempts();
    await page.goto("/impostazioni/sicurezza");
    const recovery = page.getByRole("heading", { level: 2, name: "Codici di recupero", exact: true }).locator("xpath=ancestor::*[@data-slot='card'][1]");
    for (let i = 0; i < 5; i++) {
      await recovery.getByLabel("Password attuale").fill("Password-Sbagliata-123");
      await recovery.getByRole("button", { name: "Rigenera i codici" }).click();
      await expect(recovery.getByRole("alert")).toContainText("La password attuale non è corretta.");
    }
    await recovery.getByLabel("Password attuale").fill("Password-Sbagliata-123");
    await recovery.getByRole("button", { name: "Rigenera i codici" }).click();
    await expect(recovery.getByRole("alert")).toContainText("Troppi tentativi con la password");
    await expect(page.getByTestId("new-recovery-codes")).toHaveCount(0);
  });
});

test.describe("F-05: Sec-Fetch-Site sulle route di scarico", () => {
  test("cross-site e same-site: 403 (anche per l'esportazione completa); same-origin, none e senza intestazione: ammessi", async ({ request }) => {
    for (const path of ["/api/esportazione", "/api/calendario", "/api/economia?anno=2026"]) {
      for (const site of ["cross-site", "same-site"]) {
        const denied = await request.get(path, { headers: { "sec-fetch-site": site } });
        expect(denied.status(), `${path} ${site}`).toBe(403);
      }
    }
    for (const site of ["same-origin", "none"]) {
      const allowed = await request.get("/api/calendario", { headers: { "sec-fetch-site": site } });
      expect(allowed.status(), site).toBe(200);
    }
    expect((await request.get("/api/calendario")).status()).toBe(200);
  });

  test("senza sessione resta 401 (nessuna intestazione) e 403 con cross-site", async ({ playwright }) => {
    const anonymous = await playwright.request.newContext({ baseURL: E2E_ORIGIN, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { "x-real-ip": clientIp(350) } });
    try {
      expect((await anonymous.get("/api/esportazione")).status()).toBe(401);
      expect((await anonymous.get("/api/esportazione", { headers: { "sec-fetch-site": "cross-site" } })).status()).toBe(403);
    } finally {
      await anonymous.dispose();
    }
  });
});

test.describe("F-01: verifica dell'utente (UV) imposta dal server", () => {
  test.use({ storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { "x-real-ip": clientIp(351) } });

  test("un autenticatore che non verifica l'utente non entra con la passkey; con la verifica entra", async ({ page, context }) => {
    const authenticator = await addVirtualAuthenticator(context, page);
    await importCredentials(authenticator, loadSecrets().credentials);
    await authenticator.cdp.send("WebAuthn.setUserVerified", { authenticatorId: authenticator.authenticatorId, isUserVerified: false });

    await page.goto("/accesso");
    await page.getByRole("button", { name: "Accedi con passkey" }).click();
    await expect(page.locator('[data-slot="alert"]')).toContainText("Accesso con passkey non riuscito");
    await expect(page).toHaveURL(/\/accesso$/);

    // Con la verifica attiva (come i dispositivi reali con biometria o PIN) lo stesso accesso riesce.
    await authenticator.cdp.send("WebAuthn.setUserVerified", { authenticatorId: authenticator.authenticatorId, isUserVerified: true });
    // Il clic si ritenta: in headless la compilazione automatica della pagina puo' contendersi con il clic l'unico autenticatore
    // virtuale e far perdere un tentativo (un utente reale riprova allo stesso modo).
    await expect(async () => {
      if (!/\/accesso$/.test(page.url())) return;
      await page.getByRole("button", { name: "Accedi con passkey" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Panoramica" })).toBeVisible({ timeout: 6000 });
    }).toPass({ timeout: 30_000 });
  });
});
