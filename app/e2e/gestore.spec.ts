import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, clientIp } from "./support/env";
import { STORAGE_STATE } from "./support/secrets";

// Dati inseriti direttamente nel database con un anno passato (2024) per il rendiconto e con date relative a oggi per il
// calendario; si rimuovono alla fine.
test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(330) } });
test.describe.configure({ mode: "serial" });

const ASSET = "Appartamento Gestore E2E";
let assetId = "";

async function db<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

const isoIn = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

test.beforeAll(async () => {
  await db(async (client) => {
    assetId = (await client.query(`insert into asset (kind, name, territory_id) select 'dwelling', $1, id from territory where name = 'Comune Alfa' returning id`, [ASSET])).rows[0].id as string;
    await client.query("insert into party (display_name) values ('Gestore E2E Srl')");
    const letting = (await client.query(`insert into letting (asset_id, type, title, status, starts_on, ends_on) values ($1, 'residential', 'Contratto Gestore E2E', 'active', '2024-01-01', $2) returning id`, [assetId, isoIn(40)])).rows[0].id as string;
    await client.query("insert into letting_rent (letting_id, due_on, amount_cents, paid_on, paid_cents) values ($1, '2024-03-01', 60000, '2024-03-04', 60000)", [letting]);
    await client.query("insert into letting_rent (letting_id, due_on, amount_cents, paid_cents) values ($1, '2024-04-01', 60000, 0)", [letting]);
    await client.query("insert into letting_rent (letting_id, due_on, amount_cents, paid_cents) values ($1, $2, 60000, 0)", [letting, isoIn(12)]);
    await client.query("insert into letting_code (letting_id, label, value, valid_until) values ($1, 'Codice Gestore E2E', 'COD-E2E-1', $2)", [letting, isoIn(25)]);
    await client.query("insert into letting_report (letting_id, kind, title, due_on) values ($1, 'communication', 'Comunicazione Gestore E2E', $2)", [letting, isoIn(8)]);
    const work = (await client.query("insert into maint_work (asset_id, title, status, scheduled_on) values ($1, 'Lavoro Gestore E2E', 'approved', $2) returning id", [assetId, isoIn(20)])).rows[0].id as string;
    await client.query("insert into maint_invoice (work_id, issued_on, amount_cents, paid_on) values ($1, '2024-05-01', 25000, '2024-05-05')", [work]);
  });
});

test.afterAll(async () => {
  await db(async (client) => {
    await client.query("delete from deadline where title like 'Mandato di gestione%'");
    await client.query("delete from letting where title = 'Contratto Gestore E2E'");
    await client.query("delete from maint_work where title = 'Lavoro Gestore E2E'");
    await client.query("delete from asset where name = $1", [ASSET]);
    await client.query("delete from party where display_name = 'Gestore E2E Srl'");
  });
});

test.describe("gestione affidata", () => {
  test("da Locazioni si raggiungono le tre viste", async ({ page }) => {
    await page.goto("/locazioni");
    const nav = page.getByRole("navigation", { name: "Gestione affidata" });
    await nav.getByRole("link", { name: "Rendiconto di gestione" }).click();
    await expect(page).toHaveURL(/\/locazioni\/rendiconto$/);
    await expect(page.getByRole("heading", { level: 1, name: "Rendiconto di gestione" })).toBeVisible();
  });

  test("il rendiconto del periodo somma canoni, incassi e pagamenti registrati e segnala i fatti da rivedere", async ({ page }) => {
    await page.goto(`/locazioni/rendiconto?immobile=${assetId}&dal=2024-01-01&al=2024-12-31`);
    await expect(page.getByTestId("statement-heading")).toContainText(ASSET);
    await expect(page.getByTestId("rents-due")).toHaveText("1.200,00 €");
    await expect(page.getByTestId("rents-paid")).toHaveText("600,00 €");
    await expect(page.getByTestId("total-receipts")).toHaveText("600,00 €");
    await expect(page.getByTestId("total-payments")).toHaveText("250,00 €");
    await expect(page.getByTestId("total-difference")).toContainText("350,00 €");
    await expect(page.getByTestId("statement-works")).toContainText("Lavoro Gestore E2E");
    await expect(page.getByTestId("statement-works")).toContainText("Approvato o in corso");
    await expect(page.getByTestId("statement-codes")).toContainText("COD-E2E-1");
    await expect(page.getByTestId("statement-checks")).toContainText("1 canone con data superata e importo non coperto");
    await expect(page.getByTestId("statement-checks")).toContainText("1 canone incassato senza documento di prova allegato");
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("le cifre comunicate dal gestore si confrontano con quanto registrato", async ({ page }) => {
    await page.goto(`/locazioni/rendiconto?immobile=${assetId}&dal=2024-01-01&al=2024-12-31`);
    await page.getByLabel("Incassi comunicati dal gestore (€)").fill("700,00");
    await page.getByLabel("Spese comunicate dal gestore (€)").fill("abc");
    await page.getByRole("button", { name: "Mostra" }).click();
    const compare = page.getByTestId("statement-compare");
    await expect(compare).toContainText("il gestore comunica 700,00 €, nei tuoi dati risultano 600,00 €. Differenza: 100,00 €");
    await expect(compare).toContainText("non è un importo valido");
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("il CSV si scarica con la sessione, ha le sezioni e rifiuta un immobile non valido", async ({ page, request }) => {
    await page.goto(`/locazioni/rendiconto?immobile=${assetId}&dal=2024-01-01&al=2024-12-31`);
    await expect(page.getByRole("link", { name: "Scarica il CSV" })).toHaveAttribute("href", `/api/locazioni/rendiconto?immobile=${assetId}&dal=2024-01-01&al=2024-12-31`);
    const response = await request.get(`/api/locazioni/rendiconto?immobile=${assetId}&dal=2024-01-01&al=2024-12-31`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/csv");
    const body = await response.text();
    expect(body.charCodeAt(0)).toBe(0xfeff);
    expect(body).toContain("Canoni con scadenza nel periodo");
    expect(body).toContain("Lavoro Gestore E2E");
    expect(body).toContain("COD-E2E-1");
    expect((await request.get("/api/locazioni/rendiconto?immobile=no")).status()).toBe(400);
  });

  test("il calendario mostra le date dei prossimi 90 giorni e le occupazioni, senza ospiti", async ({ page }) => {
    await page.goto(`/locazioni/calendario?immobile=${assetId}`);
    const events = page.getByTestId("calendar-events");
    await expect(events).toContainText("Comunicazione Gestore E2E");
    await expect(events).toContainText("Lavoro Gestore E2E");
    await expect(events).toContainText("Fine del contratto");
    await expect(events).toContainText("Fine validità di un codice");
    await expect(events).toContainText("Data superata"); // il canone di aprile 2024 non coperto
    await expect(page.getByTestId("calendar-occupations")).toContainText("Contratto Gestore E2E");
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("il mandato si registra, compare nell'elenco e nel rendiconto", async ({ page }) => {
    await page.goto("/locazioni/mandati");
    await page.getByLabel("Gestore (dalla rubrica)").selectOption({ label: "Gestore E2E Srl" });
    await page.getByLabel("Immobile (facoltativo)").selectOption({ label: ASSET });
    await page.getByLabel("Data di fine del mandato").fill(isoIn(30));
    await page.getByLabel("Compenso dichiarato (testo libero)").fill("8% dei canoni incassati");
    await page.getByRole("button", { name: "Registra il mandato" }).click();
    const list = page.getByTestId("mandates-list");
    await expect(list).toContainText("Gestore E2E Srl");
    await expect(list).toContainText("8% dei canoni incassati");
    await expect(list.getByRole("link", { name: "Gestore E2E Srl" })).toHaveAttribute("href", /\/scadenze\/[0-9a-f-]{36}$/);
    expect(await a11yViolations(page)).toEqual([]);

    await page.goto(`/locazioni/rendiconto?immobile=${assetId}&dal=2024-01-01&al=2024-12-31`);
    await expect(page.getByTestId("statement-mandates")).toContainText("8% dei canoni incassati");
  });

  test("un mandato senza data mostra l'errore accanto al campo", async ({ page }) => {
    await page.goto("/locazioni/mandati");
    await page.getByLabel("Gestore (dalla rubrica)").selectOption({ label: "Gestore E2E Srl" });
    await page.getByRole("button", { name: "Registra il mandato" }).click();
    await expect(page.getByText("Data non valida")).toBeVisible();
  });

  test("un mandato registrato come dato si archivia e sparisce dall'elenco", async ({ page }) => {
    await page.goto("/locazioni/mandati");
    const list = page.getByTestId("mandates-list");
    await expect(list).toContainText("Gestore E2E Srl");
    await list.getByRole("button", { name: /Archivia/ }).first().click();
    await expect(page.getByTestId("mandates-list")).toHaveCount(0);
    await expect(page.getByText("Nessun mandato registrato.")).toBeVisible();
  });
});

test.describe("gestione affidata senza sessione", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("pagine e CSV sono chiusi", async ({ page, request }) => {
    for (const path of ["/locazioni/rendiconto", "/locazioni/calendario", "/locazioni/mandati"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/accesso$/);
    }
    const response = await request.get(`/api/locazioni/rendiconto?immobile=${assetId}`);
    expect(response.status()).toBe(401);
    expect(await response.text()).not.toContain("Gestore E2E");
  });
});
