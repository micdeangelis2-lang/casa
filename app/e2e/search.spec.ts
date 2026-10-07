import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, clientIp } from "./support/env";
import { STORAGE_STATE } from "./support/secrets";

test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(210) } });
test.describe.configure({ mode: "serial" });

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
  await db(async (client) => {
    await client.query(`insert into asset (kind, name, territory_id) select 'dwelling', 'Villa Ricercabile E2E', id from territory where name = 'Comune Alfa'`);
    await client.query("insert into party (display_name, roles) values ('Società Ricercabile E2E', '{supplier}')");
  });
});

test.afterAll(async () => {
  await db(async (client) => {
    await client.query("delete from asset where name = 'Villa Ricercabile E2E'");
    await client.query("delete from party where display_name = 'Società Ricercabile E2E'");
  });
});

test.describe("ricerca globale", () => {
  test("dalla casella in alto si cerca in tutta l'app, senza badare a maiuscole e accenti, e si apre il risultato", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("search", { name: "Ricerca rapida in tutta l'app" }).getByRole("searchbox").fill("RICERCABILE societa");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/cerca\?q=RICERCABILE\+societa$/);
    await expect(page.getByTestId("group-parties")).toContainText("Società Ricercabile E2E");
    await expect(page.getByTestId("group-assets")).toHaveCount(0);

    await page.getByRole("searchbox", { name: "Cerca in tutta l'app" }).fill("ricercabile");
    await page.getByRole("button", { name: "Cerca", exact: true }).click();
    await expect(page.getByTestId("search-summary")).toHaveText("2 risultati per «ricercabile»");
    await expect(page.getByTestId("group-assets")).toContainText("Villa Ricercabile E2E");
    expect(await a11yViolations(page)).toEqual([]);

    await page.getByTestId("group-assets").getByRole("link", { name: /Villa Ricercabile E2E/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Villa Ricercabile E2E" })).toBeVisible();
  });

  test("un testo troppo corto o senza risultati lo dice", async ({ page }) => {
    await page.goto("/cerca?q=a");
    await expect(page.getByText("Scrivi almeno 2 caratteri.")).toBeVisible();
    await page.goto("/cerca?q=zzzzzzzz");
    await expect(page.getByTestId("search-empty")).toHaveText("Nessun risultato per «zzzzzzzz».");
    await page.goto("/cerca");
    await expect(page.getByRole("heading", { level: 1, name: "Cerca" })).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);
  });
});

test.describe("ricerca senza sessione", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("la pagina e' chiusa e non rivela nulla", async ({ page }) => {
    await page.goto("/cerca?q=ricercabile");
    await expect(page).toHaveURL(/\/accesso$/);
  });
});
