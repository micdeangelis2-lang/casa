import { expect, test, type Page } from "@playwright/test";
import { Client } from "./support/pg-client";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, clientIp } from "./support/env";
import { STORAGE_STATE } from "./support/secrets";

// Gira prima di registry.spec.ts (ordine alfabetico) e condivide il database: crea i suoi immobili, i suoi contatti e le sue
// scadenze e li rimuove alla fine.
test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(130) } });
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

async function openPolicy(page: Page) {
  await page.goto("/assicurazioni");
  await page.getByTestId("policy-list").getByRole("link", { name: /Polizza casa E2E/ }).click();
  await expect(page).toHaveURL(/\/assicurazioni\/[0-9a-f-]{36}$/);
}

async function openClaim(page: Page) {
  await page.goto("/assicurazioni?sezione=claims");
  await page.getByTestId("claim-list").getByRole("link", { name: /Infiltrazione E2E/ }).click();
  await expect(page).toHaveURL(/\/assicurazioni\/sinistri\/[0-9a-f-]{36}$/);
}

test.beforeAll(async () => {
  await db(async (client) => {
    await client.query(`insert into asset (kind, name, territory_id) select 'dwelling', 'Appartamento Polizza E2E', id from territory where name = 'Comune Alfa'`);
    await client.query(`insert into asset (kind, name, territory_id) select 'other', 'Box Polizza E2E', id from territory where name = 'Comune Alfa'`);
    await client.query("insert into party (display_name, roles) values ('Compagnia E2E', '{insurer}'), ('Perito E2E', '{adjuster}')");
  });
});

test.afterAll(async () => {
  await db(async (client) => {
    await client.query("delete from ins_claim");
    await client.query("delete from ins_policy");
    await client.query("delete from deadline");
    await client.query("delete from asset where name in ('Appartamento Polizza E2E', 'Box Polizza E2E')");
    await client.query("delete from party where display_name in ('Compagnia E2E', 'Perito E2E')");
  });
});

test.describe("assicurazioni", () => {
  test("la voce di menu e' attiva e senza polizze c'e' lo stato vuoto accessibile", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Assicurazioni", exact: true }).click();
    await expect(page).toHaveURL(/\/assicurazioni$/);
    await expect(page.getByText("Nessuna polizza", { exact: true })).toBeVisible();
    await expect(page.getByText(/non interpreta le condizioni di polizza/)).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("si registra una polizza con assicuratore, immobili assicurati e promemoria di rinnovo", async ({ page }) => {
    await page.goto("/assicurazioni/nuova");
    expect(await a11yViolations(page)).toEqual([]);
    await page.getByRole("button", { name: "Salva la polizza" }).click();
    await expect(alert(page)).toContainText("Titolo: campo obbligatorio");

    await page.getByLabel("Titolo", { exact: true }).fill("Polizza casa E2E");
    await page.getByLabel("Numero di polizza").fill("POL-E2E-1");
    await page.getByLabel("Assicuratore (dalla rubrica)").selectOption({ label: "Compagnia E2E" });
    await page.getByLabel("Dal", { exact: true }).fill(day(-60));
    await page.getByLabel("Fino al", { exact: true }).fill(day(120));
    await page.getByLabel("Premio annuo (€)").fill("480,00");
    await page.getByLabel("Appartamento Polizza E2E").check();
    await page.getByLabel("Box Polizza E2E").check();
    await page.getByLabel("Crea anche un promemoria di rinnovo alla data di fine").check();
    await page.getByRole("button", { name: "Salva la polizza" }).click();

    await expect(page).toHaveURL(/\/assicurazioni\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: "Polizza casa E2E" })).toBeVisible();
    await expect(page.getByText("In corso", { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId("policy-assets")).toContainText("Appartamento Polizza E2E");
    await expect(page.getByTestId("policy-assets")).toContainText("Box Polizza E2E");
    await expect(page.getByRole("link", { name: "Apri la scadenza" })).toBeVisible();
    await expect(page.getByText(/non le interpreta e non dice se un evento sia coperto/)).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("le garanzie si copiano a mano dalla polizza", async ({ page }) => {
    await openPolicy(page);
    const add = form(page, "Aggiungi una garanzia");
    await add.getByRole("button", { name: "Aggiungi una garanzia" }).click();
    await expect(add).toContainText("Garanzia: campo obbligatorio");
    await add.getByLabel("Garanzia", { exact: true }).fill("Incendio");
    await add.getByLabel("Somma assicurata (€)").fill("200.000,00");
    await add.getByLabel("Franchigia (€)").fill("250,00");
    await add.getByRole("button", { name: "Aggiungi una garanzia" }).click();
    await expect(page.getByTestId("coverages")).toContainText("Incendio");
    await expect(page.getByTestId("coverages")).toContainText("somma assicurata 200.000,00 €");
    await expect(page.getByTestId("coverages")).toContainText("franchigia 250,00 €");
    await add.getByLabel("Garanzia", { exact: true }).fill("Responsabilità civile");
    await add.getByRole("button", { name: "Aggiungi una garanzia" }).click();
    await page.getByTestId("coverages").getByRole("listitem").filter({ hasText: "Responsabilità civile" }).getByRole("button", { name: /^Togli/ }).click();
    await expect(page.getByTestId("coverages")).not.toContainText("Responsabilità civile");
  });

  test("i premi: uno scaduto non pagato e' segnalato; segnarlo pagato chiude la scadenza", async ({ page }) => {
    await openPolicy(page);
    const add = form(page, "Aggiungi un premio");
    await add.getByLabel("Scadenza", { exact: true }).fill(day(-10));
    await add.getByLabel("Importo (€)").fill("abc");
    await add.getByRole("button", { name: "Aggiungi un premio" }).click();
    await expect(add).toContainText("importo non valido");
    await add.getByLabel("Importo (€)").fill("240,00");
    await add.getByLabel("Crea anche una scadenza").check();
    await add.getByRole("button", { name: "Aggiungi un premio" }).click();
    const premiums = page.getByTestId("premiums");
    await expect(premiums).toContainText(`Scadenza ${it(day(-10))} · 240,00 €`);
    await expect(premiums).toContainText("Scadenza superata");

    await page.goto("/assicurazioni");
    await expect(page.getByTestId("policy-list")).toContainText("premio con scadenza superata");

    await openPolicy(page);
    const row = page.getByTestId("premiums").getByRole("listitem").first();
    await row.locator("summary").click();
    await row.getByLabel("Data del pagamento").fill(day(-1));
    await row.getByRole("button", { name: "Segna come pagato", exact: true }).last().click();
    await expect(row).toContainText(`pagato il ${it(day(-1))}`);
    await expect(row).not.toContainText("Scadenza superata");

    await page.goto("/scadenze?vista=completate");
    await expect(page.getByText("Premio della polizza: Polizza casa E2E").first()).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("un sinistro si apre sulla polizza, con date coerenti e importi scritti dal proprietario", async ({ page }) => {
    await openPolicy(page);
    await page.getByRole("link", { name: "Nuovo sinistro" }).click();
    await expect(page).toHaveURL(/\/assicurazioni\/sinistri\/nuovo\?polizza=[0-9a-f-]{36}$/);
    await expect(page.getByLabel("Polizza", { exact: true })).toHaveValue(/[0-9a-f-]{36}/);
    expect(await a11yViolations(page)).toEqual([]);
    await page.getByRole("button", { name: "Salva il sinistro" }).click();
    await expect(alert(page)).toContainText("Titolo: campo obbligatorio");

    await page.getByLabel("Titolo", { exact: true }).fill("Infiltrazione E2E");
    await page.getByLabel("Immobile", { exact: true }).selectOption({ label: "Appartamento Polizza E2E" });
    await page.getByLabel("Data dell'evento").fill(day(-20));
    await page.getByLabel("Data della denuncia").fill(day(-25));
    await page.getByRole("button", { name: "Salva il sinistro" }).click();
    await expect(alert(page)).toContainText("La data della denuncia è precedente a quella dell'evento");

    await page.getByLabel("Data della denuncia").fill(day(-18));
    await page.getByLabel("Importo richiesto (€)").fill("1.800,00");
    await page.getByLabel("Perito (dalla rubrica)").selectOption({ label: "Perito E2E" });
    await page.getByLabel("Stato", { exact: true }).selectOption("reported");
    await page.getByRole("button", { name: "Salva il sinistro" }).click();

    await expect(page).toHaveURL(/\/assicurazioni\/sinistri\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: "Infiltrazione E2E" })).toBeVisible();
    await expect(page.getByText("Denunciato", { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId("claimed")).toHaveText("1.800,00 €");
    await expect(page.getByText(/non stabilisce se sia coperto né quanto verrà liquidato/)).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("le comunicazioni del sinistro si registrano e si tolgono; lo stato segue e la chiusura compila la data", async ({ page }) => {
    await openClaim(page);
    const add = form(page, "Registra una comunicazione");
    await add.getByRole("button", { name: "Registra una comunicazione" }).click();
    await expect(add).toContainText("Riepilogo: campo obbligatorio");
    await add.getByLabel("Riepilogo").fill("Inviata la denuncia all'assicuratore");
    await add.getByLabel("Tipo").selectOption("sent");
    await add.getByLabel("Data", { exact: true }).fill(day(-18));
    await add.getByRole("button", { name: "Registra una comunicazione" }).click();
    await expect(page.getByTestId("entries")).toContainText("Inviata la denuncia all'assicuratore");
    await expect(page.getByTestId("entries")).toContainText("Inviata");
    await add.getByLabel("Riepilogo").fill("Da togliere");
    await add.getByRole("button", { name: "Registra una comunicazione" }).click();
    await page.getByTestId("entries").getByRole("listitem").filter({ hasText: "Da togliere" }).getByRole("button", { name: /^Togli/ }).click();
    await expect(page.getByTestId("entries")).not.toContainText("Da togliere");

    const status = form(page, "Aggiorna lo stato");
    await status.getByLabel("Stato").selectOption("settled");
    await status.getByRole("button", { name: "Aggiorna lo stato" }).click();
    await expect(page.getByText("Liquidato", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Chiuso il", { exact: true })).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);

    await page.goto("/assicurazioni?sezione=claims");
    await expect(page.getByText("Nessun sinistro aperto.")).toBeVisible();
    await page.getByLabel("Mostra anche i sinistri liquidati o chiusi").check();
    await page.getByRole("button", { name: "Applica" }).click();
    await expect(page.getByTestId("claim-list")).toContainText("Infiltrazione E2E");
  });

  test("archiviare la polizza toglie il promemoria dalle scadenze; ripristinarla lo rimette", async ({ page }) => {
    await openPolicy(page);
    await page.getByRole("button", { name: "Archivia" }).click();
    await expect(page.getByText("Archiviata", { exact: true }).first()).toBeVisible();
    await page.goto("/scadenze");
    await expect(page.getByText("Rinnovo della polizza: Polizza casa E2E")).toHaveCount(0);

    await page.goto("/assicurazioni");
    await expect(page.getByText("Nessuna polizza", { exact: true })).toBeVisible();
    await page.getByLabel("Mostra anche le polizze archiviate").check();
    await page.getByRole("button", { name: "Applica" }).click();
    await page.getByTestId("policy-list").getByRole("link", { name: /Polizza casa E2E/ }).click();
    await page.getByRole("button", { name: "Ripristina" }).click();
    await expect(page.getByRole("button", { name: "Archivia" })).toBeVisible();
    await page.goto("/scadenze?periodo=365");
    await expect(page.getByText("Rinnovo della polizza: Polizza casa E2E").first()).toBeVisible();
  });
});

test.describe("sicurezza degli accessi alle assicurazioni", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("senza sessione le pagine sono chiuse", async ({ page }) => {
    for (const path of ["/assicurazioni", "/assicurazioni/nuova", "/assicurazioni/sinistri/nuovo", "/assicurazioni?sezione=claims"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/accesso$/);
    }
  });
});
