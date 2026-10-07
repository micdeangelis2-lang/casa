import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { makePdf } from "../tests/helpers/sample-pdf";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, clientIp } from "./support/env";
import { STORAGE_STATE } from "./support/secrets";

// Il file gira prima di registry.spec.ts (ordine alfabetico) e condivide il database: crea il suo immobile e lo rimuove.
test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(50) } });
test.describe.configure({ mode: "serial" });

const alert = (page: Page) => page.locator('[data-slot="alert"]');
const CONTRACT = makePdf("Canone mensile concordato quattrocento euro");
const pdf = (name: string, buffer: Buffer = Buffer.from(CONTRACT)) => ({ name, mimeType: "application/pdf", buffer });

let assetId = "";

test.beforeAll(async () => {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  const { rows } = await client.query(
    `insert into asset (kind, name, territory_id) select 'dwelling', 'Immobile per documenti', id from territory where name = 'Comune Alfa' returning id`,
  );
  assetId = rows[0].id;
  await client.end();
});

test.afterAll(async () => {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  await client.query("delete from asset where id = $1", [assetId]);
  await client.end();
});

test.describe("documenti", () => {
  test("la voce di menu e' attiva e mostra lo stato vuoto accessibile", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Documenti" }).click();
    await expect(page).toHaveURL(/\/documenti$/);
    await expect(page.getByText("Nessun documento", { exact: true })).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("senza file o con un tipo non ammesso non salva e spiega perche'", async ({ page }) => {
    await page.goto("/documenti/nuovo");
    expect(await a11yViolations(page)).toEqual([]);
    await page.getByRole("button", { name: "Carica", exact: true }).click();
    await expect(alert(page)).toContainText("Scegli il file da caricare");

    await page.getByLabel("File", { exact: true }).setInputFiles({ name: "falso.pdf", mimeType: "application/pdf", buffer: Buffer.from("MZ\u0090\u0000non e' un pdf") });
    await page.getByRole("button", { name: "Carica", exact: true }).click();
    await expect(alert(page)).toContainText("Tipo di file non ammesso");
    await expect(page).toHaveURL(/\/documenti\/nuovo$/);
  });

  test("si carica un PDF collegato a un immobile e il titolo parte dal nome del file", async ({ page }) => {
    await page.goto("/documenti/nuovo");
    await page.getByLabel("File", { exact: true }).setInputFiles(pdf("contratto affitto.pdf"));
    await page.getByLabel("Immobile per documenti").check();
    await page.getByLabel("Valido fino al").fill("2028-02-29");
    await page.getByRole("button", { name: "Carica", exact: true }).click();

    await expect(page).toHaveURL(/\/documenti\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: "contratto affitto" })).toBeVisible();
    await expect(page.getByTestId("document-assets")).toContainText("Immobile per documenti");
    const version = page.getByTestId("versions").getByRole("listitem").first();
    await expect(version).toContainText("Versione 1 – contratto affitto.pdf");
    await expect(version).toContainText("Testo estratto");
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("si ritrova dal contenuto del PDF, anche con un'altra forma della parola", async ({ page }) => {
    await page.goto("/documenti?q=canoni");
    await expect(page.getByTestId("document-list")).toContainText("contratto affitto");
    await page.goto("/documenti?q=zzzzzz");
    await expect(page.getByText("Nessun documento corrisponde alla ricerca.")).toBeVisible();
    await page.goto("/documenti?immobile=" + assetId);
    await expect(page.getByTestId("document-list")).toContainText("contratto affitto");
  });

  test("il file si apre solo con la sessione del proprietario", async ({ page, playwright, baseURL }) => {
    await page.goto("/documenti");
    await page.getByRole("link", { name: /contratto affitto/ }).click();
    const href = await page.getByRole("link", { name: /Apri/ }).getAttribute("href");
    expect(href).toMatch(/^\/api\/documenti\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);

    const ok = await page.request.get(href!);
    expect(ok.status()).toBe(200);
    expect(ok.headers()["content-type"]).toBe("application/pdf");
    expect(ok.headers()["content-disposition"]).toContain("inline");
    expect(ok.headers()["x-content-type-options"]).toBe("nosniff");
    expect((await ok.body()).subarray(0, 5).toString()).toBe("%PDF-");

    const download = await page.request.get(`${href}?scarica=1`);
    expect(download.headers()["content-disposition"]).toContain("attachment");
    await download.body();

    // Contesto senza cookie: lo storageState del progetto si eredita, quindi lo si svuota esplicitamente.
    const anonymous = await playwright.request.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
      extraHTTPHeaders: { "x-real-ip": clientIp(51) },
    });
    expect((await anonymous.get(href!)).status()).toBe(401);
    await anonymous.dispose();
  });

  test("una nuova versione non cancella la precedente", async ({ page }) => {
    await page.goto("/documenti");
    await page.getByRole("link", { name: /contratto affitto/ }).click();
    await page.getByRole("link", { name: "Aggiungi una nuova versione" }).click();
    await page.getByLabel("File", { exact: true }).setInputFiles(pdf("contratto affitto rinnovo.pdf", Buffer.from(makePdf("Rinnovo del contratto"))));
    await page.getByLabel("Valido fino al").fill("2032-02-29");
    await page.getByRole("button", { name: "Carica la nuova versione" }).click();

    const versions = page.getByTestId("versions").getByRole("listitem");
    await expect(versions).toHaveCount(2);
    await expect(versions.first()).toContainText("Versione 2 – contratto affitto rinnovo.pdf");
    await expect(versions.first()).toContainText("Corrente");
    await expect(versions.last()).toContainText("Versione 1 – contratto affitto.pdf");
  });

  test("lo stesso file caricato due volte e' segnalato come possibile duplicato, senza bloccare", async ({ page }) => {
    await page.goto("/documenti/nuovo");
    await page.getByLabel("File", { exact: true }).setInputFiles(pdf("copia.pdf", Buffer.from(makePdf("Rinnovo del contratto"))));
    await page.getByLabel("Titolo", { exact: true }).fill("Copia del rinnovo");
    await page.getByRole("button", { name: "Carica", exact: true }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Copia del rinnovo" })).toBeVisible();
    await expect(page.getByTestId("duplicates")).toContainText("contratto affitto");
    await expect(page.getByTestId("duplicates")).toContainText("ha lo stesso file");
  });

  test("dalla scheda dell'immobile si vedono i documenti e si carica uno gia' collegato", async ({ page }) => {
    await page.goto(`/immobili/${assetId}`);
    await expect(page.getByTestId("asset-documents")).toContainText("contratto affitto");
    await page.getByRole("link", { name: "Carica un documento per questo immobile" }).click();
    await expect(page.getByLabel("Immobile per documenti")).toBeChecked();
  });

  test("si modifica, si archivia e si ripristina", async ({ page }) => {
    await page.goto("/documenti");
    await page.getByRole("link", { name: /Copia del rinnovo/ }).click();
    await page.getByRole("link", { name: "Modifica" }).click();
    await page.getByLabel("Titolo", { exact: true }).fill("Rinnovo contratto");
    await page.getByLabel("Riservatezza").selectOption({ label: "Riservato" });
    await page.getByLabel("Stato di verifica").selectOption({ label: "Verificato da me" });
    await page.getByRole("button", { name: "Salva le modifiche" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Rinnovo contratto" })).toBeVisible();
    await expect(page.getByText("Riservato", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Archivia" }).click();
    await expect(page.getByText("Questo documento è archiviato")).toBeVisible();
    await page.goto("/documenti");
    await expect(page.getByTestId("document-list")).not.toContainText("Rinnovo contratto");
    await page.goto("/documenti?archiviati=1");
    await expect(page.getByTestId("document-list")).toContainText("Rinnovo contratto");
    await page.getByRole("link", { name: /Rinnovo contratto/ }).click();
    await page.getByRole("button", { name: "Ripristina" }).click();
    await expect(page.getByText("Questo documento è archiviato")).toHaveCount(0);
  });
});
