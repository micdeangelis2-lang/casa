import { expect, test, type Page } from "@playwright/test";
import { a11yViolations } from "./support/a11y";
import { E2E_CRON_SECRET, clientIp } from "./support/env";
import { STORAGE_STATE } from "./support/secrets";

// Gira prima di registry.spec.ts e non carica regole (le conta rules.spec.ts): crea solo scadenze scritte a mano.
test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(80) } });
test.describe.configure({ mode: "serial" });

const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
const alert = (page: Page) => page.locator('[data-slot="alert"]');

async function createManual(page: Page, title: string, dueOn: string, options: { proof?: boolean } = {}) {
  await page.goto("/scadenze/nuova");
  await page.getByLabel("Titolo", { exact: true }).fill(title);
  await page.getByLabel("Categoria", { exact: true }).selectOption("fiscal");
  await page.getByLabel("Come si calcola la data").selectOption("manual");
  await page.getByLabel("Data", { exact: true }).fill(dueOn);
  if (options.proof) await page.getByLabel("Per chiuderla serve una prova (ricevuta, protocollo...)").check();
  await page.getByRole("button", { name: "Crea la scadenza" }).click();
  await expect(page).toHaveURL(/\/scadenze\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
}

test.describe("scadenze", () => {
  test("la voce di menu e' attiva e senza scadenze c'e' lo stato vuoto accessibile", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Scadenze", exact: true }).click();
    await expect(page).toHaveURL(/\/scadenze$/);
    await expect(page.getByText("Nessuna scadenza", { exact: true })).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("il modulo mostra solo i campi del tipo di calcolo scelto e segnala cosa manca", async ({ page }) => {
    await page.goto("/scadenze/nuova");
    expect(await a11yViolations(page)).toEqual([]);
    await page.getByLabel("Come si calcola la data").selectOption("fixed_annual");
    await expect(page.getByLabel("Mese", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Data di partenza")).toHaveCount(0);
    await page.getByLabel("Come si calcola la data").selectOption("recurring");
    await expect(page.getByLabel("Data di partenza")).toBeVisible();
    await expect(page.getByLabel("Mese", { exact: true })).toHaveCount(0);

    await page.getByLabel("Come si calcola la data").selectOption("manual");
    await page.getByRole("button", { name: "Crea la scadenza" }).click();
    await expect(alert(page)).toContainText("Ci sono errori da correggere");
    await expect(alert(page)).toContainText("Titolo: campo obbligatorio");
    await expect(alert(page)).toContainText("Per una scadenza manuale indica la data");
    await expect(page).toHaveURL(/\/scadenze\/nuova$/);
  });

  test("si crea una scadenza a mano e compare tra le prossime, con i giorni che mancano", async ({ page }) => {
    await createManual(page, "Pagamento di prova", iso(5));
    await expect(page.getByTestId("occurrences")).toContainText("Aperta");
    await expect(page.getByText("30, 7, 1, 0 giorni prima")).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);

    await page.goto("/scadenze");
    const row = page.getByTestId("deadline-list").getByRole("listitem").filter({ hasText: "Pagamento di prova" });
    await expect(row).toContainText("Fiscale");
    await expect(row).toContainText(/tra [45678] giorni/);
  });

  test("una scadenza passata e non chiusa e' in ritardo e compare nella vista dedicata", async ({ page }) => {
    await createManual(page, "Scadenza in ritardo", iso(-3));
    await page.goto("/scadenze?vista=ritardo");
    const row = page.getByTestId("deadline-list").getByRole("listitem").filter({ hasText: "Scadenza in ritardo" });
    await expect(row).toContainText(/in ritardo di [234] giorni/);
    await page.goto("/scadenze");
    await expect(page.getByTestId("deadline-list")).not.toContainText("Scadenza in ritardo");
  });

  test("una scadenza annuale si calcola dal giorno e mese, senza date scritte", async ({ page }) => {
    const target = iso(40);
    await page.goto("/scadenze/nuova");
    await page.getByLabel("Titolo", { exact: true }).fill("Ogni anno");
    await page.getByLabel("Categoria", { exact: true }).selectOption("technical");
    await page.getByLabel("Come si calcola la data").selectOption("fixed_annual");
    await page.getByLabel("Giorno", { exact: true }).fill(String(Number(target.slice(8, 10))));
    await page.getByLabel("Mese", { exact: true }).selectOption(String(Number(target.slice(5, 7))));
    await page.getByRole("button", { name: "Crea la scadenza" }).click();
    await expect(page.getByTestId("occurrences").getByTestId("occurrence")).toHaveCount(1);
    await expect(page.getByText(/Ogni anno, stesso giorno: \d+/)).toBeVisible();
  });

  test("chiudere una scadenza che richiede una prova: senza prova no, con un riferimento si, e chi lo attesta e' mostrato", async ({ page }) => {
    await createManual(page, "Con prova", iso(10), { proof: true });
    const occurrence = page.getByTestId("occurrence").first();
    await occurrence.getByText("Segna come completata").click();
    await expect(occurrence).toContainText("Per chiudere questa scadenza serve una prova");
    await occurrence.getByRole("button", { name: /Conferma il completamento/ }).click();
    await expect(occurrence).toContainText("Per chiudere questa scadenza serve una prova: un documento o un riferimento");
    await expect(occurrence.locator('[data-slot="badge"]').first()).toHaveText("Aperta");

    await occurrence.getByLabel("Riferimento (protocollo, quietanza, bonifico)").fill("Protocollo 42");
    await occurrence.getByRole("button", { name: /Conferma il completamento/ }).click();
    await expect(occurrence.locator('[data-slot="badge"]').filter({ hasText: /^Completata$/ })).toBeVisible();
    await expect(occurrence.locator('[data-slot="badge"]').filter({ hasText: "Completata da me" })).toBeVisible();
    await expect(occurrence).toContainText("Riferimento: Protocollo 42");

    await occurrence.getByRole("button", { name: /^Riapri/ }).click();
    await expect(occurrence.locator('[data-slot="badge"]').first()).toHaveText("Aperta");
    await expect(occurrence).toContainText("Riferimento: Protocollo 42");
  });

  test("il rinvio vuole una data futura; «validata da un professionista» vuole il professionista", async ({ page }) => {
    await createManual(page, "Da rinviare", iso(2));
    const occurrence = page.getByTestId("occurrence").first();
    await occurrence.getByText("Segna come completata").click();

    await occurrence.getByLabel("Rinvia gli avvisi fino al").fill(iso(-1));
    await occurrence.getByRole("button", { name: /^Rinvia/ }).click();
    await expect(occurrence).toContainText("Scegli una data futura");
    await occurrence.getByLabel("Rinvia gli avvisi fino al").fill(iso(1));
    await occurrence.getByRole("button", { name: /^Rinvia/ }).click();
    await expect(occurrence).toContainText("Rinviata fino al");

    await occurrence.getByLabel("Chi lo attesta").selectOption("professional_validated");
    await occurrence.getByRole("button", { name: /Conferma il completamento/ }).click();
    await expect(occurrence).toContainText("indica prima il professionista");
  });

  test("il calendario mostra le scadenze del mese e si naviga tra i mesi", async ({ page }) => {
    const month = iso(5).slice(0, 7);
    await page.goto(`/scadenze?vista=calendario&mese=${month}`);
    const calendar = page.getByTestId("calendar");
    await expect(calendar).toBeVisible();
    await expect(calendar.getByRole("link", { name: "Pagamento di prova" })).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);
    await calendar.getByRole("link", { name: /Mese successivo/ }).click();
    await expect(page).toHaveURL(/vista=calendario/);
    await expect(page).not.toHaveURL(new RegExp(`mese=${month}$`));
  });
});

test.describe("avvisi e giro giornaliero", () => {
  test("il giro giornaliero crea gli avvisi, il campanello li conta e si possono leggere", async ({ page }) => {
    await page.goto("/impostazioni/notifiche");
    await expect(page.getByText("Non configurato: gli avvisi restano solo nell'app")).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);
    await page.getByRole("button", { name: "Esegui adesso" }).click();
    await expect(alert(page).filter({ hasText: "Fatto:" })).toContainText(/\d+ nuovi avvisi/);

    await page.goto("/");
    await expect(page.getByTestId("notifications-link")).toContainText(/\d+/);
    await expect(page.getByTestId("dashboard-deadlines")).toContainText("In ritardo");

    await page.getByTestId("notifications-link").click();
    await expect(page).toHaveURL(/\/avvisi$/);
    const list = page.getByTestId("notification-list");
    await expect(list).toContainText("In ritardo da");
    await expect(list).toContainText("Scadenza in ritardo");
    await expect(list).toContainText(/Tra \d+ giorn/);
    expect(await a11yViolations(page)).toEqual([]);

    // Ripetere il giro non duplica gli avvisi.
    const before = await list.getByRole("listitem").count();
    await page.goto("/impostazioni/notifiche");
    await page.getByRole("button", { name: "Esegui adesso" }).click();
    await expect(alert(page).filter({ hasText: "Fatto:" })).toContainText("0 nuovi avvisi");
    await page.goto("/avvisi");
    await expect(page.getByTestId("notification-list").getByRole("listitem")).toHaveCount(before);

    await page.getByRole("button", { name: "Segna tutti come letti" }).click();
    await expect(page.getByText("Nessun avviso.")).toBeVisible();
    await expect(page.getByTestId("notifications-link")).not.toContainText(/\d/);
    await page.goto("/avvisi?tutti=1");
    await expect(page.getByTestId("notification-list")).toContainText("In ritardo da");
  });

  test("le impostazioni delle email controllano l'indirizzo", async ({ page }) => {
    await page.goto("/impostazioni/notifiche");
    await page.getByLabel("Invia gli avvisi anche per email").check();
    await page.getByLabel("Indirizzo email").fill("non-una-email");
    await page.getByRole("button", { name: "Salva", exact: true }).click();
    await expect(alert(page).filter({ hasText: "Ci sono errori" })).toContainText("Indirizzo email non valido");
    await page.getByLabel("Indirizzo email").fill("avvisi@example.test");
    await page.getByRole("button", { name: "Salva", exact: true }).click();
    await expect(page).toHaveURL(/\/impostazioni\/notifiche\?salvato=1$/);
    await expect(page.getByLabel("Indirizzo email")).toHaveValue("avvisi@example.test");
    await expect(page.getByLabel("Invia gli avvisi anche per email")).toBeChecked();
  });

  test("il cron parte solo con il segreto giusto e senza sessione tutto e' chiuso", async ({ playwright, baseURL }) => {
    const anonymous = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { "x-real-ip": clientIp(81) } });
    expect((await anonymous.get("/api/cron/giornaliero")).status()).toBe(401);
    expect((await anonymous.get("/api/cron/giornaliero", { headers: { authorization: "Bearer sbagliato-sbagliato-sbagliato" } })).status()).toBe(401);
    const ok = await anonymous.get("/api/cron/giornaliero", { headers: { authorization: `Bearer ${E2E_CRON_SECRET}` } });
    expect(ok.status()).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, notifications: 0 });
    for (const path of ["/scadenze", "/scadenze/nuova", "/avvisi", "/impostazioni/notifiche"]) {
      expect((await anonymous.get(path, { maxRedirects: 0 })).status(), path).toBe(307);
    }
    await anonymous.dispose();
  });
});
