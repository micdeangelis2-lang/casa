import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { Client } from "pg";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, E2E_ORIGIN, OWNER, clientIp } from "./support/env";
import { STORAGE_STATE, loadSecrets, saveSecrets } from "./support/secrets";
import { addVirtualAuthenticator, importCredentials } from "./support/webauthn";

// «Sicurezza dell'account»: la sessione, la passkey originale, il TOTP e la password del proprietario sono condivisi con tutti gli
// altri file e2e. Qui si aggiungono solo passkey e sessioni di prova (e si tolgono), la password si cambia e si RIPRISTINA, e i
// codici di recupero si rigenerano aggiornando il file dei segreti condivisi con quelli nuovi.
test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(250) } });
test.describe.configure({ mode: "serial" });

const URL = "/impostazioni/sicurezza";
const NEW_PASSWORD = "Tavolo-Lampada-Bicicletta-7";
const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0";
const SAFARI_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

async function db<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

const card = (page: Page, heading: string): Locator =>
  page.getByRole("heading", { level: 2, name: heading, exact: true }).locator("xpath=ancestor::*[@data-slot='card'][1]");

/** Seconda sessione del proprietario in un contesto separato (accesso con passkey), con uno user agent riconoscibile. */
async function signInElsewhere(browser: Browser, userAgent: string, ip: number): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: { "x-real-ip": clientIp(ip) },
    userAgent,
  });
  const page = await context.newPage();
  const authenticator = await addVirtualAuthenticator(context, page);
  // Il contatore della passkey sul server cresce a ogni accesso: l'autenticatore virtuale deve partire da un valore piu' alto.
  const counter = await db(async (client) => Number((await client.query<{ n: number }>("select max(counter) as n from passkey")).rows[0]!.n));
  await importCredentials(
    authenticator,
    loadSecrets().credentials.map((credential) => ({ ...credential, signCount: Math.max(credential.signCount, counter) + 1 })),
  );
  await page.goto("/accesso");
  await page.getByRole("button", { name: "Accedi con passkey" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Panoramica" })).toBeVisible();
  return { context, page };
}

test.afterAll(async () => {
  // Rete di sicurezza: se un test si ferma a meta', le passkey di prova non restano.
  await db(async (client) => {
    await client.query("delete from passkey where name in ('passkey di prova', 'prova rinominata')");
    // Ripristino del contatore della passkey originale: gli altri file la importano con il valore del setup.
    for (const credential of loadSecrets().credentials) {
      await client.query("update passkey set counter = $1 where credential_id = $2", [credential.signCount, credential.credentialId]);
    }
  });
});

test.describe("elenco e accessibilita'", () => {
  test("la pagina e' raggiungibile da Impostazioni, mostra passkey e sessione corrente e nasconde l'ultima parte dell'IP", async ({ page }) => {
    await page.goto("/impostazioni");
    await page.getByRole("link", { name: /Sicurezza dell'account/ }).click();
    await expect(page).toHaveURL(/\/impostazioni\/sicurezza$/);
    await expect(page.getByRole("heading", { level: 1, name: "Sicurezza dell'account" })).toBeVisible();

    // Passkey creata dal setup: nome, data, tipo e sincronizzazione.
    const rows = page.getByTestId("passkey-row");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("telefono di prova");
    await expect(rows.first()).toContainText(/\d{2}\/\d{2}\/\d{2}/);
    await expect(rows.first()).toContainText(/Legata a un solo dispositivo|Utilizzabile su più dispositivi/);

    // Sessione corrente evidenziata, IP senza l'ultimo ottetto.
    const current = page.locator('[data-testid="session-row"][data-current="true"]');
    await expect(current).toHaveCount(1);
    await expect(current).toContainText("Questa sessione");
    await expect(current).toContainText(/\d+\.\d+\.\d+\.x/);
    await expect(page.getByTestId("session-table")).not.toContainText(clientIp(10));

    for (const size of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(size);
      expect(await a11yViolations(page), `${size.width}px`).toEqual([]);
    }
  });
});

test.describe("passkey", () => {
  test("l'ultima passkey non si rimuove: ne' dall'interfaccia ne' dalle rotte dirette", async ({ page }) => {
    await page.goto(URL);
    const passkeys = card(page, "Passkey");
    await expect(passkeys.getByRole("button", { name: /^Rimuovi/ })).toBeDisabled();
    await expect(passkeys.getByText("È l'ultima passkey: per rimuoverla ne serve prima un'altra.")).toBeVisible();

    // Le rotte di Better Auth per rimuovere o rinominare restano chiuse: non si aggira la regola dall'esterno.
    const id = await db(async (client) => (await client.query<{ id: string }>("select id from passkey limit 1")).rows[0]!.id);
    for (const path of ["delete-passkey", "update-passkey"]) {
      const response = await page.request.post(`/api/auth/passkey/${path}`, { headers: { origin: E2E_ORIGIN }, data: { id, name: "x" } });
      expect(response.status(), path).toBe(403);
    }
    await db(async (client) => {
      expect((await client.query("select 1 from passkey where id = $1 and name = 'telefono di prova'", [id])).rowCount).toBe(1);
    });
  });

  test("aggiunge, rinomina e rimuove una passkey di prova", async ({ page, context }) => {
    await addVirtualAuthenticator(context, page); // autenticatore vuoto: la passkey nuova e' la sua
    await page.goto(URL);
    const passkeys = card(page, "Passkey");

    await passkeys.getByLabel("Nome della passkey").fill("passkey di prova");
    await passkeys.getByRole("button", { name: "Aggiungi passkey" }).click();
    await expect(passkeys.getByRole("region", { name: "Aggiungi una passkey" }).getByRole("status")).toContainText("Passkey aggiunta.");
    await expect(page.getByTestId("passkey-row")).toHaveCount(2);
    await expect(page.getByTestId("passkey-row").filter({ hasText: "passkey di prova" })).toHaveCount(1);
    // Con due passkey la rimozione e' possibile.
    await expect(passkeys.getByRole("button", { name: /^Rimuovi/ }).first()).toBeEnabled();

    await passkeys.getByRole("button", { name: "Rinomina passkey di prova" }).click();
    await passkeys.getByLabel("Nuovo nome per la passkey passkey di prova").fill("prova rinominata");
    await passkeys.getByRole("button", { name: "Salva" }).click();
    await expect(passkeys.getByTestId("feedback-status")).toContainText("Passkey rinominata.");
    await expect(page.getByTestId("passkey-row").filter({ hasText: "prova rinominata" })).toHaveCount(1);

    // La rimozione chiede conferma; annullando non succede nulla.
    await passkeys.getByRole("button", { name: "Rimuovi prova rinominata" }).click();
    await passkeys.getByRole("button", { name: "Annulla" }).click();
    await expect(page.getByTestId("passkey-row")).toHaveCount(2);

    await passkeys.getByRole("button", { name: "Rimuovi prova rinominata" }).click();
    await passkeys.getByRole("button", { name: /^Conferma la rimozione/ }).click();
    await expect(passkeys.getByTestId("feedback-status")).toContainText("Passkey rimossa.");
    await expect(page.getByTestId("passkey-row")).toHaveCount(1);
    await expect(page.getByTestId("passkey-row").first()).toContainText("telefono di prova");

    // Audit: solo il nome dell'azione e l'identificativo, mai il nome scelto.
    await db(async (client) => {
      const rows = (await client.query<{ action: string; text: string }>("select action, (entity_id || diff::text) as text from audit_log where action like 'owner.passkey.%'")).rows;
      const count = (action: string) => rows.filter((r) => r.action === action).length;
      expect(count("owner.passkey.add")).toBeGreaterThanOrEqual(2); // quella del setup e quella di prova
      expect(count("owner.passkey.rename")).toBe(1);
      expect(count("owner.passkey.remove")).toBe(1);
      expect(JSON.stringify(rows)).not.toMatch(/prova/);
    });
  });
});

test.describe("sessioni", () => {
  test("revoca di una singola sessione di un altro dispositivo", async ({ page, browser }) => {
    const other = await signInElsewhere(browser, FIREFOX_LINUX, 251);
    try {
      await page.goto(URL);
      // L'accesso con passkey del browser di prova puo' aprire piu' di una sessione (compilazione automatica + clic): si chiudono una a una.
      const rows = page.getByTestId("session-row").filter({ hasText: "Firefox · Linux" });
      const total = await rows.count();
      expect(total).toBeGreaterThanOrEqual(1);
      await expect(rows.first()).toHaveAttribute("data-current", "false");

      for (let remaining = total; remaining > 0; remaining--) {
        await page.getByRole("button", { name: "Chiudi la sessione Firefox · Linux" }).first().click();
        await expect(card(page, "Sessioni aperte").getByRole("status")).toContainText("Sessione chiusa.");
        await expect(rows).toHaveCount(remaining - 1);
      }

      // L'altro dispositivo non e' piu' autenticato; la sessione condivisa resta valida.
      await other.page.goto("/");
      await expect(other.page).toHaveURL(/\/accesso$/);
      await page.reload();
      await expect(page.locator('[data-testid="session-row"][data-current="true"]')).toHaveCount(1);
    } finally {
      await other.context.close();
    }
  });

  test("«Esci dagli altri dispositivi» chiude le altre sessioni e lascia quella corrente", async ({ page, browser }) => {
    const first = await signInElsewhere(browser, FIREFOX_LINUX, 252);
    const second = await signInElsewhere(browser, SAFARI_MAC, 252);
    try {
      await page.goto(URL);
      await expect(page.getByTestId("session-row").filter({ hasText: "Safari · macOS" }).first()).toBeVisible();
      await expect(page.getByTestId("session-row").filter({ hasText: "Firefox · Linux" }).first()).toBeVisible();

      await page.getByRole("button", { name: "Esci dagli altri dispositivi" }).click();
      await expect(card(page, "Sessioni aperte").getByRole("status")).toContainText(/Chius[ae] \d* ?session/);
      await expect(page.getByTestId("session-row")).toHaveCount(1);
      await expect(page.getByTestId("session-row").first()).toHaveAttribute("data-current", "true");
      await expect(page.getByRole("button", { name: "Esci dagli altri dispositivi" })).toBeDisabled();

      for (const { page: otherPage } of [first, second]) {
        await otherPage.goto("/");
        await expect(otherPage).toHaveURL(/\/accesso$/);
      }
      // La sessione condivisa funziona ancora per tutti gli altri file.
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1, name: "Panoramica" })).toBeVisible();

      await db(async (client) => {
        const actions = (await client.query<{ action: string }>("select action from audit_log where action like 'owner.session%'")).rows.map((r) => r.action);
        expect(actions).toContain("owner.session.revoke");
        expect(actions).toContain("owner.sessions.revoke_others");
      });
    } finally {
      await first.context.close();
      await second.context.close();
    }
  });
});

test.describe("codici di recupero", () => {
  test("la rigenerazione chiede la password, mostra i codici una volta sola e invalida i precedenti", async ({ page, context, browser }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: E2E_ORIGIN });
    await page.goto(URL);
    const recovery = card(page, "Codici di recupero");
    await expect(recovery.getByText("Rigenerandoli, i codici precedenti non valgono più.")).toBeVisible();

    // Password sbagliata: errore neutro, nessun codice.
    await recovery.getByLabel("Password attuale").fill("Password-Sbagliata-123");
    await recovery.getByRole("button", { name: "Rigenera i codici" }).click();
    await expect(recovery.getByRole("alert")).toContainText("La password attuale non è corretta.");
    await expect(page.getByTestId("new-recovery-codes")).toHaveCount(0);

    await recovery.getByLabel("Password attuale").fill(OWNER.password);
    await recovery.getByRole("button", { name: "Rigenera i codici" }).click();
    const list = page.getByTestId("new-recovery-codes");
    await expect(list).toBeVisible();
    const codes = await list.getByRole("listitem").allTextContents();
    expect(codes).toHaveLength(10);
    await expect(recovery.getByText(/non vengono salvati/)).toBeVisible();
    await expect(recovery.getByText(/I codici precedenti non valgono più\./).first()).toBeVisible();

    // I codici nuovi sostituiscono quelli condivisi: i file e2e successivi leggono questi.
    const previous = loadSecrets();
    saveSecrets({ ...previous, backupCodes: codes });

    await recovery.getByRole("button", { name: "Copia" }).click();
    await expect(recovery.getByRole("status")).toContainText("Codici copiati negli appunti.");
    expect((await page.evaluate(() => navigator.clipboard.readText())).split(/\r?\n/)).toEqual(codes);

    for (const size of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(size);
      expect(await a11yViolations(page), `${size.width}px`).toEqual([]);
    }

    // Una volta chiusi, i codici non sono piu' nella pagina (ne' dopo un ricaricamento).
    await recovery.getByRole("button", { name: "Ho conservato i codici" }).click();
    await expect(page.getByTestId("new-recovery-codes")).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("new-recovery-codes")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(codes[0]!);

    // Mai nell'audit: solo nome dell'azione e conteggio.
    await db(async (client) => {
      const audit = (await client.query<{ t: string }>("select string_agg(action || entity_id || diff::text, ' ') as t from audit_log")).rows[0]!.t;
      for (const code of codes) expect(audit).not.toContain(code);
      const rows = (await client.query<{ diff: { count: number } }>("select diff from audit_log where action = 'owner.recovery_codes.regenerate'")).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.diff).toEqual({ count: 10 });
    });

    // Un codice vecchio non vale piu'; uno nuovo si'.
    const other = await browser.newContext({ storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { "x-real-ip": clientIp(253) } });
    try {
      const otherPage = await other.newPage();
      const useCode = async (code: string) => {
        await otherPage.goto("/accesso");
        await otherPage.getByLabel("Email").fill(OWNER.email);
        await otherPage.getByLabel("Password", { exact: true }).fill(OWNER.password);
        await otherPage.getByRole("button", { name: "Accedi con password" }).click();
        await otherPage.getByRole("button", { name: "Usa un codice di recupero" }).click();
        await otherPage.getByLabel("Codice di recupero").fill(code);
        await otherPage.getByRole("button", { name: "Verifica" }).click();
      };
      await useCode(previous.backupCodes[1]!);
      await expect(otherPage.locator('[data-slot="alert"]')).toContainText("Codice non valido");
      await useCode(codes[0]!);
      await expect(otherPage.getByRole("heading", { level: 1, name: "Panoramica" })).toBeVisible();
      // Il codice usato non e' piu' valido: si toglie anche dall'elenco condiviso.
      saveSecrets({ ...loadSecrets(), backupCodes: codes.slice(1) });
      // Si chiude la sessione di prova (e' un contesto separato dalla sessione condivisa).
      await otherPage.getByRole("button", { name: "Esci" }).click();
      await expect(otherPage).toHaveURL(/\/accesso$/);
    } finally {
      await other.close();
    }
  });
});

test.describe("password", () => {
  test("il cambio richiede quella attuale e viene ripristinato a fine test", async ({ page, request }) => {
    await page.goto(URL);
    const password = card(page, "Password");
    const fill = async (current: string, next: string, confirm: string) => {
      await password.getByLabel("Password attuale").fill(current);
      await password.getByLabel("Nuova password", { exact: true }).fill(next);
      await password.getByLabel("Ripeti la nuova password").fill(confirm);
      await password.getByRole("button", { name: "Cambia password" }).click();
    };

    await fill("Password-Sbagliata-123", NEW_PASSWORD, NEW_PASSWORD);
    await expect(password.getByRole("alert")).toContainText("La password attuale non è corretta.");
    await fill(OWNER.password, NEW_PASSWORD, "Un-Altra-Password-Lunga-1");
    await expect(password.getByRole("alert")).toContainText("Le due password nuove non coincidono.");
    await fill(OWNER.password, OWNER.password, OWNER.password);
    await expect(password.getByRole("alert")).toContainText("deve essere diversa");

    // Cambio e subito ripristino (la seconda operazione prova anche che la nuova password era quella attuale).
    await fill(OWNER.password, NEW_PASSWORD, NEW_PASSWORD);
    await expect(password.getByRole("status")).toContainText("Password cambiata.");
    await fill(NEW_PASSWORD, OWNER.password, OWNER.password);
    await expect(password.getByRole("status")).toContainText("Password cambiata.");

    // Ripristino verificabile: la password originale e' di nuovo accettata (si arriva al secondo fattore) e quella provvisoria no.
    const headers = { origin: E2E_ORIGIN, "x-real-ip": clientIp(254) };
    const original = await request.post("/api/auth/sign-in/email", { headers, data: { email: OWNER.email, password: OWNER.password } });
    expect(original.status()).toBe(200);
    expect((await original.json()).twoFactorRedirect).toBe(true);
    const temporary = await request.post("/api/auth/sign-in/email", { headers, data: { email: OWNER.email, password: NEW_PASSWORD } });
    expect(temporary.status()).toBe(401);

    // La sessione condivisa e' ancora valida.
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Panoramica" })).toBeVisible();

    await db(async (client) => {
      const rows = (await client.query<{ t: string }>("select action || entity_id || diff::text as t from audit_log where action = 'owner.password.change'")).rows;
      expect(rows).toHaveLength(2);
      expect(JSON.stringify(rows)).not.toContain(NEW_PASSWORD);
      expect(JSON.stringify(rows)).not.toContain(OWNER.password);
    });
  });
});
