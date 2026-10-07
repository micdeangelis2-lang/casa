import { expect, test } from "@playwright/test";
import { Client } from "./support/pg-client";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, clientIp } from "./support/env";
import { STORAGE_STATE } from "./support/secrets";

test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(341) } });
test.describe.configure({ mode: "serial" });

const ASSET = "Casa impianti registrati E2E";
const MAINTAINER = "Manutentore Impianti E2E";
const PLANT = "Caldaia E2E registrata";
const PLAN = "Controllo periodico E2E";
let assetId = "";

async function sql<T = unknown>(text: string, values: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(text, values)).rows as T[];
  } finally {
    await client.end();
  }
}

async function cleanup() {
  await sql("delete from asset where name = $1", [ASSET]);
  await sql("delete from party where display_name = $1", [MAINTAINER]);
}

test.beforeAll(async () => {
  await cleanup();
  assetId = (await sql<{ id: string }>("insert into asset (kind, name, territory_id) select 'dwelling', $1, id from territory where name = 'Comune Alfa' returning id", [ASSET]))[0]!.id;
  await sql("insert into party (display_name) values ($1)", [MAINTAINER]);
  await sql("insert into maint_inspection_plan (asset_id, title, interval_months, first_due_on) values ($1, $2, 12, '2099-01-01')", [assetId, PLAN]);
});

test.afterAll(cleanup);

test.describe("impianti registrati", () => {
  test("si registra un impianto e il registro lo mostra con i suoi dati", async ({ page }) => {
    await page.goto(`/manutenzioni/impianti/nuovo?immobile=${assetId}`);
    await page.getByLabel("Tipo di impianto").selectOption("heating");
    await page.getByLabel("Nome dell'impianto").fill(PLANT);
    await page.getByLabel("Data di installazione").fill("2020-05-04");
    await page.getByLabel("Manutentore").selectOption({ label: MAINTAINER });
    await page.getByLabel("Matricola").fill("MAT-E2E-42");
    await page.getByRole("button", { name: "Registra l'impianto" }).click();
    await expect(page.getByRole("heading", { level: 1, name: PLANT })).toBeVisible();
    await expect(page.getByTestId("plant-facts")).toContainText("matricola MAT-E2E-42");
    await expect(page.getByTestId("plant-facts")).toContainText(`manutentore ${MAINTAINER}`);
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("si collega una verifica periodica esistente, che passa nel gruppo dell'impianto", async ({ page }) => {
    await page.goto("/manutenzioni/impianti?immobile=" + assetId);
    const before = page.getByTestId("plant-list").locator(":scope > li").filter({ hasText: PLAN });
    await expect(before).toHaveCount(1);
    await expect(before).not.toContainText(PLANT);

    await page.getByRole("link", { name: "Apri l'impianto" }).first().click();
    const form = page.getByRole("form", { name: /Collega ciò che è già registrato: Verifica periodica/ });
    await form.getByLabel("Verifica periodica").selectOption({ label: PLAN });
    await form.getByRole("button", { name: "Collega all'impianto" }).click();
    await expect(page.getByTestId("plant-links")).toContainText(PLAN);

    await page.goto("/manutenzioni/impianti?immobile=" + assetId);
    const group = page.getByTestId("plant-list").locator(":scope > li").filter({ hasText: PLANT });
    await expect(group).toContainText(PLAN);
    await expect(group).toContainText("matricola MAT-E2E-42");
    expect(await a11yViolations(page)).toEqual([]);
    await page.setViewportSize({ width: 390, height: 800 });
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("si archivia l'impianto: sparisce dal registro e la verifica torna al ripiego", async ({ page }) => {
    await page.goto("/manutenzioni/impianti?immobile=" + assetId);
    await page.getByRole("link", { name: "Apri l'impianto" }).first().click();
    await page.getByRole("button", { name: "Archivia" }).click();
    await expect(page.getByText("Impianto archiviato: non compare nel registro.")).toBeVisible();
    await page.goto("/manutenzioni/impianti?immobile=" + assetId);
    await expect(page.getByTestId("plant-list")).not.toContainText(PLANT);
    await expect(page.getByTestId("plant-list")).toContainText(PLAN);
  });

  test("un impianto inesistente da pagina non trovata", async ({ page }) => {
    const response = await page.goto("/manutenzioni/impianti/00000000-0000-4000-8000-000000000000");
    expect(response?.status()).toBe(404);
  });
});
