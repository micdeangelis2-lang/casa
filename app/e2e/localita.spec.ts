import { expect, test, type Page } from "@playwright/test";
import { Client } from "./support/pg-client";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, E2E_ORIGIN, clientIp } from "./support/env";
import { isHydrated } from "./support/hydration";
import { STORAGE_STATE } from "./support/secrets";

// Suggerimenti di localita' (GET /api/localita): la risposta di OpenStreetMap non viene mai richiesta davvero, e' sostituita
// da page.route. Il Comune di prova e' inserito qui e tolto alla fine, per non alterare i conteggi degli altri spec.
test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(386) } });
test.describe.configure({ mode: "serial" });

const COMUNE = "Comune Frazioso";
const COMUNE_LABEL = `${COMUNE} (LZ) · Regione Localita`;
let comuneId = "";

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

test.beforeAll(async () => {
  comuneId = await withClient(async (client) => {
    const region = await client.query<{ id: string }>("insert into territory (kind, name, source) values ('region', 'Regione Localita', 'manual') returning id");
    const province = await client.query<{ id: string }>(
      "insert into territory (kind, name, parent_id, province_sigla, source) values ('province', 'Provincia Localita', $1, 'LZ', 'manual') returning id",
      [region.rows[0]!.id],
    );
    const comune = await client.query<{ id: string }>(
      "insert into territory (kind, name, parent_id, source) values ('municipality', $1, $2, 'manual') returning id",
      [COMUNE, province.rows[0]!.id],
    );
    return comune.rows[0]!.id;
  });
});

test.afterAll(async () => {
  await withClient(async (client) => {
    await client.query("delete from territory where kind = 'municipality' and name = $1", [COMUNE]);
    await client.query("delete from territory where kind = 'province' and name = 'Provincia Localita'");
    await client.query("delete from territory where kind = 'region' and name = 'Regione Localita'");
  });
});

async function mockSuggestions(page: Page, suggestions: string[], status = 200): Promise<string[]> {
  const urls: string[] = [];
  await page.route("**/api/localita**", async (route) => {
    urls.push(route.request().url());
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ suggestions }) });
  });
  return urls;
}

/** Solo le voci dell'elenco dei suggerimenti (la pagina ha anche i select nativi, con altre option). */
const suggestionOptions = (page: Page) => page.locator('[role="listbox"][aria-label="Suggerimenti per frazione o località"] [role="option"]');

async function openForm(page: Page) {
  await page.goto("/immobili/nuovo");
  const locality = page.getByLabel("Località o frazione", { exact: true });
  await expect.poll(() => isHydrated(locality), { timeout: 15_000 }).toBe(true);
  return locality;
}

async function pickComune(page: Page) {
  const field = page.getByLabel("Comune", { exact: true });
  await field.fill("frazioso");
  await page.getByRole("option", { name: COMUNE_LABEL }).click();
  await expect(field).toHaveValue(COMUNE_LABEL);
}

test.describe("località con suggerimenti", () => {
  test("senza Comune non parte nessuna richiesta e si vede l'invito a sceglierlo", async ({ page }) => {
    const urls = await mockSuggestions(page, ["Non dovrebbe comparire"]);
    const locality = await openForm(page);
    await expect(page.getByText("Scegli prima il Comune.")).toBeVisible();
    await locality.pressSequentially("Fraz", { delay: 30 });
    await page.waitForTimeout(1500);
    expect(urls).toEqual([]);
    await expect(suggestionOptions(page)).toHaveCount(0);
    await expect(locality).toHaveValue("Fraz");
  });

  test("con il Comune scelto compaiono i suggerimenti, si sceglie con la tastiera e il campo si riempie", async ({ page }) => {
    const urls = await mockSuggestions(page, ["Faiano", "Fontana Nuova", "Frazione Alta"]);
    const locality = await openForm(page);
    await pickComune(page);

    await locality.pressSequentially("Fa", { delay: 30 });
    const options = suggestionOptions(page);
    await expect(options).toHaveCount(3);
    await expect(locality).toHaveAttribute("aria-expanded", "true");
    expect(urls).toHaveLength(1);
    const request = new URL(urls[0]!);
    expect(request.origin).toBe(E2E_ORIGIN);
    expect(request.searchParams.get("comune")).toBe(comuneId);
    expect(request.searchParams.get("q")).toBe("Fa");

    expect(await a11yViolations(page)).toEqual([]);

    await locality.press("ArrowDown");
    await locality.press("ArrowDown");
    await expect(locality).toHaveAttribute("aria-activedescendant", /.+/);
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
    await locality.press("Enter");
    await expect(locality).toHaveValue("Fontana Nuova");
    await expect(locality).toHaveAttribute("aria-expanded", "false");
    await expect(options).toHaveCount(0);
    // Invio sceglie il suggerimento e non invia il modulo.
    await expect(page).toHaveURL(/\/immobili\/nuovo$/);
  });

  test("Esc chiude l'elenco e si puo' sempre scrivere un nome diverso", async ({ page }) => {
    await mockSuggestions(page, ["Faiano"]);
    const locality = await openForm(page);
    await pickComune(page);
    await locality.pressSequentially("Fa", { delay: 30 });
    await expect(suggestionOptions(page)).toHaveCount(1);
    await locality.press("Escape");
    await expect(locality).toHaveAttribute("aria-expanded", "false");
    await locality.fill("Un nome tutto mio");
    await expect(locality).toHaveValue("Un nome tutto mio");
  });

  test("se il servizio non risponde compare il messaggio e il campo resta libero", async ({ page }) => {
    await mockSuggestions(page, [], 502);
    const locality = await openForm(page);
    await pickComune(page);
    await locality.pressSequentially("Fa", { delay: 30 });
    await expect(page.getByText("Suggerimenti non disponibili: scrivi pure il nome a mano.")).toBeVisible();
    await expect(locality).toHaveValue("Fa");
  });

  test("senza sessione la route risponde 401", async ({ playwright }) => {
    const anonymous = await playwright.request.newContext({ baseURL: E2E_ORIGIN, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { "x-real-ip": clientIp(386) } });
    try {
      expect((await anonymous.get(`/api/localita?comune=${comuneId}&q=Fa`)).status()).toBe(401);
    } finally {
      await anonymous.dispose();
    }
  });
});
