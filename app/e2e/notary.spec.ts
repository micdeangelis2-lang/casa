import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { conclusiveClaims } from "../tests/helpers/neutral";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, clientIp } from "./support/env";
import { STORAGE_STATE } from "./support/secrets";

test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(305) } });
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

let assetId = "";
let boxId = "";

test.beforeAll(async () => {
  await db(async (client) => {
    const q = async (sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows[0]?.id as string;
    assetId = await q(`insert into asset (kind, name, territory_id, address) select 'dwelling', 'Appartamento Notaio E2E', id, 'Via Prova 3' from territory where name = 'Comune Alfa' returning id`);
    boxId = await q(`insert into asset (kind, name, territory_id) select 'box', 'Box Notaio E2E', id from territory where name = 'Comune Alfa' returning id`);
    const holder = await q(`insert into party (display_name, roles) values ('Titolare Notaio E2E', '{}') returning id`);
    await q(`insert into party (display_name, roles) values ('Notaio Prova E2E', '{notary}') returning id`);
    await q(`insert into ownership_right (asset_id, holder_party_id, right_type, quota_numerator, quota_denominator, notes) values ($1, $2, 'co_ownership', 1, 2, 'Per successione') returning id`, [assetId, holder]);
    await q(`insert into cadastral_record (asset_id, sheet, parcel, subunit, cadastral_category, valid_to) values ($1, '5', '120', '7', 'A/2', '2018-12-31') returning id`, [assetId]);
    await q(`insert into cadastral_record (asset_id, sheet, parcel, valid_from) values ($1, '5', '120', '2019-01-01') returning id`, [assetId]);
    await q(`insert into asset_link (ancillary_asset_id, main_asset_id, declared_basis) values ($1, $2, 'stesso atto') returning id`, [boxId, assetId]);
  });
});

test.afterAll(async () => {
  await db(async (client) => {
    await client.query("delete from asset where name in ('Appartamento Notaio E2E', 'Box Notaio E2E')");
    await client.query("delete from party where display_name in ('Titolare Notaio E2E', 'Notaio Prova E2E')");
  });
});

test.describe("scheda dell'immobile per il notaio", () => {
  test("dalla pagina del bene si apre la scheda con titolari, catasto a storico, pertinenze e lacune", async ({ page }) => {
    await page.goto(`/immobili/${assetId}`);
    await page.getByRole("link", { name: "Scheda per il notaio" }).click();
    await expect(page).toHaveURL(new RegExp(`/immobili/${assetId}/notaio$`));
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Appartamento Notaio E2E");

    await expect(page.getByTestId("notary-holders")).toContainText("Titolare Notaio E2E");
    await expect(page.getByTestId("notary-holders")).toContainText("Per successione");
    await expect(page.getByTestId("notary-quota-totals")).toContainText("1/2");
    await expect(page.getByTestId("notary-cadastral")).toContainText("Foglio 5");
    await expect(page.getByTestId("notary-cadastral-history")).toContainText("A/2");
    await expect(page.getByTestId("notary-related")).toContainText("Box Notaio E2E");
    await expect(page.getByTestId("notary-encumbrances-empty")).toBeVisible();

    const gaps = page.getByTestId("notary-gaps");
    await expect(gaps).toContainText("sommano 1/2");
    await expect(gaps).toContainText("Per Titolare Notaio E2E non risultano in rubrica: codice fiscale o partita IVA, indirizzo");
    await expect(gaps).toContainText("non risultano: subalterno");
    await expect(gaps).toContainText("Per la pertinenza «Box Notaio E2E» non è registrato nessun titolare");

    expect(conclusiveClaims(await page.locator("body").innerText())).toEqual([]);
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("il pacchetto per il notaio parte con destinatario, nome dalla rubrica e documenti del bene già impostati", async ({ page }) => {
    await page.goto(`/immobili/${assetId}/notaio`);
    await page.getByLabel("Notaio in rubrica (facoltativo)").selectOption({ label: "Notaio Prova E2E" });
    await page.getByRole("button", { name: "Applica" }).click();
    await expect(page.getByText("Preparata per: Notaio Prova E2E")).toBeVisible();
    await page.getByRole("link", { name: "Prepara il pacchetto" }).click();
    await expect(page).toHaveURL(/\/condivisione\/nuovo\?/);
    await expect(page.getByLabel("Nome del destinatario")).toHaveValue("Notaio Prova E2E");
    await expect(page.getByLabel("Tipo di destinatario")).toHaveValue("notary");
  });

  test("a 390 px la scheda è accessibile e un identificativo non valido dà 404", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(`/immobili/${assetId}/notaio`);
    await expect(page.getByTestId("notary-gaps")).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);
    const res = await page.goto("/immobili/non-valido/notaio");
    expect(res?.status()).toBe(404);
  });
});
