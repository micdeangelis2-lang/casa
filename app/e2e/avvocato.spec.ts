import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, clientIp } from "./support/env";
import { STORAGE_STATE } from "./support/secrets";

test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(295) } });
test.describe.configure({ mode: "serial" });

const LAWYER = "Avvocato Fascicolo E2E";
const TITLE = "Pratica fascicolo E2E";
let matterId = "";

async function withClient<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

test.beforeAll(async () => {
  matterId = await withClient(async (c) => {
    const party = (await c.query("insert into party (display_name, roles, pec) values ($1, '{lawyer}', 'avv.e2e@pec.example.test') returning id", [LAWYER])).rows[0].id;
    const matter = (await c.query("insert into matter (title, description, status, opened_on) values ($1, 'Descrizione di prova', 'open', '2026-01-10') returning id", [TITLE])).rows[0].id;
    await c.query("insert into matter_assignment (matter_id, party_id, role) values ($1, $2, 'legale')", [matter, party]);
    await c.query("insert into matter_document_request (matter_id, title, requested_from_party_id, requested_on, due_on) values ($1, 'Estratto conto E2E', $2, '2026-01-12', '2026-01-20')", [matter, party]);
    return matter as string;
  });
});

test.afterAll(async () => {
  await withClient(async (c) => {
    await c.query("delete from matter where title = $1", [TITLE]);
    await c.query("delete from party where display_name = $1", [LAWYER]);
  });
});

test.describe("fascicolo per il professionista", () => {
  test("dalla pratica si apre il fascicolo con cronologia, parti ed elenco da completare", async ({ page }) => {
    await page.goto(`/pratiche/${matterId}`);
    await page.getByRole("link", { name: "Fascicolo per il professionista" }).click();
    await expect(page).toHaveURL(new RegExp(`/pratiche/${matterId}/fascicolo$`));
    await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
    await expect(page.getByTestId("dossier-parties")).toContainText(LAWYER);
    await expect(page.getByTestId("dossier-parties")).toContainText("avv.e2e@pec.example.test");

    const rows = page.getByTestId("timeline").locator("tbody tr");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("10/01/2026");
    await expect(rows.nth(0)).toContainText("Pratica aperta");
    await expect(rows.nth(1)).toContainText("Estratto conto E2E");
    await expect(rows.nth(2)).toContainText("Data indicata per");

    const checklist = page.getByTestId("checklist");
    await expect(checklist).toContainText("non è collegata a un immobile");
    await expect(checklist).toContainText("Richieste con data indicata già passata e ancora aperte: Estratto conto E2E");
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("il collegamento al pacchetto propone il destinatario avvocato e solo i documenti della pratica", async ({ page }) => {
    await page.goto(`/pratiche/${matterId}/fascicolo`);
    await page.getByRole("link", { name: "Prepara il pacchetto dei documenti" }).click();
    await expect(page).toHaveURL(/\/condivisione\/nuovo\?pratica=.*destinatario=lawyer/);
    await expect(page.getByLabel("Tipo di destinatario")).toHaveValue("lawyer");
    await expect(page.getByLabel("Nome del destinatario")).toHaveValue(LAWYER);
  });

  test("la cronologia si scarica in CSV e richiede la sessione", async ({ page, playwright }) => {
    const response = await page.request.get(`/api/pratiche/${matterId}/cronologia`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/csv");
    const body = await response.text();
    expect(body).toContain("Data;Fonte;Fatto;Dettaglio;Importo (euro)");
    expect(body).toContain("10/01/2026;Pratica;Pratica aperta");

    expect((await page.request.get("/api/pratiche/non-un-uuid/cronologia")).status()).toBe(404);
    const anonymous = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { "x-real-ip": clientIp(295) } });
    try {
      expect((await anonymous.get(`/api/pratiche/${matterId}/cronologia`)).status()).toBe(401);
    } finally {
      await anonymous.dispose();
    }
  });

  test("senza pratica l'indirizzo risponde 404", async ({ page }) => {
    const response = await page.goto("/pratiche/00000000-0000-4000-8000-000000000000/fascicolo");
    expect(response?.status()).toBe(404);
  });
});
