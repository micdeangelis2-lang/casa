import { expect, test } from "@playwright/test";
import { Client } from "./support/pg-client";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, clientIp } from "./support/env";
import { STORAGE_STATE } from "./support/secrets";

// Registro impianti: crea un immobile, un manutentore, un piano di ispezione e una garanzia e li rimuove alla fine.
test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(315) } });
test.describe.configure({ mode: "serial" });

const ASSET = "Casa Impianti E2E";
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
  await db(async (c) => {
    assetId = (await c.query(`insert into asset (kind, name, territory_id) select 'dwelling', $1, id from territory where name = 'Comune Alfa' returning id`, [ASSET])).rows[0].id;
    const party = (await c.query(`insert into party (display_name, roles) values ('Manutentore Impianti E2E', '{supplier}') returning id`)).rows[0].id;
    await c.query(`insert into maint_inspection_plan (asset_id, title, interval_months, first_due_on, supplier_party_id) values ($1, 'Controllo caldaia E2E', 12, current_date + 10, $2)`, [assetId, party]);
    await c.query(`insert into maint_warranty (asset_id, title, ends_on, supplier_party_id) values ($1, 'Garanzia caldaia E2E', current_date + 500, $2)`, [assetId, party]);
  });
});

test.afterAll(async () => {
  await db(async (c) => {
    await c.query("delete from maint_inspection_plan where asset_id = $1", [assetId]);
    await c.query("delete from maint_warranty where asset_id = $1", [assetId]);
    await c.query("delete from asset where id = $1", [assetId]);
    await c.query("delete from party where display_name = 'Manutentore Impianti E2E'");
  });
});

test("il registro mostra l'impianto con manutentore, verifica e garanzia", async ({ page }) => {
  await page.goto("/manutenzioni");
  await page.getByRole("link", { name: "Registro impianti" }).click();
  await expect(page).toHaveURL(/\/manutenzioni\/impianti/);
  const card = page.getByTestId("plant-list").getByRole("listitem").filter({ hasText: ASSET });
  await expect(card.getByRole("heading", { name: "Termico e caldaia" })).toBeVisible();
  await expect(card).toContainText("Manutentore Impianti E2E");
  await expect(card).toContainText("Controllo caldaia E2E");
  await expect(card).toContainText("Garanzia caldaia E2E");
  expect(await a11yViolations(page)).toEqual([]);
});

test("la vista per scadenza elenca le date e il filtro per tipo le nasconde", async ({ page }) => {
  await page.goto(`/manutenzioni/impianti?vista=scadenza&immobile=${assetId}`);
  const rows = page.getByTestId("plant-due").locator("tbody tr");
  await expect(rows).toHaveCount(1); // il piano inserito a mano non ha una scadenza collegata: la prossima verifica viene dalle Scadenze
  await expect(rows.first()).toContainText("Fine garanzia");
  expect(await a11yViolations(page)).toEqual([]);
  await page.goto(`/manutenzioni/impianti?immobile=${assetId}&tipo=lift`);
  await expect(page.getByTestId("plant-empty")).toBeVisible();
});

test("la scheda per il tecnico ha gli spazi da compilare", async ({ page }) => {
  await page.goto(`/manutenzioni/impianti/scheda?immobile=${assetId}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(ASSET);
  await expect(page.getByText("Esito indicato dal tecnico").first()).toBeVisible();
  await expect(page.getByText("Nome e firma del tecnico").first()).toBeVisible();
  expect(await a11yViolations(page)).toEqual([]);
});
