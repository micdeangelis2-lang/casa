import { expect, test } from "@playwright/test";
import { Client } from "./support/pg-client";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, clientIp } from "./support/env";
import { STORAGE_STATE } from "./support/secrets";

// I movimenti si inseriscono direttamente nel database con un anno passato (2024), cosi' non si mescolano con quelli di altri file
// di test, e si rimuovono alla fine.
test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(190) } });
test.describe.configure({ mode: "serial" });

const YEAR = 2024;

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
    const asset = (await client.query(`insert into asset (kind, name, territory_id) select 'dwelling', 'Appartamento Economia E2E', id from territory where name = 'Comune Alfa' returning id`)).rows[0].id as string;
    const type = (await client.query("insert into tax_type (name) values ('Imposta Economia E2E') returning id")).rows[0].id as string;
    const obligation = (await client.query("insert into tax_obligation (asset_id, tax_type_id, year, label) values ($1, $2, $3, 'Saldo') returning id", [asset, type, YEAR])).rows[0].id as string;
    await client.query("insert into tax_payment (obligation_id, paid_on, amount_cents) values ($1, $2, 20000)", [obligation, `${YEAR}-03-10`]);
    const work = (await client.query("insert into maint_work (asset_id, title) values ($1, 'Lavoro Economia E2E') returning id", [asset])).rows[0].id as string;
    await client.query("insert into maint_invoice (work_id, issued_on, amount_cents, paid_on) values ($1, $2, 100000, $3)", [work, `${YEAR}-05-01`, `${YEAR}-05-05`]);
    const letting = (await client.query("insert into letting (asset_id, type, title) values ($1, 'residential', 'Locazione Economia E2E') returning id", [asset])).rows[0].id as string;
    await client.query("insert into letting_rent (letting_id, due_on, amount_cents, paid_on, paid_cents) values ($1, $2, 65000, $3, 65000)", [letting, `${YEAR}-06-01`, `${YEAR}-06-05`]);
  });
});

test.afterAll(async () => {
  await db(async (client) => {
    await client.query("delete from letting");
    await client.query("delete from maint_work");
    await client.query("delete from tax_obligation");
    await client.query("delete from tax_type");
    await client.query("delete from asset where name = 'Appartamento Economia E2E'");
  });
});

test.describe("quadro economico", () => {
  test("la voce di menu e' attiva e il quadro somma solo i pagamenti registrati nell'anno, con l'avvertenza", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Quadro economico", exact: true }).click();
    await expect(page).toHaveURL(/\/economia$/);
    await expect(page.getByText(/Non è un bilancio né una dichiarazione/)).toBeVisible();

    await page.goto(`/economia?anno=${YEAR}`);
    const row = page.getByTestId("economy-table").getByRole("row").filter({ hasText: "Appartamento Economia E2E" });
    await expect(row).toContainText("200,00 €");
    await expect(row).toContainText("1.000,00 €");
    await expect(row).toContainText("1.200,00 €");
    await expect(row).toContainText("650,00 €");
    await expect(row).toContainText("-550,00 €");
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("i movimenti sono elencati per data con il collegamento alla scheda di origine", async ({ page }) => {
    await page.goto(`/economia?anno=${YEAR}`);
    const entries = page.getByTestId("economy-entries");
    await expect(entries.getByRole("row")).toHaveCount(4); // intestazione + 3 movimenti
    await expect(entries.getByRole("link", { name: "Imposta Economia E2E 2024 – Saldo" })).toHaveAttribute("href", /\/tributi\/[0-9a-f-]{36}$/);
    await expect(entries.getByRole("link", { name: "Lavoro Economia E2E" })).toHaveAttribute("href", /\/manutenzioni\/[0-9a-f-]{36}$/);
    await expect(entries.getByRole("link", { name: "Locazione Economia E2E" })).toHaveAttribute("href", /\/locazioni\/[0-9a-f-]{36}$/);
    await entries.getByRole("link", { name: "Lavoro Economia E2E" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Lavoro Economia E2E" })).toBeVisible();
  });

  test("con un immobile scelto e con un anno senza movimenti il quadro lo dice", async ({ page }) => {
    await page.goto(`/economia?anno=${YEAR}`);
    await page.getByLabel("Immobile", { exact: true }).selectOption({ label: "Appartamento Economia E2E" });
    await page.getByRole("button", { name: "Mostra" }).click();
    await expect(page.getByTestId("total-costs")).toHaveText("1.200,00 €");
    await expect(page.getByTestId("total-income")).toHaveText("650,00 €");

    await page.goto("/economia?anno=1999");
    await expect(page.getByText("Nessun pagamento o incasso registrato nel 1999.")).toBeVisible();
  });

  test("il CSV si scarica con la sessione, ha le tabelle e rifiuta un anno non valido", async ({ page, request }) => {
    await page.goto(`/economia?anno=${YEAR}`);
    await expect(page.getByRole("link", { name: "Scarica il CSV" })).toHaveAttribute("href", `/api/economia?anno=${YEAR}`);
    const response = await request.get(`/api/economia?anno=${YEAR}`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/csv");
    expect(response.headers()["content-disposition"]).toContain(`quadro-economico-${YEAR}.csv`);
    const body = await response.text();
    expect(body.charCodeAt(0)).toBe(0xfeff);
    expect(body).toContain(`Quadro economico ${YEAR}`);
    expect(body).toContain("Appartamento Economia E2E;200;0;1000;0;1200;650;-550");
    expect(body).toContain("Lavoro Economia E2E");
    expect((await request.get("/api/economia?anno=ieri")).status()).toBe(400);
  });
});

test.describe("quadro economico senza sessione", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("la pagina e il CSV sono chiusi", async ({ page, request }) => {
    await page.goto("/economia");
    await expect(page).toHaveURL(/\/accesso$/);
    const response = await request.get(`/api/economia?anno=${YEAR}`);
    expect(response.status()).toBe(401);
    expect(await response.text()).not.toContain("Economia E2E");
  });
});
