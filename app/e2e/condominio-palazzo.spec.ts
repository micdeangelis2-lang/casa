import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, clientIp } from "./support/env";
import { STORAGE_STATE } from "./support/secrets";

test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(342) } });
test.describe.configure({ mode: "serial" });

const CONDO = "Condominio palazzo E2E";
const ASSET = "Unità palazzo E2E";
const form = (page: Page, name: string) => page.getByRole("form", { name, exact: true });
let condoId = "";

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
  await sql("delete from condominium where name = $1", [CONDO]);
  await sql("delete from asset where name = $1", [ASSET]);
}

test.beforeAll(async () => {
  await cleanup();
  const assetId = (await sql<{ id: string }>("insert into asset (kind, name, territory_id) select 'dwelling', $1, id from territory where name = 'Comune Alfa' returning id", [ASSET]))[0]!.id;
  condoId = (await sql<{ id: string }>("insert into condominium (name) values ($1) returning id", [CONDO]))[0]!.id;
  await sql("insert into condo_membership (condominium_id, asset_id) values ($1, $2)", [condoId, assetId]);
  const tableId = (await sql<{ id: string }>("insert into millesimal_table (condominium_id, name) values ($1, 'Generale E2E') returning id", [condoId]))[0]!.id;
  await sql("insert into millesimal_share (table_id, asset_id, value) values ($1, $2, '500.0000')", [tableId, assetId]);
  await sql("insert into condo_fiscal_year (condominium_id, label, starts_on, ends_on) values ($1, '2099', '2099-01-01', '2099-12-31')", [condoId]);
});

test.afterAll(cleanup);

test.describe("preventivo del palazzo", () => {
  test("i millesimi degli altri si registrano nella tabella", async ({ page }) => {
    await page.goto(`/condominio/${condoId}?sezione=millesimi`);
    const others = form(page, "Millesimi degli altri condomini");
    await others.getByLabel("Voce 1: nome").fill("Altri condomini");
    await others.getByLabel("Voce 1: millesimi").fill("700");
    await others.getByRole("button", { name: "Salva i millesimi degli altri" }).click();
    await expect(page.getByTestId("others-total")).toHaveText("Altri condomini: 700");
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("un valore non valido dei millesimi degli altri viene rifiutato accanto al campo", async ({ page }) => {
    await page.goto(`/condominio/${condoId}?sezione=millesimi`);
    const others = form(page, "Millesimi degli altri condomini");
    await others.getByLabel("Voce 2: nome").fill("Negozi");
    await others.getByLabel("Voce 2: millesimi").fill("molti");
    await others.getByRole("button", { name: "Salva i millesimi degli altri" }).click();
    await expect(others).toContainText(/millesimi non validi/i);
    await expect(page.getByTestId("others-total")).toHaveText("Altri condomini: 700");
  });

  test("un preventivo del palazzo si divide per il totale del palazzo: al proprietario spetta solo la sua parte", async ({ page }) => {
    await page.goto(`/condominio/${condoId}?sezione=esercizi`);
    const budget = form(page, "Aggiungi il preventivo");
    await budget.getByLabel("Titolo").fill("Preventivo del palazzo E2E");
    await budget.getByLabel("Importo totale (€)").fill("1.000,00");
    await budget.getByLabel("Tabella millesimale per la ripartizione").selectOption({ label: "Generale E2E" });
    await budget.getByLabel("Di chi è l'importo totale").selectOption("building");
    await budget.getByRole("button", { name: "Aggiungi il preventivo" }).click();
    const card = page.getByTestId("budget");
    await expect(card).toContainText("Importo del palazzo");

    const plan = form(page, "Calcola le rate");
    await plan.getByLabel("Numero di rate").fill("2");
    await plan.getByLabel("Prima scadenza").fill("2099-03-01");
    await plan.getByLabel("Ogni quanti mesi").fill("6");
    await plan.getByRole("button", { name: "Calcola le rate" }).click();
    // 500 su 1200 (500 del proprietario + 700 degli altri) di 1.000,00 € = 416,67 € in 2 rate.
    await expect(card).toContainText("Rate: 0,00 € pagati su 416,67 €");
    expect(await a11yViolations(page)).toEqual([]);
  });
});
