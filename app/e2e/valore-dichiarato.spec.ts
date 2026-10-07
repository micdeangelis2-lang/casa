import { expect, test, type Page } from "@playwright/test";
import { Client } from "./support/pg-client";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, clientIp } from "./support/env";
import { STORAGE_STATE } from "./support/secrets";

// Valore dichiarato del bene e garanzie per singolo bene. Crea i suoi dati («Valore E2E») e li rimuove alla fine.
test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(361) } });
test.describe.configure({ mode: "serial" });

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

let assetA = "";
let policyId = "";

test.beforeAll(async () => {
  await db(async (client) => {
    assetA = (await client.query<{ id: string }>(`insert into asset (kind, name, territory_id) select 'dwelling', 'Casa Valore E2E', id from territory where name = 'Comune Alfa' returning id`)).rows[0]!.id;
    const assetB = (await client.query<{ id: string }>(`insert into asset (kind, name, territory_id) select 'garage', 'Box Valore E2E', id from territory where name = 'Comune Alfa' returning id`)).rows[0]!.id;
    policyId = (await client.query<{ id: string }>("insert into ins_policy (title) values ('Polizza Valore E2E') returning id")).rows[0]!.id;
    await client.query("insert into ins_policy_asset (policy_id, asset_id) values ($1, $2), ($1, $3)", [policyId, assetA, assetB]);
  });
});

test.afterAll(async () => {
  await db(async (client) => {
    await client.query("delete from ins_policy where title = 'Polizza Valore E2E'");
    await client.query("delete from asset where name in ('Casa Valore E2E', 'Box Valore E2E')");
  });
});

test.describe("valore dichiarato e garanzie per bene", () => {
  test("il valore dichiarato e' facoltativo, non negativo e si puo' togliere", async ({ page }) => {
    await page.goto(`/immobili/${assetA}`);
    await expect(page.getByTestId("declared-value")).toHaveText("Nessun valore dichiarato.");
    const f = form(page, "Salva il valore dichiarato");
    await f.getByLabel("Valore dichiarato (€)").fill("-5");
    await f.getByRole("button", { name: "Salva il valore dichiarato" }).click();
    await expect(f).toContainText("Valore dichiarato: importo non valido");
    await expect(page.getByTestId("declared-value")).toHaveText("Nessun valore dichiarato.");
    await f.getByLabel("Valore dichiarato (€)").fill("120.000,00");
    await f.getByRole("button", { name: "Salva il valore dichiarato" }).click();
    await expect(page.getByTestId("declared-value")).toHaveText("120.000,00 €");
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("una garanzia puo' riguardare un solo bene della polizza; polizze per immobile mostra valore e garanzie del bene", async ({ page }) => {
    await page.goto(`/assicurazioni/${policyId}`);
    const add = form(page, "Aggiungi una garanzia");
    await add.getByLabel("Garanzia", { exact: true }).fill("Furto E2E");
    await add.getByLabel("Immobile della garanzia (facoltativo)").selectOption({ label: "Casa Valore E2E" });
    await add.getByLabel("Somma assicurata (€)").fill("20.000,00");
    await add.getByRole("button", { name: "Aggiungi una garanzia" }).click();
    await expect(page.getByTestId("coverages")).toContainText("Furto E2E");
    await expect(page.getByTestId("coverages")).toContainText("Casa Valore E2E");
    await add.getByLabel("Garanzia", { exact: true }).fill("Responsabilita E2E");
    await add.getByRole("button", { name: "Aggiungi una garanzia" }).click();
    await expect(page.getByTestId("coverages")).toContainText("Responsabilita E2E");

    await page.goto("/assicurazioni/per-immobile");
    const list = page.getByTestId("by-asset-list");
    const casa = list.locator("li[data-status]").filter({ hasText: "Casa Valore E2E" });
    await expect(casa).toContainText("Valore dichiarato da te: 120.000,00 €");
    await expect(casa).toContainText("Furto E2E");
    await expect(casa).toContainText("Responsabilita E2E");
    const box = list.locator("li[data-status]").filter({ hasText: "Box Valore E2E" });
    await expect(box).toContainText("Nessun valore dichiarato");
    await expect(box).not.toContainText("Furto E2E");
    await expect(box).toContainText("Responsabilita E2E");
    expect(await a11yViolations(page)).toEqual([]);
  });
});
