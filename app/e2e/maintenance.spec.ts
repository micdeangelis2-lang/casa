import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, clientIp } from "./support/env";
import { STORAGE_STATE } from "./support/secrets";

// Gira prima di registry.spec.ts (ordine alfabetico) e condivide il database: crea il suo immobile, il suo contatto e le sue
// scadenze e li rimuove alla fine, cosi' gli altri file trovano l'ambiente come prima.
test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(120) } });
test.describe.configure({ mode: "serial" });

const alert = (page: Page) => page.locator('[data-slot="alert"]');
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const it = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("it-IT");
const form = (page: Page, name: string) => page.getByRole("form", { name, exact: true });

async function db<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function openWork(page: Page) {
  await page.goto("/manutenzioni");
  await page.getByTestId("work-list").getByRole("link", { name: /Sostituzione caldaia E2E/ }).click();
  await expect(page).toHaveURL(/\/manutenzioni\/[0-9a-f-]{36}$/);
}

test.beforeAll(async () => {
  await db(async (client) => {
    await client.query(`insert into asset (kind, name, territory_id) select 'dwelling', 'Appartamento Lavori E2E', id from territory where name = 'Comune Alfa'`);
    await client.query("insert into party (display_name, roles) values ('Idraulico E2E', '{supplier}')");
  });
});

test.afterAll(async () => {
  await db(async (client) => {
    await client.query("delete from maint_work");
    await client.query("delete from maint_warranty");
    await client.query("delete from maint_inspection_plan");
    await client.query("delete from deadline");
    await client.query("delete from asset where name = 'Appartamento Lavori E2E'");
    await client.query("delete from party where display_name = 'Idraulico E2E'");
  });
});

test.describe("manutenzioni e lavori", () => {
  test("la voce di menu e' attiva e senza interventi c'e' lo stato vuoto accessibile", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Manutenzioni e lavori", exact: true }).click();
    await expect(page).toHaveURL(/\/manutenzioni$/);
    await expect(page.getByText("Nessun intervento", { exact: true })).toBeVisible();
    await expect(page.getByText(/non valuta i preventivi/)).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("si registra un intervento con fornitore, importo previsto e scadenza alla data prevista", async ({ page }) => {
    await page.goto("/manutenzioni/nuovo");
    expect(await a11yViolations(page)).toEqual([]);
    await page.getByRole("button", { name: "Salva l'intervento" }).click();
    await expect(alert(page)).toContainText("Scegli l'immobile");

    await page.getByLabel("Immobile").selectOption({ label: "Appartamento Lavori E2E" });
    await page.getByLabel("Titolo", { exact: true }).fill("Sostituzione caldaia E2E");
    await page.getByLabel("Fornitore o ditta (dalla rubrica)").selectOption({ label: "Idraulico E2E" });
    await page.getByLabel("Data prevista", { exact: true }).fill(day(15));
    await page.getByLabel("Importo previsto (€)").fill("3.500,00");
    await page.getByLabel("Crea anche una scadenza alla data prevista").check();
    await page.getByRole("button", { name: "Salva l'intervento" }).click();

    await expect(page).toHaveURL(/\/manutenzioni\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: "Sostituzione caldaia E2E" })).toBeVisible();
    await expect(page.getByText("Previsto", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Apri la scadenza" })).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("i preventivi: uno scaduto e' segnalato, accettarne uno porta l'intervento ad approvato", async ({ page }) => {
    await openWork(page);
    const add = form(page, "Aggiungi un preventivo");
    await add.getByRole("button", { name: "Aggiungi un preventivo" }).click();
    await expect(add).toContainText("Importo: campo obbligatorio");
    await add.getByLabel("Importo (€)").fill("abc");
    await add.getByRole("button", { name: "Aggiungi un preventivo" }).click();
    await expect(add).toContainText("importo non valido");

    await add.getByLabel("Importo (€)").fill("3.800,00");
    await add.getByLabel("Valido fino al").fill(day(-3));
    await add.getByRole("button", { name: "Aggiungi un preventivo" }).click();
    await expect(page.getByTestId("quotes")).toContainText("3.800,00 €");
    await expect(page.getByTestId("quotes")).toContainText("Validità scaduta");
    await expect(page.getByText("Con preventivo", { exact: true }).first()).toBeVisible();

    await add.getByLabel("Importo (€)").fill("3.400,00");
    await add.getByLabel("Fornitore", { exact: true }).selectOption({ label: "Idraulico E2E" });
    await add.getByRole("button", { name: "Aggiungi un preventivo" }).click();
    const second = page.getByTestId("quotes").getByRole("listitem").filter({ hasText: "3.400,00 €" });
    await second.getByRole("button", { name: /^Accetta/ }).click();
    await expect(second).toContainText("Accettato");
    await expect(page.getByTestId("accepted-total")).toHaveText("3.400,00 €");
    await expect(page.getByText("Approvato", { exact: true }).first()).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("gli avanzamenti hanno una nota e una percentuale facoltativa scritta dal proprietario", async ({ page }) => {
    await openWork(page);
    const add = form(page, "Registra un avanzamento");
    await add.getByLabel("Cosa è stato fatto").fill("Smontata la vecchia caldaia");
    await add.getByLabel("Percentuale").fill("150");
    await add.getByRole("button", { name: "Registra un avanzamento" }).click();
    await expect(add).toContainText("Percentuale tra 0 e 100");
    await add.getByLabel("Percentuale").fill("50");
    await add.getByRole("button", { name: "Registra un avanzamento" }).click();
    await expect(page.getByTestId("progress")).toContainText("Smontata la vecchia caldaia");
    await expect(page.getByTestId("progress")).toContainText("50%");
  });

  test("le fatture si segnano pagate o da pagare e i totali seguono i dati inseriti", async ({ page }) => {
    await openWork(page);
    const add = form(page, "Aggiungi una fattura");
    await add.getByLabel("Numero").fill("FT-12");
    await add.getByLabel("Data della fattura").fill(day(-1));
    await add.getByLabel("Importo (€)").fill("1.000,00");
    await add.getByRole("button", { name: "Aggiungi una fattura" }).click();
    await expect(page.getByTestId("invoices")).toContainText("1.000,00 €");
    await expect(page.getByTestId("invoices")).toContainText("n. FT-12");
    await expect(page.getByTestId("invoices").getByText("Da pagare", { exact: true })).toBeVisible();
    await expect(page.getByTestId("paid-total")).toContainText("0,00 €");
    await expect(page.getByTestId("paid-total")).toContainText("da pagare 1.000,00 €");

    const row = page.getByTestId("invoices").getByRole("listitem").first();
    await row.locator("summary").click();
    await row.getByLabel("Data del pagamento").fill(day(0));
    await row.getByRole("button", { name: "Segna come pagata", exact: true }).last().click();
    await expect(page.getByTestId("paid-total")).toContainText("1.000,00 €");
    await expect(row).toContainText(`pagata il ${it(day(0))}`);
    await row.getByRole("button", { name: /^Segna da pagare/ }).click();
    await expect(page.getByTestId("invoices").getByText("Da pagare", { exact: true })).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("lo stato si aggiorna e l'elenco mostra importi e avanzamento", async ({ page }) => {
    await openWork(page);
    const status = form(page, "Aggiorna lo stato");
    await status.getByLabel("Stato").selectOption("in_progress");
    await status.getByRole("button", { name: "Aggiorna lo stato" }).click();
    await expect(page.getByText("In corso", { exact: true }).first()).toBeVisible();

    await page.goto("/manutenzioni");
    const row = page.getByTestId("work-list").getByRole("listitem").filter({ hasText: "Sostituzione caldaia E2E" });
    await expect(row).toContainText("Preventivo accettato 3.400,00 €");
    await expect(row).toContainText("Fatturato 1.000,00 €");
    await expect(row).toContainText("Avanzamento 50% (indicato da te)");
    await page.getByLabel("Stato", { exact: true }).selectOption("completed");
    await page.getByRole("button", { name: "Applica" }).click();
    await expect(page.getByText("Nessun intervento con questi filtri.")).toBeVisible();
  });

  test("le garanzie hanno inizio, fine e scadenza collegata; archiviarle le toglie dall'elenco", async ({ page }) => {
    await page.goto("/manutenzioni?sezione=warranties");
    expect(await a11yViolations(page)).toEqual([]);
    const add = form(page, "Aggiungi una garanzia");
    await add.getByRole("button", { name: "Aggiungi la garanzia" }).click();
    await expect(add).toContainText("Scegli l'immobile");
    await add.getByLabel("Immobile").selectOption({ label: "Appartamento Lavori E2E" });
    await add.getByLabel("Titolo").fill("Garanzia caldaia");
    await add.getByLabel("Fino al", { exact: true }).fill(day(300));
    await add.getByLabel("Intervento collegato").selectOption({ label: "Sostituzione caldaia E2E (Appartamento Lavori E2E)" });
    await add.getByLabel("Crea anche una scadenza alla data di fine").check();
    await add.getByRole("button", { name: "Aggiungi la garanzia" }).click();
    const list = page.getByTestId("warranty-list");
    await expect(list).toContainText("Garanzia caldaia");
    await expect(list).toContainText("In corso");
    await expect(list).toContainText("per «Sostituzione caldaia E2E»");
    await expect(list.getByRole("link", { name: "Apri la scadenza" })).toBeVisible();

    await openWork(page);
    await expect(page.getByRole("heading", { level: 2, name: "Garanzie di questo intervento" })).toBeVisible();

    await page.goto("/manutenzioni?sezione=warranties");
    await list.getByRole("button", { name: /^Archivia/ }).click();
    await expect(page.getByText("Nessuna garanzia.")).toBeVisible();
  });

  test("un piano di ispezione diventa una scadenza ricorrente con la prossima data", async ({ page }) => {
    await page.goto("/manutenzioni?sezione=inspections");
    expect(await a11yViolations(page)).toEqual([]);
    const add = form(page, "Aggiungi un piano di ispezione");
    await add.getByLabel("Immobile").selectOption({ label: "Appartamento Lavori E2E" });
    await add.getByLabel("Titolo").fill("Controllo impianto termico");
    await add.getByLabel("Ogni quanti mesi").fill("0");
    await add.getByLabel("Prima scadenza").fill(day(30));
    await add.getByRole("button", { name: "Aggiungi il piano" }).click();
    await expect(add).toContainText("Almeno 1 mese");
    await add.getByLabel("Ogni quanti mesi").fill("12");
    await add.getByRole("button", { name: "Aggiungi il piano" }).click();
    const list = page.getByTestId("plan-list");
    await expect(list).toContainText("Controllo impianto termico");
    await expect(list).toContainText("ogni 12 mesi");
    await expect(list).toContainText(`Prossima: ${it(day(30))}`);
    await expect(list).toContainText("nessuna eseguita registrata");
    await list.getByRole("button", { name: /^Archivia/ }).click();
    await expect(page.getByText("Nessun piano di ispezione.")).toBeVisible();
  });
});

test.describe("sicurezza degli accessi alle manutenzioni", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("senza sessione le pagine sono chiuse", async ({ page }) => {
    for (const path of ["/manutenzioni", "/manutenzioni/nuovo", "/manutenzioni?sezione=warranties"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/accesso$/);
    }
  });
});
