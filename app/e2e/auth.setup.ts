import { expect, test as setup } from "@playwright/test";
import { a11yViolations } from "./support/a11y";
import { E2E_BOOTSTRAP_TOKEN, OWNER, clientIp } from "./support/env";
import { STORAGE_STATE, saveSecrets } from "./support/secrets";
import { totp } from "./support/totp";
import { addVirtualAuthenticator, exportCredentials } from "./support/webauthn";

setup.use({ extraHTTPHeaders: { "x-real-ip": clientIp(10) } });

setup("configurazione iniziale: crea il proprietario con TOTP e passkey", async ({ page, context }) => {
  const authenticator = await addVirtualAuthenticator(context, page);

  // Senza proprietario, qualsiasi pagina riporta alla configurazione iniziale.
  await page.goto("/");
  await expect(page).toHaveURL(/\/configurazione-iniziale$/);
  await expect(page.getByRole("heading", { level: 1, name: "Configurazione iniziale" })).toBeVisible();

  expect(await a11yViolations(page)).toEqual([]);

  // Token sbagliato: nessun account.
  await page.getByLabel("Nome").fill(OWNER.name);
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password", { exact: true }).fill(OWNER.password);
  await page.getByLabel("Token di avvio").fill("token-sbagliato-token-sbagliato-token-sbagliato");
  await page.getByRole("button", { name: "Crea account" }).click();
  await expect(page.locator('[data-slot="alert"]')).toContainText("Token di avvio non valido");
  await expect(page).toHaveURL(/\/configurazione-iniziale$/);

  // Password troppo corta: errore sul campo, nessun account.
  await page.getByLabel("Password", { exact: true }).fill("corta");
  await page.getByLabel("Token di avvio").fill(E2E_BOOTSTRAP_TOKEN);
  await page.getByRole("button", { name: "Crea account" }).click();
  await expect(page.getByText("La password deve avere almeno 12 caratteri")).toBeVisible();

  // Dati corretti.
  await page.getByLabel("Password", { exact: true }).fill(OWNER.password);
  await page.getByLabel("Token di avvio").fill(E2E_BOOTSTRAP_TOKEN);
  await page.getByRole("button", { name: "Crea account" }).click();
  await expect(page).toHaveURL(/\/sicurezza\/configurazione$/);

  // Finche' la sicurezza non e' completa l'app non e' accessibile.
  await page.goto("/");
  await expect(page).toHaveURL(/\/sicurezza\/configurazione$/);

  // 1. TOTP: la password va riconfermata.
  await page.getByLabel("La tua password").fill(OWNER.password);
  await page.getByRole("button", { name: "Genera il QR" }).click();

  await expect(page.getByRole("img", { name: "QR code per l’app di autenticazione" })).toBeVisible();
  const backupCodes = await page.getByTestId("backup-codes").getByRole("listitem").allTextContents();
  expect(backupCodes).toHaveLength(10);
  const manualKey = (await page.locator("code").first().textContent())?.trim();
  expect(manualKey).toMatch(/^[A-Z2-7]{16,}$/);

  // Senza conferma di aver salvato i codici non si puo' attivare.
  const activate = page.getByRole("button", { name: "Attiva" });
  await expect(activate).toBeDisabled();
  await page.getByLabel("Ho salvato i codici di recupero").check();
  await expect(activate).toBeEnabled();

  expect(await a11yViolations(page)).toEqual([]);

  // Un codice sbagliato non attiva nulla.
  await page.getByLabel("Codice a 6 cifre").fill("000000");
  await activate.click();
  await expect(page.locator('[data-slot="alert"]')).toContainText("Operazione non riuscita");

  await page.getByLabel("Codice a 6 cifre").fill(totp(manualKey!));
  await activate.click();
  await expect(page.getByText("App di autenticazione attiva.")).toBeVisible();

  // 2. Passkey (autenticatore virtuale).
  await page.getByLabel("Nome della passkey").fill("telefono di prova");
  await page.getByRole("button", { name: "Aggiungi passkey" }).click();
  await expect(page.getByTestId("passkey-list")).toContainText("telefono di prova");

  await expect(page.getByRole("heading", { name: "Configurazione completata" })).toBeVisible();
  await page.getByRole("link", { name: "Vai alla panoramica" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1, name: "Panoramica" })).toBeVisible();
  await expect(page.getByTestId("owner-email")).toHaveText(OWNER.email);

  saveSecrets({
    totpSecret: manualKey!,
    backupCodes,
    credentials: await exportCredentials(authenticator),
  });
  await context.storageState({ path: STORAGE_STATE });
});
