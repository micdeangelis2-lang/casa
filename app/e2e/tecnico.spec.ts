import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, clientIp } from "./support/env";
import { STORAGE_STATE } from "./support/secrets";

test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(310) } });
test.describe.configure({ mode: "serial" });

const NAME = "Appartamento Tecnico E2E";
let assetId = "";

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
    assetId = (await client.query(`insert into asset (kind, name, territory_id, attributes) select 'dwelling', $1, id, '{"anno_costruzione": 1975}'::jsonb from territory where name = 'Comune Alfa' returning id`, [NAME])).rows[0].id as string;
    await client.query("insert into cadastral_record (asset_id, sheet, parcel, subunit, cadastral_category, valid_from) values ($1, '10', '20', '3', 'A/3', '2015-01-01')", [assetId]);
    const work = (await client.query("insert into maint_work (asset_id, title, status, completed_on) values ($1, 'Rifacimento tetto E2E', 'completed', '2024-09-30') returning id", [assetId])).rows[0].id as string;
    await client.query("insert into maint_invoice (work_id, issued_on, amount_cents, paid_on) values ($1, '2024-10-01', 100000, '2024-10-15')", [work]);
    const matter = (await client.query("insert into matter (title, asset_id, status, opened_on) values ('Rilievo E2E', $1, 'open', '2026-01-10') returning id", [assetId])).rows[0].id as string;
    await client.query("insert into matter_document_request (matter_id, title, status, requested_on, due_on) values ($1, 'Planimetria E2E', 'requested', '2026-01-10', '2099-01-01')", [matter]);
  });
});

test.afterAll(async () => {
  await db(async (client) => {
    await client.query("delete from matter where title = 'Rilievo E2E'");
    await client.query("delete from maint_work where title = 'Rifacimento tetto E2E'");
    await client.query("delete from asset where name = $1", [NAME]);
  });
});

test.describe("scheda per il tecnico", () => {
  test("dalla scheda dell'immobile si apre la scheda con dati, catasto, interventi e pratiche, accessibile", async ({ page }) => {
    await page.goto(`/immobili/${assetId}`);
    await page.getByRole("link", { name: "Scheda per il tecnico", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/immobili/${assetId}/scheda-tecnica$`));
    await expect(page.getByRole("heading", { level: 1, name: "Scheda per il tecnico" })).toBeVisible();
    await expect(page.getByText(/Non attesta la conformità edilizia, urbanistica o catastale/)).toBeVisible();

    await expect(page.getByTestId("brief-attributes")).toContainText("anno_costruzione");
    await expect(page.getByTestId("brief-attributes")).toContainText("1975");
    await expect(page.getByTestId("brief-cadastral")).toContainText("A/3");
    await expect(page.getByTestId("brief-works")).toContainText("Rifacimento tetto E2E");
    await expect(page.getByTestId("brief-total-invoiced")).toHaveText("1.000,00 €");
    await expect(page.getByTestId("brief-total-paid")).toHaveText("1.000,00 €");
    await expect(page.getByTestId("brief-matters")).toContainText("Rilievo E2E");
    await expect(page.getByTestId("brief-matters")).toContainText("Planimetria E2E");
    await expect(page.getByTestId("brief-empty-categories")).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("il pacchetto per il tecnico si apre con le categorie tecniche e l'immobile già scelti", async ({ page }) => {
    await page.goto(`/immobili/${assetId}/scheda-tecnica`);
    await page.getByRole("link", { name: "Prepara un pacchetto di documenti per il tecnico" }).click();
    await expect(page).toHaveURL(/\/condivisione\/nuovo\?.*mostra=1/);
    await expect(page.getByLabel(NAME)).toBeChecked();
    await expect(page.getByLabel(/^Catasto/)).toBeChecked();
    await expect(page.getByLabel(/^Tributi/)).not.toBeChecked();
  });

  test("il CSV si scarica con la sessione; senza sessione 401; un indirizzo non valido 404", async ({ page, request, playwright }) => {
    await page.goto(`/immobili/${assetId}/scheda-tecnica`);
    await expect(page.getByRole("link", { name: "Scarica il CSV" })).toHaveAttribute("href", `/api/immobili/${assetId}/scheda-tecnica`);
    const response = await request.get(`/api/immobili/${assetId}/scheda-tecnica`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/csv");
    expect(response.headers()["cache-control"]).toContain("no-store");
    const body = await response.text();
    expect(body).toContain("Rifacimento tetto E2E");
    expect(body).toContain("Rilievo E2E");

    expect((await request.get("/api/immobili/non-un-uuid/scheda-tecnica")).status()).toBe(404);
    const anonymous = await playwright.request.newContext({ baseURL: page.url().split("/immobili")[0], storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { "x-real-ip": clientIp(311) } });
    expect((await anonymous.get(`/api/immobili/${assetId}/scheda-tecnica`)).status()).toBe(401);
    await anonymous.dispose();
  });

  test("un immobile che non esiste risponde 404", async ({ page }) => {
    const response = await page.goto("/immobili/00000000-0000-4000-8000-000000000000/scheda-tecnica");
    expect(response?.status()).toBe(404);
  });
});
