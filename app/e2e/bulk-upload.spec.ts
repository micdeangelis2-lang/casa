import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { makePdf } from "../tests/helpers/sample-pdf";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, clientIp } from "./support/env";
import { STORAGE_STATE } from "./support/secrets";

// Caricamento multiplo: un file alla volta, esito per file. I documenti creati (e quello gia' presente, inserito a mano
// per provare l'avviso sui duplicati) si rimuovono alla fine: documents.spec.ts e pagination.spec.ts contano sull'elenco vuoto.
test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(280) } });
test.describe.configure({ mode: "serial" });

const PREFIX = "Bulk E2E";
const EXISTING = makePdf("Bulk e2e documento gia presente");
const pdf = (name: string, bytes: Uint8Array) => ({ name, mimeType: "application/pdf", buffer: Buffer.from(bytes) });
const OVERSIZED = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(25 * 1024 * 1024)]);

async function db<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function cleanup() {
  await db(async (client) => {
    const { rows } = await client.query(
      "select dv.file_object_id as id from document_version dv join document d on d.id = dv.document_id where d.title like $1",
      [`${PREFIX}%`],
    );
    await client.query("delete from document where title like $1", [`${PREFIX}%`]);
    const ids = rows.map((r) => r.id as string);
    if (ids.length > 0) await client.query("delete from file_object where id = any($1::uuid[])", [ids]);
  });
}

test.beforeAll(async () => {
  await cleanup();
  await db(async (client) => {
    const { rows: cat } = await client.query("select id from document_category order by position limit 1");
    const { rows: file } = await client.query(
      "insert into file_object (storage_key, sha256, size_bytes, mime_type) values ('bulk-e2e-existing', $1, $2, 'application/pdf') returning id",
      [createHash("sha256").update(EXISTING).digest("hex"), EXISTING.length],
    );
    const { rows: doc } = await client.query("insert into document (title, category_id) values ($1, $2) returning id", [`${PREFIX} gia in archivio`, cat[0].id]);
    await client.query("insert into document_version (document_id, version_no, file_object_id, original_filename) values ($1, 1, $2, 'gia-in-archivio.pdf')", [doc[0].id, file[0].id]);
  });
});

test.afterAll(cleanup);

const row = (page: Page, name: string) => page.getByTestId("bulk-items").getByRole("listitem").filter({ hasText: name });

test.describe("caricamento multiplo di documenti", () => {
  test("e' raggiungibile dall'elenco, accessibile e parte vuoto", async ({ page }) => {
    await page.goto("/documenti");
    await page.getByRole("link", { name: "Carica più documenti" }).click();
    await expect(page).toHaveURL(/\/documenti\/carica-piu$/);
    await expect(page.getByRole("heading", { level: 1, name: "Carica più documenti" })).toBeVisible();
    await expect(page.getByText("Nessun file scelto.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Carica 0 file" })).toBeDisabled();
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("propone i titoli dai nomi, esito per file, duplicati e rifiuti senza fermare gli altri", async ({ page }) => {
    await page.goto("/documenti/carica-piu");
    await page.getByLabel("File da caricare").setInputFiles([
      pdf("relazione_tecnica--2024.pdf", makePdf("Bulk e2e relazione tecnica")),
      pdf("planimetria generale.pdf", makePdf("Bulk e2e planimetria")),
      pdf("gia presente.pdf", EXISTING),
      { name: "falso.pdf", mimeType: "application/pdf", buffer: Buffer.from("MZ\u0090\u0000non e' un pdf") },
      { name: "enorme.pdf", mimeType: "application/pdf", buffer: OVERSIZED },
    ]);

    // Titoli precompilati dal nome del file, modificabili.
    await expect(page.getByLabel("Titolo di relazione_tecnica--2024.pdf")).toHaveValue("relazione tecnica 2024");
    await expect(page.getByLabel("Titolo di planimetria generale.pdf")).toHaveValue("planimetria generale");
    await page.getByLabel("Titolo di relazione_tecnica--2024.pdf").fill(`${PREFIX} relazione`);
    await page.getByLabel("Titolo di planimetria generale.pdf").fill(`${PREFIX} planimetria`);
    await page.getByLabel("Titolo di gia presente.pdf").fill(`${PREFIX} duplicato`);
    await page.getByLabel("Titolo di falso.pdf").fill(`${PREFIX} falso`);

    // Il file oltre il limite e' rifiutato subito, senza essere inviato.
    await expect(row(page, "enorme.pdf")).toContainText("Rifiutato");
    await expect(row(page, "enorme.pdf")).toContainText("Il file supera il limite di 25 MB");
    await expect(page.getByRole("button", { name: "Carica 4 file" })).toBeEnabled();

    await page.getByRole("button", { name: "Carica 4 file" }).click();
    const summary = page.getByTestId("bulk-summary");
    await expect(summary).toContainText("2 caricati, 1 già presenti, 2 rifiutati, 0 con errore.", { timeout: 60_000 });
    await expect(summary).toBeFocused();
    await expect(summary).toHaveAttribute("role", "status");

    // Esito per file, in parole (non solo colore o icona).
    await expect(row(page, "relazione_tecnica--2024.pdf")).toContainText("Caricato");
    await expect(row(page, "relazione_tecnica--2024.pdf").getByRole("link", { name: `Apri la scheda di ${PREFIX} relazione` })).toBeVisible();
    await expect(row(page, "planimetria generale.pdf")).toContainText("Caricato");
    await expect(row(page, "gia presente.pdf")).toContainText("Già presente");
    await expect(row(page, "gia presente.pdf")).toContainText(`${PREFIX} gia in archivio`);
    await expect(row(page, "falso.pdf")).toContainText("Rifiutato");
    await expect(row(page, "falso.pdf")).toContainText("Tipo di file non ammesso");
    expect(await a11yViolations(page)).toEqual([]);

    // La scheda aperta dal link esiste.
    await row(page, "relazione_tecnica--2024.pdf").getByRole("link", { name: /Apri la scheda/ }).click();
    await expect(page).toHaveURL(/\/documenti\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: `${PREFIX} relazione` })).toBeVisible();
  });

  test("in elenco compaiono solo i documenti caricati", async ({ page }) => {
    await page.goto(`/documenti?q=${encodeURIComponent(PREFIX)}`);
    const list = page.getByTestId("document-list");
    await expect(list).toContainText(`${PREFIX} relazione`);
    await expect(list).toContainText(`${PREFIX} planimetria`);
    await expect(list).toContainText(`${PREFIX} gia in archivio`);
    await expect(list).not.toContainText(`${PREFIX} duplicato`);
    await expect(list).not.toContainText(`${PREFIX} falso`);
    await expect(list.getByRole("listitem")).toHaveCount(3);
  });

  test("il file gia' presente si carica solo su richiesta esplicita; i rifiutati si possono riprovare", async ({ page }) => {
    await page.goto("/documenti/carica-piu");
    await page.getByLabel("File da caricare").setInputFiles([pdf("gia presente.pdf", EXISTING)]);
    await page.getByLabel("Titolo di gia presente.pdf").fill(`${PREFIX} duplicato`);
    await page.getByRole("button", { name: "Carica 1 file" }).click();
    await expect(row(page, "gia presente.pdf")).toContainText("Già presente", { timeout: 30_000 });

    await page.getByRole("button", { name: "Carica comunque gia presente.pdf" }).click();
    await expect(row(page, "gia presente.pdf")).toContainText("Caricato", { timeout: 30_000 });
    await expect(page.getByTestId("bulk-summary")).toContainText("1 caricati, 0 già presenti, 0 rifiutati, 0 con errore.");

    // Con la scheda del documento si vede l'avviso sui duplicati del modulo singolo.
    await row(page, "gia presente.pdf").getByRole("link", { name: /Apri la scheda/ }).click();
    await expect(page.getByTestId("duplicates")).toContainText(`${PREFIX} gia in archivio`);
  });

  test("un file non riconosciuto si puo' riprovare (e si toglie dal lotto) senza toccare gli altri", async ({ page }) => {
    await page.goto("/documenti/carica-piu");
    await page.getByLabel("File da caricare").setInputFiles([
      { name: "strano.pdf", mimeType: "application/pdf", buffer: Buffer.from("MZ\u0090\u0000non e' un pdf") },
    ]);
    await page.getByLabel("Titolo di strano.pdf").fill(`${PREFIX} strano`);
    await page.getByRole("button", { name: "Carica 1 file" }).click();
    await expect(row(page, "strano.pdf")).toContainText("Rifiutato", { timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Riprova i non caricati (1)" })).toBeVisible();
    await page.getByRole("button", { name: "Riprova i non caricati (1)" }).click();
    await expect(page.getByTestId("bulk-summary")).toContainText("0 caricati, 0 già presenti, 1 rifiutati, 0 con errore.");
    await page.getByRole("button", { name: "Togli strano.pdf dal lotto" }).click();
    await expect(page.getByText("Nessun file scelto.")).toBeVisible();
  });

  test("un lotto è limitato a 20 file", async ({ page }) => {
    await page.goto("/documenti/carica-piu");
    const many = Array.from({ length: 22 }, (_, i) => pdf(`lotto ${i + 1}.pdf`, makePdf(`Bulk e2e lotto ${i}`)));
    await page.getByLabel("File da caricare").setInputFiles(many);
    await expect(page.getByText("File del lotto (20)")).toBeVisible();
    await expect(page.getByText("Il lotto può contenere al massimo 20 file: 2 non sono stati aggiunti.")).toBeVisible();
  });
});
