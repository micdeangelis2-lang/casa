import { expect, test, type Page } from "@playwright/test";
import { Client } from "./support/pg-client";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, clientIp } from "./support/env";
import { STORAGE_STATE } from "./support/secrets";

// Il proprietario e la sua sessione arrivano dal setup. Tutti i test condividono lo stesso database: sono seriali.
test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(40) } });
test.describe.configure({ mode: "serial" });

const alert = (page: Page) => page.locator('[data-slot="alert"]');

async function pickMunicipality(page: Page, query: string, option: string) {
  const field = page.getByLabel("Comune", { exact: true });
  await field.fill(query);
  await page.getByRole("option", { name: option }).click();
  await expect(field).toHaveValue(option);
}

test.describe("menu e pagine vuote", () => {
  test("Immobili, Rubrica e Impostazioni sono attivi e mostrano lo stato vuoto", async ({ page }) => {
    await page.goto("/");
    for (const name of ["Immobili", "Rubrica", "Impostazioni"]) {
      await expect(page.getByRole("link", { name })).toBeVisible();
    }
    await page.getByRole("link", { name: "Immobili" }).click();
    await expect(page).toHaveURL(/\/immobili$/);
    await expect(page.getByText("Nessun immobile registrato")).toBeVisible();
    await page.getByRole("link", { name: "Rubrica" }).click();
    await expect(page.getByText("Nessun contatto in rubrica")).toBeVisible();
  });
});

test.describe("rubrica", () => {
  test("si aggiunge un contatto con piu' ruoli e lo si ritrova", async ({ page }) => {
    await page.goto("/rubrica/nuovo");
    await page.getByLabel("Nome", { exact: true }).fill("Notaio Esempio");
    await page.getByLabel("Notaio", { exact: true }).check();
    await page.getByLabel("Fornitore", { exact: true }).check();
    await page.getByLabel("Email", { exact: true }).fill("Notaio@Esempio.test");
    await page.getByRole("button", { name: "Salva contatto" }).click();

    await expect(page).toHaveURL(/\/rubrica$/);
    const row = page.getByTestId("party-list").getByRole("listitem").filter({ hasText: "Notaio Esempio" });
    await expect(row).toContainText("Notaio");
    await expect(row).toContainText("Fornitore");
    await expect(row).toContainText("notaio@esempio.test");
  });

  test("i dati sbagliati danno errori chiari e non salvano nulla", async ({ page }) => {
    await page.goto("/rubrica/nuovo");
    await page.getByLabel("Email", { exact: true }).fill("non-una-email");
    await page.getByRole("button", { name: "Salva contatto" }).click();
    const summary = alert(page);
    await expect(summary).toContainText("Ci sono errori da correggere");
    await expect(summary).toContainText("Nome: campo obbligatorio");
    await expect(summary).toContainText("Indirizzo email non valido");
    // Il riepilogo riceve il focus, cosi' un lettore di schermo lo annuncia.
    await expect(page.locator('[tabindex="-1"]').first()).toBeFocused();
    await expect(page.getByText("Nome: campo obbligatorio").last()).toBeVisible();
    await page.goto("/rubrica");
    await expect(page.getByTestId("party-list").getByRole("listitem")).toHaveCount(1);
  });

  test("si modifica e si archivia, e l'archiviato si nasconde ma si ritrova", async ({ page }) => {
    await page.goto("/rubrica");
    await page.getByRole("link", { name: /Notaio Esempio/ }).click();
    await page.getByLabel("Telefono", { exact: true }).fill("081 000000");
    await page.getByRole("button", { name: "Salva modifiche" }).click();
    await expect(page.getByTestId("party-list")).toContainText("081 000000");

    await page.getByRole("link", { name: /Notaio Esempio/ }).click();
    await page.getByRole("button", { name: "Archivia" }).click();
    await expect(page.getByText("Nessun contatto in rubrica")).toBeVisible();
    await page.goto("/rubrica?archiviati=1");
    await expect(page.getByTestId("party-list")).toContainText("Archiviato");
    // Lo lasciamo attivo per i test successivi.
    await page.getByRole("link", { name: /Notaio Esempio/ }).click();
    await page.getByRole("button", { name: "Ripristina" }).click();
    await expect(page.getByTestId("party-list")).toContainText("Notaio Esempio");
  });
});

test.describe("territori", () => {
  test("mostra i Comuni caricati e permette di aggiungere una localita'", async ({ page }) => {
    await page.goto("/impostazioni");
    await page.getByRole("link", { name: /Territori/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Territori" })).toBeVisible();
    await expect(page.getByTestId("territory-stats")).toContainText("Comune");
    await expect(page.getByTestId("territory-stats").locator("div").filter({ hasText: /^Comune/ })).toContainText("2");

    await page.getByLabel(/Si trova in/).fill("alfa");
    await page.getByRole("option", { name: "Comune Alfa (EX) · Regione Esempio" }).click();
    await page.getByLabel("Nome", { exact: true }).fill("Frazione Prova");
    await page.getByRole("button", { name: "Aggiungi territorio" }).click();
    await expect(alert(page)).toContainText("Territorio aggiunto");
    await expect(page.getByTestId("territory-stats").locator("div").filter({ hasText: /^Località/ })).toContainText("1");
  });

  test("una localita' non puo' stare dentro una provincia", async ({ page }) => {
    await page.goto("/impostazioni/territori");
    await page.getByLabel(/Si trova in/).fill("esempio");
    // Il selettore cerca solo Comuni per le localita': una provincia non e' proponibile.
    await expect(page.getByRole("option", { name: /Provincia Esempio/ })).toHaveCount(0);
  });
});

test.describe("immobili", () => {
  test("il modulo segnala cosa manca e non salva", async ({ page }) => {
    await page.goto("/immobili/nuovo");
    await page.getByLabel("Denominazione", { exact: true }).fill("Senza Comune");
    await page.getByRole("button", { name: "Aggiungi titolare" }).click();
    await page.getByLabel("Quota: numeratore").fill("3");
    await page.getByLabel("Quota: denominatore").fill("2");
    await page.getByRole("button", { name: "Salva immobile" }).click();
    const summary = alert(page);
    await expect(summary).toContainText("Scegli il Comune");
    await expect(summary).toContainText("La quota non può superare l'intero");
    await expect(page).toHaveURL(/\/immobili\/nuovo$/);
  });

  test("la ricerca del Comune funziona con la tastiera", async ({ page }) => {
    await page.goto("/immobili/nuovo");
    const field = page.getByLabel("Comune", { exact: true });
    await field.fill("comune");
    await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(2);
    await field.press("ArrowDown");
    await field.press("ArrowDown");
    await field.press("Enter");
    await expect(field).toHaveValue("Comune Beta (EX) · Regione Esempio");
    await field.fill("zzzz");
    await expect(page.getByText("Nessun risultato")).toBeVisible();
  });

  test("si registra un appartamento in comproprieta' con catasto e si rivede nella scheda", async ({ page }) => {
    await page.goto("/immobili/nuovo");
    await page.getByLabel("Denominazione", { exact: true }).fill("Appartamento di prova");
    await page.getByLabel("Uso", { exact: true }).selectOption("primary_residence");
    await page.getByLabel("Fa parte di un condominio").check();
    await pickMunicipality(page, "alfa", "Comune Alfa (EX) · Regione Esempio");
    await page.getByLabel("Indirizzo", { exact: true }).fill("Via Esempio 1");
    await page.getByLabel("CAP", { exact: true }).fill("12345");

    // Prima riga: io (proprieta' in comune 1/2). Seconda: il co-proprietario dalla rubrica.
    await page.getByRole("button", { name: "Aggiungi titolare" }).click();
    const first = page.getByRole("group", { name: "Titolare 1" });
    await first.getByLabel("Diritto", { exact: true }).selectOption("co_ownership");
    await first.getByLabel("Quota: numeratore").fill("1");
    await first.getByLabel("Quota: denominatore").fill("2");

    await page.getByRole("button", { name: "Aggiungi titolare" }).click();
    const second = page.getByRole("group", { name: "Titolare 2" });
    await second.getByLabel("Titolare", { exact: true }).selectOption({ label: "Notaio Esempio" });
    await second.getByLabel("Diritto", { exact: true }).selectOption("co_ownership");
    await second.getByLabel("Quota: numeratore").fill("1");
    await second.getByLabel("Quota: denominatore").fill("2");
    await second.getByLabel("Dal", { exact: true }).fill("2020-05-01");

    await page.getByRole("button", { name: "Aggiungi riga catastale" }).click();
    const cadastral = page.getByRole("group", { name: "Riga catastale 1" });
    await cadastral.getByLabel("Foglio", { exact: true }).fill("5");
    await cadastral.getByLabel("Particella", { exact: true }).fill("120");
    await cadastral.getByLabel("Categoria", { exact: true }).fill("A/2");
    await cadastral.getByLabel("Rendita (€)").fill("1.234,56");

    expect(await a11yViolations(page)).toEqual([]);
    await page.getByRole("button", { name: "Salva immobile" }).click();

    await expect(page).toHaveURL(/\/immobili\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: "Appartamento di prova" })).toBeVisible();
    await expect(page.getByText("Comune Alfa (EX) · Regione Esempio")).toBeVisible();
    const rights = page.getByTestId("rights");
    await expect(rights.getByRole("listitem")).toHaveCount(2);
    await expect(rights).toContainText("Comproprietà, quota 1/2");
    await expect(rights).toContainText("Notaio Esempio");
    await expect(rights).toContainText("dal 01/05/2020");
    await expect(page.getByTestId("cadastral")).toContainText("Foglio 5");
    await expect(page.getByTestId("cadastral")).toContainText("rendita 1234,56");
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("una pertinenza si collega al bene principale e il legame si vede da entrambi i lati", async ({ page }) => {
    await page.goto("/immobili/nuovo");
    await page.getByLabel("Tipo di bene").selectOption("garage");
    await page.getByLabel("Denominazione", { exact: true }).fill("Box di prova");
    await pickMunicipality(page, "alfa", "Comune Alfa (EX) · Regione Esempio");
    await page.getByRole("button", { name: "Aggiungi collegamento" }).click();
    const link = page.getByRole("group", { name: "Collegamento 1" });
    await link.getByLabel("Collegato a", { exact: true }).selectOption({ label: "Appartamento di prova" });
    await link.getByLabel("Stato", { exact: true }).selectOption("documented");
    await link.getByLabel("Su cosa si basa", { exact: true }).fill("Citato nell'atto di acquisto");
    await page.getByRole("button", { name: "Salva immobile" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Box di prova" })).toBeVisible();
    const linkedTo = page.getByTestId("linked-to");
    await expect(linkedTo).toContainText("Appartamento di prova");
    await expect(linkedTo).toContainText("Documentato");
    await expect(linkedTo).toContainText("Citato nell'atto di acquisto");

    await linkedTo.getByRole("link", { name: "Appartamento di prova" }).click();
    await expect(page.getByTestId("linked-from")).toContainText("Box di prova");
  });

  test("la lista cerca e filtra; la modifica e l'archiviazione funzionano", async ({ page }) => {
    await page.goto("/immobili");
    const list = page.getByTestId("asset-list");
    await expect(list.getByRole("listitem")).toHaveCount(2);
    expect(await a11yViolations(page)).toEqual([]);

    await page.getByLabel("Tipo", { exact: true }).selectOption("garage");
    await page.getByRole("button", { name: "Cerca" }).click();
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await expect(list).toContainText("Box di prova");

    await page.goto("/immobili?q=via%20esempio");
    await expect(list).toContainText("Appartamento di prova");

    await page.getByRole("link", { name: /Appartamento di prova/ }).click();
    await page.getByRole("link", { name: "Modifica" }).click();
    // I dati salvati tornano nel modulo, inclusi titolari e catasto.
    await expect(page.getByLabel("Denominazione", { exact: true })).toHaveValue("Appartamento di prova");
    await expect(page.getByLabel("Comune", { exact: true })).toHaveValue("Comune Alfa (EX) · Regione Esempio");
    await expect(page.getByRole("group", { name: "Titolare 2" }).getByLabel("Titolare", { exact: true })).toHaveValue(/.+/);
    await expect(page.getByRole("group", { name: "Riga catastale 1" }).getByLabel("Rendita (€)")).toHaveValue("1234,56");
    await page.getByLabel("Indirizzo", { exact: true }).fill("Via Nuova 7");
    await page.getByRole("button", { name: "Salva modifiche" }).click();
    await expect(page.getByText("Via Nuova 7")).toBeVisible();
    await expect(page.getByTestId("rights").getByRole("listitem")).toHaveCount(2);

    await page.getByRole("button", { name: "Archivia" }).click();
    await expect(page.getByText("Questo bene è archiviato")).toBeVisible();
    await page.goto("/immobili");
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await page.goto("/immobili?archiviati=1");
    await expect(list.getByRole("listitem")).toHaveCount(2);
  });

  test("un id inventato porta a 'non trovato', non a un errore", async ({ page }) => {
    for (const path of ["/immobili/non-un-uuid", "/immobili/00000000-0000-4000-8000-000000000000", "/rubrica/xyz/modifica"]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
    }
  });
});

test.describe("sicurezza degli accessi", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("senza sessione le pagine e la ricerca dei territori sono chiuse", async ({ page, request }) => {
    for (const path of ["/immobili", "/immobili/nuovo", "/rubrica", "/impostazioni/territori"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/accesso$/);
    }
    const response = await request.get("/api/territori?q=comune");
    expect(response.status()).toBe(401);
    expect(await response.text()).not.toContain("Comune Alfa");
  });
});

test.describe("audit del registro", () => {
  test("ogni scrittura e' registrata, senza dati personali, e la catena e' integra", async () => {
    const client = new Client({ connectionString: E2E_DATABASE_URL });
    await client.connect();
    try {
      const rows = await client.query<{ action: string; diff: unknown }>("select action, diff from audit_log where action ~ '^(asset|party|territory)\\.' order by seq");
      const actions = rows.rows.map((r) => r.action);
      for (const expected of ["territory.import_istat", "territory.create", "party.create", "party.update", "party.archive", "party.restore", "party.create_owner", "asset.create", "asset.update", "asset.archive"]) {
        expect(actions, expected).toContain(expected);
      }
      // Le modifiche riportano i nomi dei campi, mai i valori inseriti dall'utente.
      const everything = JSON.stringify(rows.rows);
      for (const secret of ["081 000000", "notaio@esempio.test", "Via Nuova 7", "Via Esempio 1", "1.234,56", "1234,56"]) {
        expect(everything, `"${secret}" non deve comparire nell'audit`).not.toContain(secret);
      }
      const verify = await client.query<{ broken: string | null }>("select audit_log_verify() as broken");
      expect(verify.rows[0]?.broken).toBeNull();
    } finally {
      await client.end();
    }
  });
});
