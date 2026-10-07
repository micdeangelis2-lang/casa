import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, clientIp } from "./support/env";
import { STORAGE_STATE } from "./support/secrets";

// Il registro e' append-only (nemmeno questo file puo' toglierne le righe): si aggiungono righe di prova di un'area propria,
// «auditpager», cosi' da leggere la paginazione senza dipendere da quante righe lasciano gli altri file. Il database degli
// e2e e' in memoria e sparisce a fine esecuzione.
test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(230) } });
test.describe.configure({ mode: "serial" });

const ROWS = 55;

async function db<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

test.beforeAll(async () => {
  await db((client) =>
    client.query(`insert into audit_log (actor_type, actor_id, action, entity_type, entity_id, diff) select 'system', 'e2e', 'auditpager.prova', 'auditpager', 'riga-' || lpad(g::text, 3, '0'), '{"count":1}'::jsonb from generate_series(1, ${ROWS}) g`),
  );
});

test.describe("registro delle modifiche", () => {
  test("si apre dalle impostazioni, mostra l'ultima riga e la verifica ricalcola la catena", async ({ page }) => {
    await page.goto("/impostazioni");
    await page.getByRole("link", { name: /Registro delle modifiche/ }).click();
    await expect(page).toHaveURL(/\/impostazioni\/registro$/);
    await expect(page.getByRole("heading", { level: 1, name: "Registro delle modifiche" })).toBeVisible();
    await expect(page.getByTestId("audit-head")).toHaveText(/[0-9a-f]{64}/);
    await expect(page.getByTestId("audit-verification")).toHaveCount(0);

    await page.getByRole("button", { name: "Verifica ora" }).click();
    await expect(page.getByTestId("audit-verification")).toContainText("non ha trovato anomalie");
    await expect(page.getByTestId("audit-verification")).toContainText(/ricalcolato la catena di [\d.]+ righe/);
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("si filtra per area e si legge a pagine, dalla riga piu' recente", async ({ page }) => {
    await page.goto("/impostazioni/registro");
    await page.getByLabel("Area").selectOption("auditpager");
    await page.getByRole("button", { name: "Filtra", exact: true }).click();
    await expect(page).toHaveURL(/area=auditpager$/);
    await expect(page.getByTestId("pager-summary")).toHaveText(`${ROWS} righe · pagina 1 di 2`);
    const table = page.getByTestId("audit-table");
    await expect(table.getByRole("row")).toHaveCount(51); // intestazione + 50 righe
    await expect(table.getByRole("row").nth(1)).toContainText("riga-055");
    await expect(table.getByRole("row").nth(1)).toContainText("auditpager.prova");
    await expect(table.getByRole("row").nth(1)).toContainText("count: 1");

    await page.getByRole("link", { name: "Pagina successiva" }).click();
    await expect(page).toHaveURL(/area=auditpager&pagina=2$/);
    await expect(page.getByTestId("pager-summary")).toHaveText(`${ROWS} righe · pagina 2 di 2`);
    await expect(table.getByRole("row")).toHaveCount(ROWS - 50 + 1);
    await expect(table.getByRole("row").last()).toContainText("riga-001");
    await expect(page.getByRole("link", { name: "Pagina successiva" })).toHaveCount(0);
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("un'area sconosciuta o una pagina fuori misura non rompono la pagina", async ({ page }) => {
    await page.goto("/impostazioni/registro?area=inesistente&pagina=99999");
    await expect(page.getByRole("heading", { level: 1, name: "Registro delle modifiche" })).toBeVisible();
    await page.goto("/impostazioni/registro?area=auditpager&pagina=99999");
    await expect(page.getByTestId("pager-summary")).toHaveText(`${ROWS} righe · pagina 2 di 2`);
  });
});

test.describe("registro senza sessione", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("la pagina e' chiusa", async ({ page }) => {
    await page.goto("/impostazioni/registro");
    await expect(page).toHaveURL(/\/accesso$/);
  });
});
