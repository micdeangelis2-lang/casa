import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, clientIp } from "./support/env";
import { STORAGE_STATE } from "./support/secrets";

test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(340) } });
test.describe.configure({ mode: "serial" });

const OFFICE = "Ufficio destinatario E2E";
const TITLE = "Pratica presentata E2E";
let matterId = "";
let officeId = "";

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
  await sql("delete from deadline where title = 'Integrazione E2E collegata'");
  await sql("delete from matter where title = $1", [TITLE]);
  await sql("delete from party where display_name = $1", [OFFICE]);
}

test.beforeAll(async () => {
  await cleanup();
  officeId = (await sql<{ id: string }>("insert into party (display_name, roles) values ($1, '{public_office}') returning id", [OFFICE]))[0]!.id;
  matterId = (await sql<{ id: string }>("insert into matter (title, status, opened_on) values ($1, 'open', '2026-01-10') returning id", [TITLE]))[0]!.id;
  const deadlineId = (
    await sql<{ id: string }>(
      `insert into deadline (title, category, level, calc, matter_id) values ('Integrazione E2E collegata', 'administrative', 'national', '{"type":"manual"}'::jsonb, $1) returning id`,
      [matterId],
    )
  )[0]!.id;
  await sql("insert into deadline_occurrence (deadline_id, due_on) values ($1, '2099-03-01')", [deadlineId]);
});

test.afterAll(cleanup);

test.describe("pratica presentata a un ufficio", () => {
  test("si registrano ufficio, protocollo, presentazione e termine comunicato", async ({ page }) => {
    await page.goto(`/pratiche/${matterId}/modifica`);
    await page.getByLabel("Ufficio destinatario").selectOption({ label: OFFICE });
    await page.getByLabel("Numero di protocollo").fill("PROT-E2E-77");
    await page.getByLabel("Data di presentazione").fill("2026-01-15");
    await page.getByLabel("Termine di risposta comunicato").fill("2026-02-15");
    await page.getByRole("button", { name: "Salva le modifiche" }).click();
    await expect(page).toHaveURL(new RegExp(`/pratiche/${matterId}$`));
    await expect(page.getByTestId("matter-protocol")).toHaveText("PROT-E2E-77");
    await expect(page.getByRole("link", { name: OFFICE })).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("un fatto della pratica si aggiunge e si toglie", async ({ page }) => {
    await page.goto(`/pratiche/${matterId}`);
    const form = page.getByRole("form", { name: "Aggiungi un fatto" });
    await form.getByLabel("Tipo").selectOption("hearing");
    await form.getByLabel("Data").fill("2026-03-05");
    await form.getByLabel("Titolo").fill("Udienza E2E");
    await form.getByLabel("Nota").fill("Sala prova");
    await form.getByRole("button", { name: "Aggiungi un fatto" }).click();
    const events = page.getByTestId("matter-events");
    await expect(events).toContainText("Udienza E2E");
    await expect(events).toContainText("Sala prova");
    await expect(page.getByTestId("matter-deadlines")).toContainText("Integrazione E2E collegata");
    expect(await a11yViolations(page)).toEqual([]);

    await form.getByLabel("Tipo").selectOption("note");
    await form.getByLabel("Data").fill("2026-03-06");
    await form.getByLabel("Titolo").fill("Nota E2E da togliere");
    await form.getByRole("button", { name: "Aggiungi un fatto" }).click();
    await expect(events).toContainText("Nota E2E da togliere");
    await events.getByRole("button", { name: /Elimina\s*:\s*Nota E2E da togliere/ }).click();
    await expect(events).not.toContainText("Nota E2E da togliere");
    await expect(events).toContainText("Udienza E2E");
  });

  test("il fascicolo e la vista dell'ufficio usano i dati registrati", async ({ page }) => {
    await page.goto(`/pratiche/${matterId}/fascicolo`);
    await expect(page.getByTestId("dossier-protocol")).toHaveText("PROT-E2E-77");
    const timeline = page.getByTestId("timeline");
    await expect(timeline).toContainText("Presentata a " + OFFICE);
    await expect(timeline).toContainText("Termine di risposta comunicato");
    await expect(timeline).toContainText("Udienza: Udienza E2E");
    // Scadenza collegata direttamente, senza nessun professionista indicato.
    await expect(timeline).toContainText("Scadenza: Integrazione E2E collegata");
    expect(await a11yViolations(page)).toEqual([]);

    await page.goto(`/uffici/${officeId}`);
    await expect(page.getByTestId("office-matters")).toContainText(TITLE);
    await expect(page.getByTestId("office-submission")).toContainText("protocollo PROT-E2E-77");
    await expect(page.getByTestId("office-submission")).toContainText("risposta comunicata entro il 15/02/2026");
    await expect(page.getByTestId("office-deadlines")).toContainText("Integrazione E2E collegata");
    expect(await a11yViolations(page)).toEqual([]);
  });
});
