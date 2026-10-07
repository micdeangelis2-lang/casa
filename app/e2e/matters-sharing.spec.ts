import { expect, test, type Page } from "@playwright/test";
import { Client } from "./support/pg-client";
import { makePdf } from "../tests/helpers/sample-pdf";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, clientIp } from "./support/env";
import { reconfirm } from "./support/reconfirm";
import { STORAGE_STATE } from "./support/secrets";

// Gira prima di registry.spec.ts: il contatto che crea lo rimuove alla fine (la rubrica non deve cambiare per gli altri test).
test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(90) } });
test.describe.configure({ mode: "serial" });

const alert = (page: Page) => page.locator('[data-slot="alert"]');
const pdf = (name: string, text: string) => ({ name, mimeType: "application/pdf", buffer: Buffer.from(makePdf(text)) });
let packageUrl = "";

async function upload(page: Page, title: string, text: string, confidentiality?: string) {
  await page.goto("/documenti/nuovo");
  await page.getByLabel("File", { exact: true }).setInputFiles(pdf(`${title}.pdf`, text));
  await page.getByLabel("Titolo", { exact: true }).fill(title);
  if (confidentiality) await page.getByLabel("Riservatezza").selectOption({ label: confidentiality });
  await page.getByRole("button", { name: "Carica", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
}

test.beforeAll(async () => {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  await client.query("insert into party (display_name, roles) values ('Avvocato E2E', '{lawyer}')");
  await client.end();
});

test.afterAll(async () => {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  await client.query("delete from matter");
  await client.query("delete from party where display_name = 'Avvocato E2E'");
  await client.end();
});

test.describe("pratiche", () => {
  test("la voce di menu e' attiva e senza pratiche c'e' lo stato vuoto accessibile", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Pratiche", exact: true }).click();
    await expect(page).toHaveURL(/\/pratiche$/);
    await expect(page.getByText("Nessuna pratica", { exact: true })).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("si apre una pratica e il modulo segnala cosa manca", async ({ page }) => {
    await page.goto("/pratiche/nuova");
    expect(await a11yViolations(page)).toEqual([]);
    await page.getByRole("button", { name: "Apri la pratica" }).click();
    await expect(alert(page)).toContainText("Titolo: campo obbligatorio");
    await page.getByLabel("Titolo", { exact: true }).fill("Pratica di prova");
    await page.getByLabel("Descrizione").fill("Verifica della documentazione");
    await page.getByRole("button", { name: "Apri la pratica" }).click();
    await expect(page).toHaveURL(/\/pratiche\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: "Pratica di prova" })).toBeVisible();
    await expect(page.getByText("Aperta", { exact: true }).first()).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("si assegna un contatto con un ruolo e si toglie", async ({ page }) => {
    await page.goto("/pratiche");
    await page.getByRole("link", { name: /Pratica di prova/ }).click();
    const form = page.getByRole("form", { name: "Assegna" });
    await form.getByLabel("Contatto").selectOption({ label: "Avvocato E2E" });
    await form.getByLabel("Ruolo in questa pratica").fill("legale");
    await form.getByRole("button", { name: "Assegna" }).click();
    await expect(page.getByTestId("assignments")).toContainText("Avvocato E2E");
    await expect(page.getByTestId("assignments")).toContainText("legale");
    await page.getByTestId("assignments").getByRole("button", { name: /Togli/ }).click();
    await expect(page.getByText("Nessun contatto assegnato.")).toBeVisible();
    await form.getByLabel("Contatto").selectOption({ label: "Avvocato E2E" });
    await form.getByRole("button", { name: "Assegna" }).click();
    await expect(page.getByTestId("assignments")).toContainText("Avvocato E2E");
  });

  test("una richiesta di documento si segna ricevuta collegando il documento", async ({ page }) => {
    await upload(page, "Planimetria ricevuta", "planimetria");
    await page.goto("/pratiche");
    await page.getByRole("link", { name: /Pratica di prova/ }).click();
    const form = page.getByRole("form", { name: "Aggiungi la richiesta" });
    await form.getByLabel("Documento richiesto").fill("Planimetria aggiornata");
    await form.getByLabel("Da chi").selectOption({ label: "Avvocato E2E" });
    await form.getByRole("button", { name: "Aggiungi la richiesta" }).click();
    const request = page.getByTestId("requests").getByRole("listitem").first();
    await expect(request).toContainText("Planimetria aggiornata");
    await expect(request).toContainText("Richiesto");
    await expect(request).toContainText("a Avvocato E2E");

    await request.getByLabel(/^Esito/).selectOption("received");
    await request.getByLabel("Documento ricevuto").selectOption({ label: "Planimetria ricevuta" });
    await request.getByRole("button", { name: /^Aggiorna/ }).click();
    await expect(request).toContainText("Ricevuto");
    await expect(request.getByRole("link", { name: "Planimetria ricevuta" })).toBeVisible();
    await expect(page.getByTestId("matter-documents")).toContainText("Planimetria ricevuta");
  });

  test("un parere dice se e' informativo o validato formalmente, e non si registra senza", async ({ page }) => {
    await page.goto("/pratiche");
    await page.getByRole("link", { name: /Pratica di prova/ }).click();
    await expect(page.getByText("l'app non ne trae conclusioni")).toBeVisible();
    const form = page.getByRole("form", { name: "Registra il parere" });
    await form.getByLabel("Professionista").selectOption({ label: "Avvocato E2E" });
    await form.getByLabel("Sintesi").fill("Parere di massima");
    await form.getByRole("button", { name: "Registra il parere" }).click();
    await expect(form).toContainText("Indica se il parere è informativo o validato formalmente");
    await form.getByLabel("Natura del parere").selectOption("formally_validated");
    await form.getByRole("button", { name: "Registra il parere" }).click();
    await expect(page.getByTestId("opinions")).toContainText("Avvocato E2E");
    await expect(page.getByTestId("opinions")).toContainText("Validato formalmente");
    await expect(page.getByTestId("opinions")).toContainText("Parere di massima");
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("chiudere la pratica la toglie dall'elenco delle aperte ma si ritrova", async ({ page }) => {
    await page.goto("/pratiche");
    await page.getByRole("link", { name: /Pratica di prova/ }).click();
    await page.getByRole("link", { name: "Modifica" }).click();
    await page.getByLabel("Stato", { exact: true }).selectOption("closed");
    await page.getByRole("button", { name: "Salva le modifiche" }).click();
    await expect(page.getByText(/Pratica chiusa il/)).toBeVisible();
    await page.goto("/pratiche");
    await expect(page.getByText("Nessuna pratica", { exact: true })).toBeVisible();
    await page.goto("/pratiche?chiuse=1");
    await expect(page.getByTestId("matter-list")).toContainText("Pratica di prova");
  });
});

test.describe("condivisione", () => {
  test("senza pacchetti c'e' lo stato vuoto accessibile", async ({ page }) => {
    await upload(page, "Documento ordinario", "ordinario");
    await upload(page, "Documento riservato", "riservato", "Riservato");
    await page.goto("/");
    await page.getByRole("link", { name: "Condivisione", exact: true }).click();
    await expect(page).toHaveURL(/\/condivisione$/);
    await expect(page.getByText("Nessun pacchetto", { exact: true })).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("un documento oltre il livello scelto parte escluso e con un avviso", async ({ page }) => {
    await page.goto("/condivisione/nuovo");
    await page.getByLabel("Livello massimo di riservatezza").selectOption("ordinary");
    await page.getByRole("button", { name: "Mostra i documenti" }).click();
    const list = page.getByTestId("package-candidates");
    const riservato = list.getByRole("listitem").filter({ hasText: "Documento riservato" });
    await expect(riservato).toContainText("Supera il livello scelto (Ordinario)");
    await expect(riservato.getByRole("checkbox", { name: "Documento riservato" })).not.toBeChecked();
    await expect(list.getByRole("listitem").filter({ hasText: "Documento ordinario" }).getByRole("checkbox", { name: "Documento ordinario" })).toBeChecked();
    expect(await a11yViolations(page)).toEqual([]);

    // Scelto, ma senza «includi comunque», non entra.
    const counter = page.getByText(/\d+ documenti? scelt|nessun documento scelto/);
    const before = await counter.textContent();
    await riservato.getByRole("checkbox", { name: "Documento riservato" }).check();
    await expect(riservato).toContainText("Il documento è più riservato del livello che hai scelto");
    await expect(counter).toHaveText(before!);
  });

  test("si crea un pacchetto con il destinatario, e il documento incluso oltre il livello e' segnalato", async ({ page }) => {
    await page.goto("/condivisione/nuovo?livello=ordinary&mostra=1");
    await page.getByLabel("Tipo di destinatario").selectOption("accountant");
    await page.getByRole("button", { name: "Crea il pacchetto" }).click();
    await expect(alert(page)).toContainText("Destinatario: campo obbligatorio");

    await page.getByLabel("Nome del destinatario").fill("Studio <Rossi>");
    const riservato = page.getByTestId("package-candidates").getByRole("listitem").filter({ hasText: "Documento riservato" });
    await riservato.getByRole("checkbox", { name: "Documento riservato" }).check();
    await riservato.getByRole("checkbox", { name: /Includi comunque/ }).check();
    // Altri test dell'app hanno creato altri documenti: li tolgo per avere un contenuto preciso.
    const others = page.getByTestId("package-candidates").getByRole("listitem").filter({ hasNotText: /Documento ordinario|Documento riservato/ });
    for (let i = (await others.count()) - 1; i >= 0; i -= 1) await others.nth(i).getByRole("checkbox").first().uncheck();
    await expect(page.getByText(/\d+ documenti? scelt/)).toContainText("2 documenti scelti");
    await page.getByRole("button", { name: "Crea il pacchetto" }).click();

    await expect(page).toHaveURL(/\/condivisione\/[0-9a-f-]{36}$/);
    packageUrl = new URL(page.url()).pathname;
    await expect(page.getByRole("heading", { level: 1, name: "Studio <Rossi>" })).toBeVisible();
    const items = page.getByTestId("package-items");
    await expect(items).toContainText("Documento ordinario");
    await expect(items).toContainText("Documento riservato");
    await expect(items.getByRole("listitem").filter({ hasText: "Documento riservato" })).toContainText("incluso oltre il livello scelto");
    await expect(items.getByRole("listitem").filter({ hasText: "Documento ordinario" })).not.toContainText("incluso oltre");
    await expect(page.getByTestId("package-log")).toContainText("Creato");
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("il pacchetto si scarica come ZIP con indice, manifest ed elenco, e lo scarico e' registrato", async ({ page }) => {
    await reconfirm(page.context());
    await page.goto(packageUrl);
    const href =`/api/condivisione/${packageUrl.split("/").pop()}`;
    const response = await page.request.get(href);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("application/zip");
    expect(response.headers()["content-disposition"]).toMatch(/attachment; filename="pacchetto-\d{4}-\d{2}-\d{2}-studio_rossi_\.zip"/);
    const body = await response.body();
    expect(body.subarray(0, 2).toString()).toBe("PK");
    const names = body.toString("latin1");
    for (const name of ["INDEX.html", "manifest.json", "elenco.csv", "files/001-", "files/002-"]) expect(names).toContain(name);

    await page.reload();
    await expect(page.getByTestId("package-log")).toContainText("Scaricato");
    await page.goto("/condivisione");
    await expect(page.getByTestId("package-list").getByRole("row").nth(1)).toContainText("Studio <Rossi>");
    await expect(page.getByTestId("package-list").getByRole("row").nth(1)).toContainText("Commercialista");
  });

  test("nella scheda del documento compare la storia delle condivisioni", async ({ page }) => {
    await page.goto("/documenti");
    await page.getByRole("link", { name: /Documento riservato/ }).click();
    const history = page.getByTestId("document-sharing");
    await expect(history).toContainText("Studio <Rossi>");
    await expect(history).toContainText("Commercialista");
    await expect(history).toContainText("incluso oltre il livello scelto");
  });

  test("un pacchetto revocato non si scarica piu' e resta nel registro", async ({ page }) => {
    await page.goto(packageUrl);
    await reconfirm(page.context());
    await page.getByRole("button", { name: "Revoca" }).click();
    await expect(page.getByText("Pacchetto revocato: non si può più scaricare")).toBeVisible();
    await expect(page.getByRole("link", { name: "Scarica il pacchetto" })).toHaveCount(0);
    expect((await page.request.get(`/api/condivisione/${packageUrl.split("/").pop()}`)).status()).toBe(410);
    await expect(page.getByTestId("package-log")).toContainText("Revocato");
  });

  test("senza sessione pagine e scarico sono chiusi", async ({ playwright, baseURL }) => {
    const anonymous = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { "x-real-ip": clientIp(91) } });
    for (const path of ["/pratiche", "/pratiche/nuova", "/condivisione", "/condivisione/nuovo", packageUrl]) {
      expect((await anonymous.get(path, { maxRedirects: 0 })).status(), path).toBe(307);
    }
    expect((await anonymous.get(`/api/condivisione/${packageUrl.split("/").pop()}`)).status()).toBe(401);
    await anonymous.dispose();
  });
});
