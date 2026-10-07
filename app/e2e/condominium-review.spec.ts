import { expect, test } from "@playwright/test";
import { Client } from "./support/pg-client";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, clientIp } from "./support/env";
import { STORAGE_STATE } from "./support/secrets";

// Viste «Controllo con l'amministratore». I dati si inseriscono con date passate fisse e si rimuovono alla fine
// (condominium.spec.ts, che viene dopo, parte dallo stato vuoto).
test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(290) } });
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
    const asset = (await client.query(`insert into asset (kind, name, territory_id) select 'dwelling', 'Unità Controllo E2E', id from territory where name = 'Comune Alfa' returning id`)).rows[0].id as string;
    const condo = (await client.query("insert into condominium (name) values ('Condominio Controllo E2E') returning id")).rows[0].id as string;
    await client.query("insert into condo_membership (condominium_id, asset_id) values ($1, $2)", [condo, asset]);
    const table = (await client.query("insert into millesimal_table (condominium_id, name) values ($1, 'Generale E2E') returning id", [condo])).rows[0].id as string;
    await client.query("insert into millesimal_share (table_id, asset_id, value) values ($1, $2, 1000)", [table, asset]);
    const year = (await client.query("insert into condo_fiscal_year (condominium_id, label, starts_on, ends_on) values ($1, '2025', '2025-01-01', '2025-12-31') returning id", [condo])).rows[0].id as string;
    const budget = (await client.query("insert into condo_budget (fiscal_year_id, kind, title, total_cents, millesimal_table_id) values ($1, 'ordinary', 'Preventivo E2E', 100000, $2) returning id", [year, table])).rows[0].id as string;
    await client.query("insert into condo_budget (fiscal_year_id, kind, title, total_cents, millesimal_table_id) values ($1, 'final', 'Consuntivo E2E', 150000, $2)", [year, table]);
    await client.query("insert into condo_installment (budget_id, asset_id, number, due_on, amount_cents, paid_cents, paid_on) values ($1, $2, 1, '2025-02-01', 60000, 20000, '2025-02-03')", [budget, asset]);
    await client.query("insert into condo_installment (budget_id, asset_id, number, due_on, amount_cents, paid_cents) values ($1, $2, 2, '2025-08-01', 40000, 0)", [budget, asset]);
    const meeting = (await client.query("insert into condo_meeting (condominium_id, kind, status, meeting_on) values ($1, 'ordinary', 'held', '2025-06-01') returning id", [condo])).rows[0].id as string;
    await client.query("insert into condo_resolution (meeting_id, title, outcome) values ($1, 'Rifacimento tetto E2E', 'approved')", [meeting]);
  });
});

test.afterAll(async () => {
  await db(async (client) => {
    await client.query("delete from condominium where name = 'Condominio Controllo E2E'");
    await client.query("delete from asset where name = 'Unità Controllo E2E'");
  });
});

test.describe("controllo con l'amministratore", () => {
  test("la pagina dei condomini rimanda alle viste e i versamenti mostrano rate, versato e scaduto", async ({ page }) => {
    await page.goto("/condominio");
    await page.getByRole("link", { name: /Controllo con l'amministratore/ }).click();
    await expect(page).toHaveURL(/\/condominio\/controllo$/);
    await expect(page.getByRole("heading", { level: 1, name: "Controllo con l'amministratore" })).toBeVisible();

    const row = page.getByTestId("review-statements").getByRole("row").filter({ hasText: "Preventivo E2E" });
    await expect(row).toContainText("1.000,00 €");
    await expect(row).toContainText("200,00 €");
    await expect(row).toContainText("800,00 €");
    await expect(page.getByTestId("overdue-total")).toContainText("800,00 €");
    const comparison = page.getByTestId("review-comparison");
    await expect(comparison).toContainText("1.500,00 €");
    await expect(comparison).toContainText("1.300,00 €");
    await expect(page.getByText(/Non è il conguaglio dell'amministratore/)).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("i documenti che non risultano sono elencati con il rimando alla sezione", async ({ page }) => {
    await page.goto("/condominio/controllo?vista=consegne");
    const facts = page.getByTestId("delivery-fact");
    await expect(facts.filter({ hasText: "non risulta un documento di convocazione collegato" })).toHaveCount(1);
    await expect(facts.filter({ hasText: "segnata come svolta: non risulta un verbale collegato" })).toHaveCount(1);
    await expect(facts.filter({ hasText: "non risulta un consuntivo registrato" })).toHaveCount(0); // il consuntivo c'e'
    await expect(facts.filter({ hasText: "non risulta il regolamento" })).toHaveCount(1);
    await expect(facts.filter({ hasText: "polizza non scaduta" })).toHaveCount(1);
    await facts.filter({ hasText: "verbale" }).getByRole("link").click();
    await expect(page).toHaveURL(/\/condominio\/[0-9a-f-]{36}\?sezione=assemblee$/);
  });

  test("il registro delle delibere si filtra e porta all'assemblea", async ({ page }) => {
    await page.goto("/condominio/controllo?vista=delibere");
    const register = page.getByTestId("review-register");
    await expect(register.getByRole("row").filter({ hasText: "Rifacimento tetto E2E" })).toContainText("Approvata");
    expect(await a11yViolations(page)).toEqual([]);

    await page.getByLabel("Esito registrato").selectOption({ label: "Respinta" });
    await page.getByRole("button", { name: "Mostra" }).click();
    await expect(page.getByText("Nessuna delibera corrisponde ai filtri.")).toBeVisible();

    await page.goto("/condominio/controllo?vista=delibere&senzaSeguito=1");
    await page.getByTestId("review-register").getByRole("link").first().click();
    await expect(page).toHaveURL(/\/condominio\/[0-9a-f-]{36}\/assemblee\/[0-9a-f-]{36}$/);
  });

  test("i CSV si scaricano con la sessione e si rifiutano senza", async ({ page, playwright, baseURL }) => {
    const response = await page.request.get("/api/condominio/controllo?vista=versamenti");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/csv");
    expect(await response.text()).toContain("Preventivo E2E");
    expect((await page.request.get("/api/condominio/controllo?vista=altro")).status()).toBe(400);

    const anonymous = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { "x-real-ip": clientIp(291) } });
    try {
      expect((await anonymous.get("/api/condominio/controllo?vista=delibere")).status()).toBe(401);
    } finally {
      await anonymous.dispose();
    }
  });
});
