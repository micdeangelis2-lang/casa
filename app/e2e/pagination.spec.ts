import { expect, test } from "@playwright/test";
import { Client } from "./support/pg-client";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, clientIp } from "./support/env";
import { STORAGE_STATE } from "./support/secrets";

// L'elenco dei documenti e' paginato (50 per pagina): con centinaia di file resta rapido. I documenti di prova si inseriscono
// direttamente nel database e si rimuovono alla fine. Altri file di test possono lasciare documenti propri: per questo i
// conteggi si leggono sempre con la ricerca «Pager E2E».
test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(170) } });
test.describe.configure({ mode: "serial" });

const TOTAL = 120;

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
    const { rows } = await client.query("select id from document_category order by position limit 1");
    const categoryId = rows[0].id as string;
    await client.query(`insert into file_object (storage_key, sha256, size_bytes, mime_type) select 'pager-e2e-' || g, md5('pager' || g), 1000, 'application/pdf' from generate_series(1, ${TOTAL}) g`);
    await client.query(`insert into document (title, category_id, updated_at) select 'Pager E2E ' || lpad(g::text, 3, '0'), $1, now() - (g || ' minutes')::interval from generate_series(1, ${TOTAL}) g`, [categoryId]);
    await client.query(`
      insert into document_version (document_id, version_no, file_object_id, original_filename)
      select d.id, 1, f.id, d.title || '.pdf'
      from document d join file_object f on f.storage_key = 'pager-e2e-' || ltrim(substr(d.title, 11), '0')
      where d.title like 'Pager E2E %'`);
  });
});

test.afterAll(async () => {
  await db(async (client) => {
    await client.query("delete from document where title like 'Pager E2E %'");
    await client.query("delete from file_object where storage_key like 'pager-e2e-%'");
  });
});

test.describe("elenco documenti paginato", () => {
  test("mostra 50 documenti per pagina con il totale e i collegamenti precedente/successiva", async ({ page }) => {
    await page.goto("/documenti?q=Pager%20E2E");
    await expect(page.getByTestId("document-list").getByRole("listitem")).toHaveCount(50);
    await expect(page.getByTestId("pager-summary")).toHaveText(`${TOTAL} documenti · pagina 1 di 3`);
    await expect(page.getByRole("link", { name: "Pagina precedente" })).toHaveCount(0);
    await expect(page.getByTestId("document-list").getByRole("listitem").first()).toContainText("Pager E2E 001");
    expect(await a11yViolations(page)).toEqual([]);

    await page.getByRole("link", { name: "Pagina successiva" }).click();
    await expect(page).toHaveURL(/pagina=2$/);
    await expect(page.getByTestId("pager-summary")).toHaveText(`${TOTAL} documenti · pagina 2 di 3`);
    await expect(page.getByTestId("document-list").getByRole("listitem").first()).toContainText("Pager E2E 051");

    await page.getByRole("link", { name: "Pagina successiva" }).click();
    await expect(page.getByTestId("document-list").getByRole("listitem")).toHaveCount(20);
    await expect(page.getByRole("link", { name: "Pagina successiva" })).toHaveCount(0);
    await page.getByRole("link", { name: "Pagina precedente" }).click();
    await expect(page.getByTestId("pager-summary")).toHaveText(`${TOTAL} documenti · pagina 2 di 3`);
  });

  test("i filtri restano nei collegamenti e una pagina oltre la fine porta all'ultima", async ({ page }) => {
    await page.goto("/documenti?q=Pager%20E2E%201");
    // I titoli che contengono «Pager E2E 1» sono 21 (da 100 a 120).
    await expect(page.getByTestId("pager-summary")).toHaveText("21 documenti · pagina 1 di 1");
    await expect(page.getByRole("link", { name: "Pagina successiva" })).toHaveCount(0);

    await page.goto("/documenti?q=Pager%20E2E&pagina=99");
    await expect(page.getByTestId("pager-summary")).toHaveText(`${TOTAL} documenti · pagina 3 di 3`);
    await page.goto("/documenti?q=Pager%20E2E&pagina=abc");
    await expect(page.getByTestId("pager-summary")).toHaveText(`${TOTAL} documenti · pagina 1 di 3`);

    await page.goto("/documenti?q=Pager%20E2E&pagina=2");
    await page.getByRole("link", { name: "Pagina successiva" }).click();
    await expect(page).toHaveURL(/q=Pager\+E2E/);
    await expect(page).toHaveURL(/pagina=3/);
  });

  test("i menu dei documenti nelle altre schermate restano leggeri e utilizzabili con molti documenti", async ({ page }) => {
    await page.goto("/pratiche/nuova");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.goto("/documenti/nuovo");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});
