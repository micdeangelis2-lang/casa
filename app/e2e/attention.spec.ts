import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, clientIp } from "./support/env";
import { STORAGE_STATE } from "./support/secrets";

// I dati con problemi si inseriscono direttamente nel database (date molto passate, cosi' il risultato non dipende dal giorno in
// cui gira il test) e si rimuovono alla fine.
test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(200) } });
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
    const asset = (await client.query(`insert into asset (kind, name, territory_id) select 'dwelling', 'Appartamento Controlli E2E', id from territory where name = 'Comune Alfa' returning id`)).rows[0].id as string;

    const type = (await client.query("insert into tax_type (name) values ('Imposta Controlli E2E') returning id")).rows[0].id as string;
    await client.query("insert into tax_obligation (asset_id, tax_type_id, year, due_on, expected_cents) values ($1, $2, 2020, '2020-06-16', 45000)", [asset, type]);

    const policy = (await client.query("insert into ins_policy (title, ends_on) values ('Polizza Controlli E2E', '2020-12-31') returning id")).rows[0].id as string;
    await client.query("insert into ins_policy_asset (policy_id, asset_id) values ($1, $2)", [policy, asset]);
    await client.query("insert into ins_premium (policy_id, due_on, amount_cents) values ($1, '2020-02-01', 24000)", [policy]);

    const letting = (await client.query("insert into letting (asset_id, type, title, status, ends_on) values ($1, 'residential', 'Locazione Controlli E2E', 'active', '2020-12-31') returning id", [asset])).rows[0].id as string;
    await client.query("insert into letting_rent (letting_id, due_on, amount_cents) values ($1, '2020-03-01', 65000)", [letting]);

    const work = (await client.query("insert into maint_work (asset_id, title) values ($1, 'Lavoro Controlli E2E') returning id", [asset])).rows[0].id as string;
    await client.query("insert into maint_invoice (work_id, issued_on, amount_cents) values ($1, '2020-05-01', 100000)", [work]);

    const category = (await client.query("select id from document_category order by position limit 1")).rows[0].id as string;
    const file = (await client.query("insert into file_object (storage_key, sha256, size_bytes, mime_type) values ('controlli-e2e-1', md5('controlli'), 1000, 'application/pdf') returning id")).rows[0].id as string;
    const doc = (await client.query("insert into document (title, category_id) values ('Certificato Controlli E2E', $1) returning id", [category])).rows[0].id as string;
    await client.query("insert into document_version (document_id, version_no, file_object_id, original_filename, valid_to) values ($1, 1, $2, 'certificato.pdf', '2020-01-31')", [doc, file]);
  });
});

test.afterAll(async () => {
  await db(async (client) => {
    await client.query("delete from letting");
    await client.query("delete from maint_work");
    await client.query("delete from ins_policy");
    await client.query("delete from tax_obligation");
    await client.query("delete from tax_type");
    await client.query("delete from document where title = 'Certificato Controlli E2E'");
    await client.query("delete from file_object where storage_key = 'controlli-e2e-1'");
    await client.query("delete from asset where name = 'Appartamento Controlli E2E'");
  });
});

test.describe("da controllare", () => {
  test("la voce di menu e' attiva e raccoglie le situazioni dei vari moduli, con priorita' e collegamenti", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Da controllare", exact: true }).click();
    await expect(page).toHaveURL(/\/controlli$/);
    await expect(page.getByText(/non dice se una situazione sia irregolare/)).toBeVisible();

    await expect(page.getByTestId("list-taxes")).toContainText("Imposta Controlli E2E 2020 (Appartamento Controlli E2E): la scadenza indicata (16/06/2020) è passata e non risulta un pagamento completo registrato");
    await expect(page.getByTestId("list-insurance")).toContainText("Polizza «Polizza Controlli E2E»: il premio di 240,00 € aveva scadenza il 01/02/2020 e non risulta pagato");
    await expect(page.getByTestId("list-insurance")).toContainText("La polizza «Polizza Controlli E2E» ha la fine indicata il 31/12/2020, già passata, e non è archiviata");
    await expect(page.getByTestId("list-lettings")).toContainText("Locazione Controlli E2E: 1 canone con scadenza passata e non pagato per intero");
    await expect(page.getByTestId("list-lettings")).toContainText("la data di fine (31/12/2020) è passata ma lo stato è ancora «in corso»");
    await expect(page.getByTestId("list-maintenance")).toContainText("«Lavoro Controlli E2E»: fatture registrate e non pagate per 1.000,00 €");
    await expect(page.getByTestId("list-documents")).toContainText("Il documento «Certificato Controlli E2E» ha la validità indicata fino al 31/01/2020, già passata");
    await expect(page.getByTestId("list-backup")).toContainText("Nessun backup riuscito finora");

    await expect(page.getByTestId("attention-summary")).toContainText("segnalazioni con priorità alta");
    const high = page.getByTestId("list-taxes").getByRole("listitem").filter({ hasText: "Imposta Controlli E2E" });
    await expect(high.getByText("Priorità alta")).toBeVisible();
    await expect(page.getByTestId("list-documents").getByText("Da verificare")).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("ogni risultato porta alla pagina dove si sistema", async ({ page }) => {
    await page.goto("/controlli");
    await page.getByTestId("list-maintenance").getByRole("link", { name: /Lavoro Controlli E2E/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Lavoro Controlli E2E" })).toBeVisible();
    await page.goBack();
    await page.getByTestId("list-lettings").getByRole("link", { name: /canone con scadenza passata/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Locazione Controlli E2E" })).toBeVisible();
  });

  test("la panoramica mostra il riquadro con le prime segnalazioni e il collegamento a tutte", async ({ page }) => {
    await page.goto("/");
    const card = page.getByTestId("dashboard-attention");
    await expect(card.getByRole("heading", { level: 2, name: "Da controllare" })).toBeVisible();
    await expect(card.getByTestId("dashboard-attention-list").getByRole("listitem")).toHaveCount(5);
    await card.getByRole("link", { name: /^Vedi tutto \(\d+\)$/ }).click();
    await expect(page).toHaveURL(/\/controlli$/);
  });
});

test.describe("da controllare senza sessione", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("la pagina e' chiusa", async ({ page }) => {
    await page.goto("/controlli");
    await expect(page).toHaveURL(/\/accesso$/);
  });
});
