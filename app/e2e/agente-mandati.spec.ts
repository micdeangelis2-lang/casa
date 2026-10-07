import { expect, test } from "@playwright/test";
import { Client } from "./support/pg-client";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, clientIp } from "./support/env";
import { STORAGE_STATE } from "./support/secrets";

test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(344) } });
test.describe.configure({ mode: "serial" });

const ASSET = "Casa mandati agente E2E";
const AGENT = "Agenzia mandati E2E";
let assetId = "";

async function sql<T = unknown>(text: string, values: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(text, values)).rows as T[];
  } finally {
    await client.end();
  }
}

async function cleanup() {
  await sql("delete from asset where name = $1", [ASSET]);
  await sql("delete from party where display_name = $1", [AGENT]);
}

test.beforeAll(async () => {
  await cleanup();
  assetId = (await sql<{ id: string }>("insert into asset (kind, name, territory_id, address) select 'dwelling', $1, id, 'Via Mandati 1' from territory where name = 'Comune Alfa' returning id", [ASSET]))[0]!.id;
  await sql("insert into party (display_name) values ($1)", [AGENT]);
});

test.afterAll(cleanup);

test.describe("mandati di vendita o affitto nella scheda dell'agente", () => {
  test("senza mandati la sezione lo dice", async ({ page }) => {
    await page.goto(`/immobili/${assetId}/scheda-agente`);
    await expect(page.getByTestId("listings-empty")).toBeVisible();
  });

  test("si registra un mandato con l'agente dalla rubrica", async ({ page }) => {
    await page.goto(`/immobili/${assetId}/scheda-agente`);
    const form = page.getByRole("form", { name: "Registra un mandato", exact: true });
    await form.getByLabel("Tipo di mandato").selectOption("sale");
    await form.getByLabel("Agente (dalla rubrica)").selectOption({ label: AGENT });
    await form.getByLabel("Data di inizio").fill("2026-03-01");
    await form.getByLabel("Mandato in esclusiva").check();
    await form.getByLabel("Prezzo o canone richiesto (€)").fill("250.000,00");
    await form.getByLabel("Provvigione (testo libero)").fill("3% del prezzo");
    await form.getByRole("button", { name: "Registra il mandato" }).click();
    const listing = page.getByTestId("listing");
    await expect(listing).toContainText("Vendita");
    await expect(listing).toContainText("In esclusiva");
    await expect(listing).toContainText(`agente ${AGENT}`);
    await expect(listing).toContainText("richiesto 250.000,00 €");
    await expect(listing).toContainText("provvigione: 3% del prezzo");
    await expect(page.getByTestId("listing-counts")).toContainText("0 visite registrate, 0 proposte registrate");
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("visite e proposte si aggiungono e i conteggi seguono; l'importo non vale per una visita", async ({ page }) => {
    await page.goto(`/immobili/${assetId}/scheda-agente`);
    const form = page.getByRole("form", { name: /Aggiungi una visita o una proposta/ });
    await form.getByLabel("Tipo").selectOption("visit");
    await form.getByLabel("Data").fill("2026-04-02");
    await form.getByLabel("Importo (€)").fill("1000");
    await form.getByRole("button", { name: "Aggiungi" }).click();
    await expect(form).toContainText("L'importo si indica solo per una proposta o una controproposta");

    await form.getByLabel("Importo (€)").fill("");
    await form.getByRole("button", { name: "Aggiungi" }).click();
    await expect(page.getByTestId("listing-counts")).toContainText("1 visita registrata, 0 proposte registrate");

    await form.getByLabel("Tipo").selectOption("proposal");
    await form.getByLabel("Data").fill("2026-04-10");
    await form.getByLabel("Importo (€)").fill("230.000,00");
    await form.getByLabel("Esito").selectOption("open");
    await form.getByRole("button", { name: "Aggiungi" }).click();
    await expect(page.getByTestId("listing-counts")).toContainText("1 visita registrata, 1 proposta registrata");
    await expect(page.getByTestId("listing-events")).toContainText("230.000,00 €");
    await expect(page.getByTestId("listing-events")).toContainText("Aperta");
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("la sezione non entra nella stampa e il mandato si toglie", async ({ page }) => {
    await page.goto(`/immobili/${assetId}/scheda-agente`);
    await page.emulateMedia({ media: "print" });
    await expect(page.getByTestId("agent-listings")).toBeHidden();
    await page.emulateMedia({ media: "screen" });
    await page.getByTestId("listing").getByRole("button", { name: /^Togli/ }).first().click();
    await expect(page.getByTestId("listings-empty")).toBeVisible();
  });
});
