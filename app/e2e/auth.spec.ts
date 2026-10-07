import { expect, test } from "@playwright/test";
import { Client } from "./support/pg-client";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, E2E_ORIGIN, OWNER, clientIp } from "./support/env";
import { loadSecrets } from "./support/secrets";
import { totp } from "./support/totp";
import { addVirtualAuthenticator, importCredentials } from "./support/webauthn";

// Tutti i test partono senza sessione (il setup ha gia' creato il proprietario).
test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: "serial" });

async function signInWithPassword(page: import("@playwright/test").Page, password: string = OWNER.password) {
  await page.goto("/accesso");
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Accedi con password" }).click();
}

async function expectDashboard(page: import("@playwright/test").Page) {
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1, name: "Panoramica" })).toBeVisible();
  await expect(page.getByTestId("owner-email")).toHaveText(OWNER.email);
}

test.describe("senza sessione", () => {
  test.use({ extraHTTPHeaders: { "x-real-ip": clientIp(20) } });

  test("la panoramica porta all'accesso e non mostra nulla dell'app", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/accesso$/);
    await expect(page.getByText("Nessun immobile registrato")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name: "Accedi" })).toBeVisible();
  });

  test("la configurazione iniziale non e' piu' raggiungibile dopo il primo account", async ({ page }) => {
    await page.goto("/configurazione-iniziale");
    await expect(page).toHaveURL(/\/accesso$/);
  });

  test("la registrazione pubblica e' chiusa", async ({ request }) => {
    const response = await request.post("/api/auth/sign-up/email", {
      headers: { origin: E2E_ORIGIN },
      data: { name: "Intruso", email: "intruso@example.test", password: "Una-Password-Lunga-123" },
    });
    expect(response.ok()).toBe(false);
    expect(response.status()).toBeLessThan(500);
  });

  test("la pagina di accesso non ha violazioni di accessibilita' automatiche", async ({ page }) => {
    await page.goto("/accesso");
    expect(await a11yViolations(page)).toEqual([]);
  });
});

test.describe("password sbagliata", () => {
  test.use({ extraHTTPHeaders: { "x-real-ip": clientIp(21) } });

  test("mostra un messaggio generico che non rivela se l'account esiste", async ({ page }) => {
    await signInWithPassword(page, "Password-Sbagliata-123");
    await expect(page.locator('[data-slot="alert"]')).toContainText("Credenziali non valide, oppure troppi tentativi");
    await expect(page).toHaveURL(/\/accesso$/);
  });
});

test.describe("accesso con passkey", () => {
  test.use({ extraHTTPHeaders: { "x-real-ip": clientIp(22) } });

  test("una passkey registrata permette di entrare", async ({ page, context }) => {
    const authenticator = await addVirtualAuthenticator(context, page);
    await importCredentials(authenticator, loadSecrets().credentials);

    await page.goto("/accesso");
    await page.getByRole("button", { name: "Accedi con passkey" }).click();
    await expectDashboard(page);
  });

  test("senza la passkey giusta l'accesso fallisce", async ({ page, context }) => {
    await addVirtualAuthenticator(context, page); // autenticatore vuoto: nessuna credenziale
    await page.goto("/accesso");
    await page.getByRole("button", { name: "Accedi con passkey" }).click();
    await expect(page.locator('[data-slot="alert"]')).toContainText("Accesso con passkey non riuscito");
    await expect(page).toHaveURL(/\/accesso$/);
  });
});

test.describe("accesso con password e codice dell'app", () => {
  test.use({ extraHTTPHeaders: { "x-real-ip": clientIp(23) } });

  test("password corretta ma codice sbagliato: niente accesso", async ({ page }) => {
    await signInWithPassword(page);
    await expect(page.getByRole("heading", { level: 1, name: "Codice di verifica" })).toBeVisible();
    await page.getByLabel("Codice a 6 cifre").fill("000000");
    await page.getByRole("button", { name: "Verifica" }).click();
    await expect(page.locator('[data-slot="alert"]')).toContainText("Codice non valido");

    // Nessuna sessione: la panoramica resta protetta.
    await page.goto("/");
    await expect(page).toHaveURL(/\/accesso$/);
  });

  test("password e codice corretti permettono di entrare e di uscire", async ({ page, context }) => {
    await signInWithPassword(page);
    // Il codice del passo successivo e' accettato (finestra di +-1 passo) e diverso da quello usato nel setup.
    await page.getByLabel("Codice a 6 cifre").fill(totp(loadSecrets().totpSecret, Date.now() + 30_000));
    await page.getByRole("button", { name: "Verifica" }).click();
    await expectDashboard(page);

    // Il cookie di sessione non e' leggibile da JavaScript e non parte nelle richieste cross-site.
    const session = (await context.cookies()).find((c) => c.name.includes("session_token"));
    expect(session, "cookie di sessione presente").toBeDefined();
    expect(session?.httpOnly).toBe(true);
    expect(session?.sameSite).toBe("Lax");

    await page.getByRole("button", { name: "Esci" }).click();
    await expect(page).toHaveURL(/\/accesso$/);
    await page.goto("/");
    await expect(page).toHaveURL(/\/accesso$/);
  });
});

test.describe("codici di recupero", () => {
  test.use({ extraHTTPHeaders: { "x-real-ip": clientIp(24) } });

  test("un codice di recupero vale una sola volta", async ({ page }) => {
    const [code] = loadSecrets().backupCodes;

    await signInWithPassword(page);
    await page.getByRole("button", { name: "Usa un codice di recupero" }).click();
    await page.getByLabel("Codice di recupero").fill(code!);
    await page.getByRole("button", { name: "Verifica" }).click();
    await expectDashboard(page);
    await page.getByRole("button", { name: "Esci" }).click();
    await expect(page).toHaveURL(/\/accesso$/);

    // Stesso codice una seconda volta: respinto.
    await signInWithPassword(page);
    await page.getByRole("button", { name: "Usa un codice di recupero" }).click();
    await page.getByLabel("Codice di recupero").fill(code!);
    await page.getByRole("button", { name: "Verifica" }).click();
    await expect(page.locator('[data-slot="alert"]')).toContainText("Codice non valido");
  });
});

test.describe("limite di frequenza", () => {
  test.use({ extraHTTPHeaders: { "x-real-ip": clientIp(25) } });

  test("troppi tentativi di password dallo stesso indirizzo vengono bloccati (429)", async ({ request }) => {
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      const response = await request.post("/api/auth/sign-in/email", {
        headers: { origin: E2E_ORIGIN },
        data: { email: OWNER.email, password: `Password-Sbagliata-${i}-xyz` },
      });
      statuses.push(response.status());
    }
    expect(statuses.slice(0, 3).every((s) => s === 401)).toBe(true);
    expect(statuses).toContain(429);
  });

  test("il blocco vale per quell'indirizzo, non per gli altri", async ({ playwright }) => {
    const other = await playwright.request.newContext({
      baseURL: E2E_ORIGIN,
      extraHTTPHeaders: { "x-real-ip": clientIp(26) },
    });
    const response = await other.post("/api/auth/sign-in/email", {
      headers: { origin: E2E_ORIGIN },
      data: { email: OWNER.email, password: "Password-Sbagliata-altro-ip" },
    });
    expect(response.status()).toBe(401);
    await other.dispose();
  });
});

test.describe("audit", () => {
  test("gli eventi di sicurezza sono registrati e la catena di hash e' integra", async () => {
    const client = new Client({ connectionString: E2E_DATABASE_URL });
    await client.connect();
    try {
      const actions = await client.query<{ action: string; n: string }>(
        "select action, count(*)::text as n from audit_log group by action",
      );
      const byAction = Object.fromEntries(actions.rows.map((r) => [r.action, Number(r.n)]));
      expect(byAction["owner.bootstrap"]).toBe(1);
      expect(byAction["auth.sign_in"]).toBeGreaterThanOrEqual(4);

      const verify = await client.query<{ broken: string | null }>("select audit_log_verify() as broken");
      expect(verify.rows[0]?.broken).toBeNull();

      // Il registro e' append-only anche per chi ha accesso diretto al database con il ruolo applicativo.
      await expect(client.query("update audit_log set action = 'x' where seq = 1")).rejects.toThrow(/append-only/);
      await expect(client.query("delete from audit_log")).rejects.toThrow(/append-only/);
    } finally {
      await client.end();
    }
  });
});
