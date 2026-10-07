import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, clientIp } from "./support/env";
import { STORAGE_STATE } from "./support/secrets";

test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(300) } });
test.describe.configure({ mode: "serial" });

const YEAR = 2023;

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
    const asset = (await client.query(`insert into asset (kind, name, territory_id) select 'dwelling', 'Appartamento Commercialista E2E', id from territory where name = 'Comune Alfa' returning id`)).rows[0].id as string;
    const type = (await client.query("insert into tax_type (name) values ('Imposta Commercialista E2E') returning id")).rows[0].id as string;
    const obligation = (await client.query("insert into tax_obligation (asset_id, tax_type_id, year, label, ask_adviser, note) values ($1, $2, $3, 'Saldo', true, 'Nota per il consulente E2E') returning id", [asset, type, YEAR])).rows[0].id as string;
    await client.query("insert into tax_payment (obligation_id, paid_on, amount_cents) values ($1, $2, 30000)", [obligation, `${YEAR}-06-16`]);
    const work = (await client.query("insert into maint_work (asset_id, title) values ($1, 'Lavoro Commercialista E2E') returning id", [asset])).rows[0].id as string;
    await client.query("insert into maint_invoice (work_id, issued_on, amount_cents, paid_on) values ($1, $2, 100000, $3)", [work, `${YEAR}-05-01`, `${YEAR}-05-05`]);
  });
});

test.afterAll(async () => {
  await db(async (client) => {
    await client.query("delete from maint_work");
    await client.query("delete from tax_obligation");
    await client.query("delete from tax_type");
    await client.query("delete from asset where name = 'Appartamento Commercialista E2E'");
  });
});

test.describe("dossier per il consulente", () => {
  test("e' raggiungibile dal quadro economico e segnala i dati non registrati senza giudizi", async ({ page }) => {
    await page.goto(`/economia?anno=${YEAR}`);
    await page.getByRole("link", { name: "Dossier annuale per il consulente" }).click();
    await expect(page).toHaveURL(new RegExp("/economia/dossier[?]anno=" + YEAR + "$"));
    await expect(page.getByRole("heading", { level: 1 })).toContainText(String(YEAR));
    const gaps = page.getByTestId("gaps-table");
    await expect(gaps.getByRole("row").filter({ hasText: "Imposta Commercialista E2E 2023 – Saldo" }).first()).toBeVisible();
    await expect(gaps.getByText("Nessun dato catastale registrato per l'anno").first()).toBeVisible();
    await expect(gaps.getByRole("row").filter({ hasText: "Lavoro Commercialista E2E" })).toContainText("Pagamento o incasso senza documento di prova collegato");
    await expect(page.getByTestId("to-ask")).toContainText("Nota per il consulente E2E");
    await expect(page.getByTestId("dossier-movements").getByRole("row")).toHaveCount(3);
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("il CSV si scarica con la sessione e rifiuta un anno non valido", async ({ request }) => {
    const response = await request.get(`/api/economia/dossier?anno=${YEAR}`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/csv");
    expect(response.headers()["content-disposition"]).toContain(`dossier-commercialista-${YEAR}.csv`);
    const body = await response.text();
    expect(body).toContain("Lavoro Commercialista E2E");
    expect(body).toContain("Nota per il consulente E2E");
    expect((await request.get("/api/economia/dossier?anno=ieri")).status()).toBe(400);
  });
});

test.describe("dossier senza sessione", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("la pagina e il CSV sono chiusi", async ({ page, request }) => {
    await page.goto("/economia/dossier");
    await expect(page).toHaveURL(/\/accesso$/);
    expect((await request.get(`/api/economia/dossier?anno=${YEAR}`)).status()).toBe(401);
  });
});
