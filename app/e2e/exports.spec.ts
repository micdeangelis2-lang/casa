import { expect, test, type APIRequestContext } from "@playwright/test";
import { Client } from "./support/pg-client";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, clientIp } from "./support/env";
import { reconfirm } from "./support/reconfirm";
import { STORAGE_STATE } from "./support/secrets";

// Esportazioni CSV delle viste (impianti, polizze per immobile, scheda per il notaio e per l'agente) e pacchetto con la scheda in HTML.
test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(375) } });
test.describe.configure({ mode: "serial" });

const ASSET = "Casa esportazioni E2E";
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

test.beforeAll(async () => {
  await db(async (client) => {
    assetId = (await client.query(`insert into asset (kind, name, territory_id, address) select 'dwelling', $1, id, 'Via Esportazioni 7' from territory where name = 'Comune Alfa' returning id`, [ASSET])).rows[0].id as string;
    const policy = (await client.query("insert into ins_policy (title, policy_number, starts_on, ends_on, premium_cents) values ('Polizza esportazioni E2E', 'POL-EXP-1', '2020-01-01', '2099-12-31', 36000) returning id")).rows[0].id as string;
    await client.query("insert into ins_policy_asset (policy_id, asset_id) values ($1, $2)", [policy, assetId]);
    await client.query("insert into ins_coverage (policy_id, title, sum_insured_cents) values ($1, 'Incendio esportazioni', 15000000)", [policy]);
  });
});

test.afterAll(async () => {
  await db(async (client) => {
    await client.query("delete from share_package");
    await client.query("delete from ins_policy");
    await client.query("delete from asset where name = $1", [ASSET]);
  });
});

async function expectCsv(request: APIRequestContext, url: string) {
  const response = await request.get(url);
  expect(response.status(), url).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/csv");
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  expect(response.headers()["content-disposition"]).toContain("attachment");
  const body = await response.text();
  expect(body.charCodeAt(0)).toBe(0xfeff);
  expect(body).toContain("\r\n");
  return body;
}

test.describe("esportazioni CSV", () => {
  test("polizze per immobile: l'immobile con la sua polizza, date gg/mm/aaaa", async ({ request }) => {
    const body = await expectCsv(request, "/api/assicurazioni/per-immobile");
    expect(body).toContain("Polizze per immobile");
    expect(body).toContain(`${ASSET};Almeno una polizza in corso;Polizza esportazioni E2E;`);
    expect(body).toContain("POL-EXP-1;01/01/2020;31/12/2099;In corso;360,00");
    expect(body).toContain("Incendio esportazioni, somma assicurata 150.000,00 €");
  });

  test("scheda per il notaio: dati registrati e dati che non risultano", async ({ request }) => {
    const body = await expectCsv(request, `/api/immobili/${assetId}/scheda-notaio`);
    expect(body).toContain(`Scheda dell'immobile per il notaio: ${ASSET}`);
    expect(body).toContain("Dati che non risultano");
    expect(body).toContain("Non dice se un atto sia possibile");
    expect(body).toContain("Via Esportazioni 7");
  });

  test("scheda per l'agente: livello e titolari come nella pagina", async ({ request }) => {
    const body = await expectCsv(request, `/api/immobili/${assetId}/scheda-agente`);
    expect(body).toContain(`Scheda per l'agente immobiliare: ${ASSET}`);
    expect(body).toContain("Livello massimo di riservatezza dei documenti elencati: Ordinario");
    expect(body).toContain("Non contiene stime di valore");
    await expectCsv(request, `/api/immobili/${assetId}/scheda-agente?livello=reserved&titolari=1`);
  });

  test("registro impianti", async ({ request }) => {
    const body = await expectCsv(request, "/api/manutenzioni/impianti?giorni=30");
    expect(body).toContain("Registro impianti");
    expect(body).toContain("Non dice se un impianto sia a norma");
  });

  test("id non valido: 404; senza sessione: 401; da un altro sito: 403", async ({ request, playwright }) => {
    expect((await request.get("/api/immobili/non-un-uuid/scheda-notaio")).status()).toBe(404);
    expect((await request.get("/api/immobili/non-un-uuid/scheda-agente")).status()).toBe(404);
    expect((await request.get("/api/immobili/00000000-0000-4000-8000-000000000000/scheda-notaio")).status()).toBe(404);
    expect((await request.get("/api/immobili/00000000-0000-4000-8000-000000000000/scheda-agente")).status()).toBe(404);
    for (const url of ["/api/assicurazioni/per-immobile", "/api/manutenzioni/impianti", `/api/immobili/${assetId}/scheda-notaio`, `/api/immobili/${assetId}/scheda-agente`]) {
      expect((await request.get(url, { headers: { "sec-fetch-site": "cross-site" } })).status(), url).toBe(403);
    }
    const anonymous = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { "x-real-ip": clientIp(376) } });
    try {
      for (const url of ["/api/assicurazioni/per-immobile", "/api/manutenzioni/impianti", `/api/immobili/${assetId}/scheda-notaio`, `/api/immobili/${assetId}/scheda-agente`]) {
        expect((await anonymous.get(url)).status(), url).toBe(401);
      }
    } finally {
      await anonymous.dispose();
    }
  });

  test("le pagine offrono il pulsante di scarico", async ({ page }) => {
    await page.goto("/assicurazioni/per-immobile");
    await expect(page.getByRole("link", { name: "Scarica il CSV" })).toHaveAttribute("href", "/api/assicurazioni/per-immobile");
    await page.goto("/manutenzioni/impianti");
    await expect(page.getByRole("link", { name: "Scarica il CSV" })).toBeVisible();
    await page.goto(`/immobili/${assetId}/notaio`);
    await expect(page.getByRole("link", { name: "Scarica il CSV" })).toHaveAttribute("href", `/api/immobili/${assetId}/scheda-notaio`);
    await page.goto(`/immobili/${assetId}/scheda-agente?livello=reserved&titolari=1`);
    await expect(page.getByRole("link", { name: "Scarica il CSV" })).toHaveAttribute("href", `/api/immobili/${assetId}/scheda-agente?livello=reserved&titolari=1`);
  });
});

test.describe("pacchetto con la scheda in HTML", () => {
  test("dalla pagina delle polizze: si include la scheda, il pacchetto la elenca e lo ZIP la contiene", async ({ page }) => {
    await page.goto(`/condivisione/nuovo?immobile=${assetId}&destinatario=insurer&scheda=insurer&mostra=1`);
    await expect(page.getByTestId("package-sheet")).toBeVisible();
    await expect(page.getByLabel("Includi la scheda «polizze per immobile» nel pacchetto")).toBeChecked();
    expect(await a11yViolations(page)).toEqual([]);
    await page.getByLabel("Nome del destinatario").fill("Studio assicurativo E2E");
    await page.getByRole("button", { name: "Crea il pacchetto" }).click();
    await expect(page).toHaveURL(/\/condivisione\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("package-sheet")).toContainText("Scheda inclusa");
    await expect(page.getByTestId("package-sheet")).toContainText("SCHEDA.html");
    await reconfirm(page.context());
    const href = await page.getByRole("link", { name: "Scarica il pacchetto" }).getAttribute("href");
    const zip = await page.request.get(href!);
    expect(zip.status()).toBe(200);
    expect(zip.headers()["content-type"]).toBe("application/zip");
    const bytes = await zip.body();
    for (const name of ["INDEX.html", "manifest.json", "elenco.csv", "SCHEDA.html"]) expect(bytes.includes(Buffer.from(name)), name).toBe(true);
  });

  test("senza spuntare la scheda il pacchetto senza documenti non si crea", async ({ page }) => {
    await page.goto(`/condivisione/nuovo?immobile=${assetId}&destinatario=insurer&scheda=insurer&mostra=1`);
    await page.getByLabel("Includi la scheda «polizze per immobile» nel pacchetto").uncheck();
    await page.getByLabel("Nome del destinatario").fill("Studio senza scheda");
    await page.getByRole("button", { name: "Crea il pacchetto" }).click();
    await expect(page.getByText("Scegli almeno un documento").first()).toBeVisible();
  });
});
