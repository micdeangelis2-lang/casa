import { expect, test, type Page } from "@playwright/test";
import { Client } from "./support/pg-client";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, clientIp } from "./support/env";
import { STORAGE_STATE } from "./support/secrets";

// Gira prima di registry.spec.ts (ordine alfabetico) e condivide il database: crea i suoi immobili, i suoi contatti e le sue
// scadenze e li rimuove alla fine. Non crea regole (rules.spec.ts parte dallo stato vuoto).
test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(140) } });
test.describe.configure({ mode: "serial" });

const alert = (page: Page) => page.locator('[data-slot="alert"]');
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const it = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("it-IT");
const form = (page: Page, name: string) => page.getByRole("form", { name, exact: true });
const TITLE = "Locazione a Esempio E2E";

async function db<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function openLetting(page: Page, name: RegExp | string = TITLE) {
  await page.goto("/locazioni");
  await page.getByTestId("letting-list").getByRole("link", { name }).click();
  await expect(page).toHaveURL(/\/locazioni\/[0-9a-f-]{36}$/);
}

test.beforeAll(async () => {
  await db(async (client) => {
    await client.query(`insert into asset (kind, name, territory_id) select 'dwelling', 'Appartamento Locazioni E2E', id from territory where name = 'Comune Alfa'`);
    await client.query(`insert into asset (kind, name, territory_id) select 'dwelling', 'Casa Vacanze E2E', id from territory where name = 'Comune Alfa'`);
    await client.query("insert into party (display_name, roles) values ('Inquilino E2E', '{tenant}'), ('Gestore E2E', '{manager}')");
  });
});

test.afterAll(async () => {
  await db(async (client) => {
    await client.query("delete from letting");
    await client.query("delete from deadline");
    await client.query("delete from dossier_item where asset_id in (select id from asset where name in ('Appartamento Locazioni E2E', 'Casa Vacanze E2E'))");
    await client.query("delete from asset where name in ('Appartamento Locazioni E2E', 'Casa Vacanze E2E')");
    await client.query("delete from party where display_name in ('Inquilino E2E', 'Gestore E2E')");
  });
});

test.describe("locazioni e ricettività", () => {
  test("la voce di menu e' attiva, senza voci c'e' lo stato vuoto e si spiega dove stanno i requisiti del territorio", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Locazioni e ricettività", exact: true }).click();
    await expect(page).toHaveURL(/\/locazioni$/);
    await expect(page.getByText("Nessuna locazione o attività", { exact: true })).toBeVisible();
    await expect(page.getByText(/lo descrivi con le Regole/)).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("il tipo si sceglie per primo: i campi del contratto compaiono solo per le locazioni di durata", async ({ page }) => {
    await page.goto("/locazioni/nuova");
    expect(await a11yViolations(page)).toEqual([]);
    await expect(page.getByLabel("Canone mensile (€)")).toHaveCount(0);
    await page.getByRole("button", { name: "Salva", exact: true }).click();
    await expect(alert(page)).toContainText("Scegli il tipo di locazione o di attività");

    await page.getByLabel("Tipo", { exact: true }).selectOption({ label: "Locazione abitativa ordinaria" });
    await expect(page.getByLabel("Canone mensile (€)")).toBeVisible();
    await expect(page.getByLabel("Numero di registrazione")).toBeVisible();
    await page.getByLabel("Tipo", { exact: true }).selectOption({ label: "Locazione breve o turistica" });
    await expect(page.getByLabel("Canone mensile (€)")).toHaveCount(0);

    await page.getByLabel("Tipo", { exact: true }).selectOption({ label: "Locazione abitativa ordinaria" });
    await page.getByLabel("Immobile", { exact: true }).selectOption({ label: "Appartamento Locazioni E2E" });
    await page.getByLabel("Titolo", { exact: true }).fill(TITLE);
    await page.getByLabel("Dal", { exact: true }).fill(day(-20));
    await page.getByLabel("Fino al", { exact: true }).fill(day(700));
    await page.getByLabel("Gestore o operatore (dalla rubrica)").selectOption({ label: "Gestore E2E" });
    await page.getByLabel("Canone mensile (€)").fill("650,00");
    await page.getByLabel("Cauzione (€)", { exact: true }).fill("1.300,00");
    await page.getByLabel("Numero di registrazione").fill("REG-E2E-1");
    await page.getByLabel("Crea anche un promemoria alla data di fine").check();
    await page.getByRole("button", { name: "Salva", exact: true }).click();

    await expect(page).toHaveURL(/\/locazioni\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
    await expect(page.getByText("Locazione abitativa ordinaria", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/non stabilisce quali requisiti servano per questa attività/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Vai alle Regole" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Dossier del bene" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Apri la scadenza" })).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("inquilino, occupanti e garanti si collegano dalla rubrica", async ({ page }) => {
    await openLetting(page);
    const add = form(page, "Collega una persona");
    await add.getByRole("button", { name: "Collega una persona" }).click();
    await expect(add).toContainText("Scegli il contatto dalla rubrica");
    await add.getByLabel("Contatto").selectOption({ label: "Inquilino E2E" });
    await add.getByRole("button", { name: "Collega una persona" }).click();
    await expect(page.getByTestId("people")).toContainText("Inquilino E2E");
    await expect(page.getByTestId("people")).toContainText("Inquilino", { ignoreCase: false });
  });

  test("il calendario dei canoni: l'arretrato si vede, un pagamento lo azzera e dopo un pagamento non si rigenera", async ({ page }) => {
    await openLetting(page);
    const schedule = form(page, "Crea il calendario dei canoni");
    await schedule.getByLabel("Prima scadenza").fill(day(-20));
    await schedule.getByLabel("Numero di mesi").fill("3");
    await schedule.getByLabel("Canone (€)").fill("650,00");
    await schedule.getByLabel("Crea anche una scadenza per ogni canone (al massimo 24)").check();
    await schedule.getByRole("button", { name: "Crea il calendario" }).click();
    await expect(page.getByTestId("rent")).toHaveCount(3);
    await expect(page.getByTestId("rent-totals")).toContainText("Previsto 1.950,00 € · pagato 0,00 € · arretrato registrato 650,00 €");
    await expect(page.getByTestId("rents").getByText("Scadenza superata", { exact: true })).toHaveCount(1);

    const first = page.getByTestId("rent").first();
    await first.locator("summary").click();
    await first.getByLabel("Importo incassato (€)").fill("650,00");
    await first.getByLabel("Data dell'incasso").fill(day(-5));
    await first.getByLabel("Modalità (facoltativa)").fill("bonifico");
    await first.getByRole("button", { name: "Registra un incasso", exact: true }).last().click();
    await expect(first.getByTestId("rent-receipts")).toContainText("650,00 €");
    await expect(first.getByTestId("rent-receipts")).toContainText("bonifico");
    await expect(first.getByTestId("rent-receipts")).toContainText("senza documento di prova");
    await expect(first).toContainText("Pagato");
    await expect(page.getByTestId("rent-totals")).toContainText("pagato 650,00 € · arretrato registrato 0,00 €");

    await schedule.getByRole("button", { name: "Crea il calendario" }).click();
    await expect(schedule).toContainText("Ci sono canoni già pagati");
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("i codici identificativi e gli adempimenti si scrivono e si chiudono; la scadenza segue", async ({ page }) => {
    await openLetting(page);
    const code = form(page, "Aggiungi un codice");
    await code.getByLabel("Nome del codice").fill("Codice identificativo");
    await code.getByLabel("Codice", { exact: true }).fill("ABC-E2E");
    await code.getByLabel("Valido fino al").fill(day(-3));
    await code.getByRole("button", { name: "Aggiungi un codice" }).click();
    await expect(page.getByTestId("codes")).toContainText("Codice identificativo: ABC-E2E");
    await expect(page.getByTestId("codes")).toContainText("Scaduto");

    const report = form(page, "Aggiungi un adempimento");
    await report.getByRole("button", { name: "Aggiungi l'adempimento" }).click();
    await expect(report).toContainText("Titolo: campo obbligatorio");
    await report.getByLabel("Tipo", { exact: true }).selectOption({ label: "Imposta di soggiorno" });
    await report.getByLabel("Titolo", { exact: true }).fill("Imposta del trimestre");
    await report.getByLabel("Scadenza", { exact: true }).fill(day(20));
    await report.getByLabel("Importo (€)").fill("120,50");
    await report.getByLabel("Crea anche una scadenza").check();
    await report.getByRole("button", { name: "Aggiungi l'adempimento" }).click();
    const row = page.getByTestId("report").first();
    await expect(row).toContainText("Imposta di soggiorno");
    await expect(row).toContainText("Da fare");
    await expect(row).toContainText(`scadenza ${it(day(20))}`);
    await expect(row).toContainText("importo 120,50 €");

    await row.locator("summary").click();
    await row.getByLabel("Eseguito il").fill(day(0));
    await row.getByRole("button", { name: "Segna come eseguito", exact: true }).last().click();
    await expect(row).toContainText("Eseguito");
    await row.getByRole("button", { name: /^Riapri/ }).click();
    await expect(row).toContainText("Da fare");

    await page.goto("/scadenze");
    await expect(page.getByText(/Imposta del trimestre: Locazione a Esempio E2E/).first()).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("un'attività di breve soggiorno non ha il calendario dei canoni; si conclude e l'elenco la nasconde", async ({ page }) => {
    await page.goto("/locazioni/nuova");
    await page.getByLabel("Tipo", { exact: true }).selectOption({ label: "Struttura ricettiva regolamentata" });
    await page.getByLabel("Immobile", { exact: true }).selectOption({ label: "Casa Vacanze E2E" });
    await page.getByLabel("Titolo", { exact: true }).fill("Casa vacanze E2E");
    await page.getByRole("button", { name: "Salva", exact: true }).click();
    await expect(page).toHaveURL(/\/locazioni\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 2, name: "Canoni" })).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 2, name: "Codici identificativi" })).toBeVisible();

    const status = form(page, "Aggiorna lo stato");
    await status.getByLabel("Stato").selectOption("ended");
    await status.getByRole("button", { name: "Aggiorna lo stato" }).click();
    await expect(page.getByText("Conclusa", { exact: true }).first()).toBeVisible();

    await page.goto("/locazioni");
    await expect(page.getByTestId("letting-list")).not.toContainText("Casa vacanze E2E");
    await page.getByLabel("Mostra anche le concluse").check();
    await page.getByRole("button", { name: "Applica" }).click();
    await expect(page.getByTestId("letting-list")).toContainText("Casa vacanze E2E");
    await expect(page.getByTestId("letting-list")).toContainText("Struttura ricettiva regolamentata");
  });

  test("l'editor delle regole offre il tipo di attività in corso come fatto del bene", async ({ page }) => {
    await page.goto("/regole/nuova");
    await page.getByLabel("Si applica", { exact: true }).selectOption("all");
    const condition = page.getByRole("group", { name: "Condizione 1" });
    await condition.getByLabel("Caratteristica", { exact: true }).selectOption({ label: "Locazioni o attività in corso" });
    await expect(condition.getByLabel("Valore", { exact: true }).locator("option")).toHaveText(["Locazione abitativa ordinaria", "Locazione transitoria", "Locazione per studenti", "Locazione breve o turistica", "Struttura ricettiva regolamentata"]);
  });
});

test.describe("sicurezza degli accessi alle locazioni", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("senza sessione le pagine sono chiuse", async ({ page }) => {
    for (const path of ["/locazioni", "/locazioni/nuova"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/accesso$/);
    }
  });
});
