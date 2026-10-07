import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, clientIp } from "./support/env";
import { STORAGE_STATE } from "./support/secrets";

test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(325) } });
test.describe.configure({ mode: "serial" });

const NAME = "Appartamento Agente E2E";

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
let agentId = "";

test.beforeAll(async () => {
  await db(async (client) => {
    assetId = (await client.query(`insert into asset (kind, name, territory_id, address) select 'dwelling', $1, id, 'Via Prova 5' from territory where name = 'Comune Alfa' returning id`, [NAME])).rows[0].id as string;
    agentId = (await client.query(`insert into party (display_name, roles) values ('Agente E2E', '{agent}') returning id`)).rows[0].id as string;
    await client.query(`insert into maint_work (asset_id, title, status, completed_on) values ($1, 'Intervento Agente E2E', 'completed', '2026-02-10')`, [assetId]);
    await client.query(`insert into letting (asset_id, type, title, status, monthly_rent_cents) values ($1, 'residential', 'Locazione Agente E2E', 'active', 70000)`, [assetId]);
  });
});

test.afterAll(async () => {
  await db(async (client) => {
    await client.query("delete from letting where title = 'Locazione Agente E2E'");
    await client.query("delete from maint_work where title = 'Intervento Agente E2E'");
    await client.query("delete from asset where name = $1", [NAME]);
    await client.query("delete from party where display_name = 'Agente E2E'");
  });
});

test.describe("scheda di presentazione per l'agente", () => {
  test("dall'immobile si apre la scheda con dati registrati, checklist e avvertenza", async ({ page }) => {
    await page.goto(`/immobili/${assetId}`);
    await page.getByRole("link", { name: "Scheda per l'agente" }).click();
    await expect(page).toHaveURL(/\/scheda-agente$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(NAME);
    await expect(page.getByTestId("agent-works")).toContainText("Intervento Agente E2E");
    await expect(page.getByTestId("agent-works")).toContainText(/10\/0?2\/2026/);
    await expect(page.getByTestId("agent-letting")).toContainText("700,00");
    await expect(page.getByTestId("agent-holders")).toContainText("non sono inclusi");
    await expect(page.getByTestId("agent-checklist")).toContainText("Categoria senza documenti registrati");
    await expect(page.getByText(/Non è una stima di valore/)).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("scegliendo l'agente il collegamento di condivisione e' preimpostato al livello ordinario", async ({ page }) => {
    await page.goto(`/immobili/${assetId}/scheda-agente?contatto=${agentId}`);
    await expect(page.getByText("preparata per Agente E2E")).toBeVisible();
    const href = await page.getByRole("link", { name: "Prepara il pacchetto" }).getAttribute("href");
    expect(href).toContain("destinatario=agent");
    expect(href).toContain("livello=ordinary");
    await page.getByRole("link", { name: "Prepara il pacchetto" }).click();
    await expect(page).toHaveURL(/\/condivisione\/nuovo/);
  });

  test("l'area incarichi rimanda a pratica e scadenza dell'immobile", async ({ page }) => {
    await page.goto(`/immobili/${assetId}/scheda-agente`);
    await expect(page.getByTestId("agent-tracking").getByRole("link", { name: "Nuova pratica per questo immobile" })).toHaveAttribute("href", `/pratiche/nuova?immobile=${assetId}`);
    await expect(page.getByTestId("agent-tracking").getByRole("link", { name: /Nuova scadenza/ })).toHaveAttribute("href", `/scadenze/nuova?immobile=${assetId}`);
  });
});
