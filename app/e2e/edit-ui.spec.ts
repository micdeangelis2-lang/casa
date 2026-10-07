import { expect, test } from "@playwright/test";
import { Client } from "./support/pg-client";
import { conclusiveClaims } from "../tests/helpers/neutral";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, clientIp } from "./support/env";
import { STORAGE_STATE } from "./support/secrets";

test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(370) } });
test.describe.configure({ mode: "serial" });

const ASSET = "Immobile modifiche E2E";
const PARTY_A = "Contatto modifiche A E2E";
const PARTY_B = "Contatto modifiche B E2E";
const MANAGER = "Gestore modifiche E2E";
const CATEGORY_CODES = ["fotografie", "fotografie_2", "foto_prova_e2e"];
let assetId = "";
let partyId = "";

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
  await sql("delete from management_mandate where manager_party_id in (select id from party where display_name = $1)", [MANAGER]);
  await sql("delete from party where display_name = any($1)", [[PARTY_A, PARTY_B, MANAGER]]);
  // Le categorie create dal test: nessun documento le usa, quindi si possono togliere.
  await sql("delete from document_category where code = any($1)", [CATEGORY_CODES]);
}

test.beforeAll(async () => {
  await cleanup();
  assetId = (await sql<{ id: string }>("insert into asset (kind, name, territory_id, address) select 'dwelling', $1, id, 'Via Modifiche 1' from territory where name = 'Comune Alfa' returning id", [ASSET]))[0]!.id;
  partyId = (await sql<{ id: string }>("insert into party (display_name, roles) values ($1, '{technician}') returning id", [PARTY_A]))[0]!.id;
  await sql("insert into party (display_name) values ($1)", [PARTY_B]);
  const manager = (await sql<{ id: string }>("insert into party (display_name, roles) values ($1, '{manager}') returning id", [MANAGER]))[0]!.id;

  await sql("insert into asset_provenance (asset_id, kind, occurred_on, deed_reference) values ($1, 'purchase', '2010-05-04', 'Rep. 1 E2E')", [assetId]);
  await sql("insert into asset_encumbrance (asset_id, kind, title, registered_on, amount_cents) values ($1, 'mortgage', 'Ipoteca modifiche E2E', '2015-01-02', 10000000)", [assetId]);
  const engagement = (await sql<{ id: string }>("insert into listing_engagement (asset_id, kind, starts_on, asking_cents) values ($1, 'sale', '2026-01-01', 25000000) returning id", [assetId]))[0]!.id;
  await sql("insert into listing_event (engagement_id, kind, occurred_on, amount_cents, outcome) values ($1, 'proposal', '2026-03-10', 24000000, 'open')", [engagement]);
  await sql("insert into management_mandate (asset_id, manager_party_id, ends_on, compensation) values ($1, $2, '2099-12-31', 'Compenso E2E 8%')", [assetId, manager]);
  await sql("insert into party_competence (party_id, kind, label, reference) values ($1, 'registration', 'Albo modifiche E2E', 'ISCR-1')", [partyId]);
});

test.afterAll(cleanup);

test.describe("modifica diretta di voci già registrate", () => {
  test("provenienza e gravame della scheda del notaio", async ({ page }) => {
    await page.goto(`/immobili/${assetId}/notaio`);

    const list = page.getByTestId("notary-provenance");
    await expect(list).toContainText("Acquisto");
    await list.getByRole("button", { name: /^Modifica\s*:\s*Acquisto/ }).click();
    const form = page.getByRole("form", { name: "Modifica: Acquisto" });
    await expect(form.getByLabel("Tipo")).toHaveValue("purchase");
    await expect(form.getByLabel("Data dell'atto")).toHaveValue("2010-05-04");
    expect(await a11yViolations(page)).toEqual([]);
    await form.getByLabel("Tipo").selectOption("donation");
    await form.getByLabel("Da chi").selectOption({ label: PARTY_B });
    await form.getByLabel("Estremi dell'atto (repertorio, raccolta)").fill("Rep. 2 E2E");
    await form.getByRole("button", { name: "Salva le modifiche" }).click();
    await expect(list).toContainText("Donazione");
    await expect(list).toContainText(`da ${PARTY_B}`);
    await expect(list).toContainText("Rep. 2 E2E");
    await expect(list).not.toContainText("Rep. 1 E2E");
    await expect(form).toHaveCount(0);

    const records = page.getByTestId("notary-encumbrance-records");
    await records.getByRole("button", { name: /^Modifica\s*:\s*Ipoteca modifiche E2E/ }).click();
    const eform = page.getByRole("form", { name: "Modifica: Ipoteca modifiche E2E" });
    await expect(eform.getByLabel("Importo (€)")).toHaveValue("100.000,00");
    // Un errore resta accanto al campo e il modulo resta aperto.
    await eform.getByLabel("Data di fine (se la conosci)").fill("2014-01-01");
    await eform.getByRole("button", { name: "Salva le modifiche" }).click();
    await expect(eform).toContainText("La data di fine è precedente a quella di registrazione");
    await eform.getByLabel("Data di fine (se la conosci)").fill("2020-06-30");
    await eform.getByLabel("Titolo").fill("Ipoteca modificata E2E");
    await eform.getByLabel("Importo (€)").fill("90.000,50");
    await eform.getByRole("button", { name: "Salva le modifiche" }).click();
    await expect(records).toContainText("Ipoteca modificata E2E");
    await expect(records).toContainText("importo 90.000,50 €");
    await expect(records).toContainText("30/06/2020");

    expect(conclusiveClaims(await page.locator("body").innerText())).toEqual([]);
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("mandato di vendita e proposta nella scheda dell'agente", async ({ page }) => {
    await page.goto(`/immobili/${assetId}/scheda-agente`);
    const listings = page.getByTestId("listing-list");
    await expect(listings).toContainText("richiesto 250.000,00 €");

    await listings.getByRole("button", { name: /^Modifica\s*:\s*Vendita$/ }).click();
    const form = page.getByRole("form", { name: "Modifica: Vendita" });
    await expect(form.getByLabel("Prezzo o canone richiesto (€)")).toHaveValue("250.000,00");
    await form.getByLabel("Mandato in esclusiva").check();
    await form.getByLabel("Prezzo o canone richiesto (€)").fill("240.000");
    await form.getByLabel("Data di fine", { exact: true }).fill("2025-12-31");
    await form.getByRole("button", { name: "Salva le modifiche" }).click();
    await expect(form).toContainText("La data di fine è precedente a quella di inizio");
    await form.getByLabel("Data di fine", { exact: true }).fill("2026-12-31");
    await form.getByRole("button", { name: "Salva le modifiche" }).click();
    await expect(listings).toContainText("richiesto 240.000,00 €");
    await expect(listings).toContainText("In esclusiva");

    const events = page.getByTestId("listing-events");
    await events.getByRole("button", { name: /^Modifica\s*:\s*Proposta/ }).click();
    const eform = page.getByRole("form", { name: /^Modifica\s*:\s*Proposta/ });
    await expect(eform.getByLabel("Importo (€)")).toHaveValue("240.000,00");
    await eform.getByLabel("Tipo").selectOption("counterproposal");
    await eform.getByLabel("Esito").selectOption("accepted");
    await eform.getByLabel("Importo (€)").fill("245.000");
    await eform.getByRole("button", { name: "Salva le modifiche" }).click();
    await expect(events).toContainText("Controproposta");
    await expect(events).toContainText("245.000,00 €");
    await expect(events).toContainText("Accettata");
    await expect(page.getByTestId("listing-counts").first()).toContainText("1 proposta registrata");

    expect(conclusiveClaims(await page.locator("body").innerText())).toEqual([]);
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("mandato di gestione", async ({ page }) => {
    await page.goto("/locazioni/mandati");
    const edit = page.getByTestId("mandates-edit");
    await edit.getByRole("button", { name: new RegExp(`^Modifica\\s*:\\s*${MANAGER}`) }).click();
    const form = page.getByRole("form", { name: `Modifica: ${MANAGER}` });
    await expect(form.getByLabel("Compenso dichiarato (testo libero)")).toHaveValue("Compenso E2E 8%");
    await expect(form.getByLabel("Data di fine del mandato")).toHaveValue("2099-12-31");
    await form.getByLabel("Data di fine del mandato").fill("");
    await form.getByRole("button", { name: "Salva le modifiche" }).click();
    await expect(form).toContainText(/obbligatori|data/i);
    await form.getByLabel("Data di fine del mandato").fill("2099-06-30");
    await form.getByLabel("Compenso dichiarato (testo libero)").fill("Compenso E2E 9%");
    await form.getByRole("button", { name: "Salva le modifiche" }).click();
    const table = page.getByTestId("mandates-list");
    await expect(table).toContainText("Compenso E2E 9%");
    await expect(table).toContainText("30/06/2099");
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("competenza di un contatto", async ({ page }) => {
    await page.goto(`/rubrica/${partyId}/modifica`);
    const list = page.getByTestId("competence-list");
    await list.getByRole("button", { name: /^Modifica\s*:\s*Albo modifiche E2E/ }).click();
    const form = page.getByRole("form", { name: "Modifica: Albo modifiche E2E" });
    await expect(form.getByLabel("Numero o estremi")).toHaveValue("ISCR-1");
    await form.getByLabel("Valida dal").fill("2026-05-01");
    await form.getByLabel("Valida fino al").fill("2026-04-01");
    await form.getByRole("button", { name: "Salva le modifiche" }).click();
    await expect(form).toContainText("La data di fine è precedente a quella di inizio");
    await form.getByLabel("Valida fino al").fill("2030-04-01");
    await form.getByLabel("Descrizione").fill("Albo modificato E2E");
    await form.getByRole("button", { name: "Salva le modifiche" }).click();
    await expect(list).toContainText("Albo modificato E2E");
    await expect(list).toContainText("fino al 01/04/2030");
    expect(await a11yViolations(page)).toEqual([]);
  });
});

test.describe("categorie dei documenti", () => {
  test("la pagina è raggiungibile dalle impostazioni e propone «Fotografie»", async ({ page }) => {
    await page.goto("/impostazioni");
    await page.getByRole("link", { name: /Categorie dei documenti/ }).click();
    await expect(page).toHaveURL(/\/impostazioni\/categorie$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Categorie dei documenti");
    const rows = page.getByTestId("document-category");
    expect(await rows.count()).toBeGreaterThanOrEqual(12);
    await expect(rows.first()).toContainText("Titolo di proprietà");
    await expect(rows.first()).toContainText("Usata dalle schede");
    await expect(page.getByTestId("category-suggested")).toBeVisible();
    expect(conclusiveClaims(await page.locator("body").innerText())).toEqual([]);
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("si aggiunge, si rinomina, si sposta e si rimuove una categoria; una seminata non si rimuove", async ({ page }) => {
    await page.goto("/impostazioni/categorie");
    const rows = page.getByTestId("document-category");
    const before = await rows.count();

    await page.getByTestId("category-suggested").click();
    await expect(rows).toHaveCount(before + 1);
    const photos = rows.filter({ hasText: "Fotografie" });
    await expect(photos).toHaveCount(1);
    await expect(page.getByTestId("category-suggested")).toHaveCount(0);

    // Le categorie seminate si rinominano e si spostano, ma non hanno il pulsante «Rimuovi».
    await expect(rows.first().getByRole("button", { name: /^Rimuovi/ })).toHaveCount(0);
    await expect(rows.first().getByRole("button", { name: /^Su/ })).toBeDisabled();

    // Un nome già presente viene rifiutato accanto al campo.
    const add = page.getByRole("form", { name: "Aggiungi una categoria" });
    await add.getByLabel("Nome").fill("fotografie");
    await add.getByRole("button", { name: "Aggiungi la categoria" }).click();
    await expect(add).toContainText("Esiste già una categoria con questo nome");
    await add.getByLabel("Nome").fill("Foto prova E2E");
    await add.getByRole("button", { name: "Aggiungi la categoria" }).click();
    const prova = rows.filter({ hasText: "Foto prova E2E" });
    await expect(prova).toHaveCount(1);

    // Rinomina.
    await prova.getByRole("button", { name: /^Rinomina/ }).click();
    const rename = page.getByRole("form", { name: "Modifica: Foto prova E2E" });
    await rename.getByLabel("Nome").fill("Foto rinominata E2E");
    await rename.getByRole("button", { name: "Salva le modifiche" }).click();
    const renamed = rows.filter({ hasText: "Foto rinominata E2E" });
    await expect(renamed).toHaveCount(1);
    expect(await a11yViolations(page)).toEqual([]);

    // Sposta su e giù: l'ordine cambia e poi torna com'era.
    const names = async () => (await rows.locator("span.font-medium").allInnerTexts()).filter(Boolean);
    const initial = await names();
    await renamed.getByRole("button", { name: /^Su/ }).click();
    await expect.poll(names).not.toEqual(initial);
    await renamed.getByRole("button", { name: /^Giù/ }).click();
    await expect.poll(names).toEqual(initial);

    // Rimozione delle categorie del test.
    await renamed.getByRole("button", { name: /^Rimuovi/ }).click();
    await expect(rows.filter({ hasText: "Foto rinominata E2E" })).toHaveCount(0);
    await photos.getByRole("button", { name: /^Rimuovi/ }).click();
    await expect(rows).toHaveCount(before);
    await expect(page.getByTestId("category-suggested")).toBeVisible();
  });

  test("una categoria con documenti non si rimuove e dice perché", async ({ page }) => {
    await sql("insert into document_category (code, name, position) values ('foto_prova_e2e', 'Foto con documento E2E', 5000)");
    const category = (await sql<{ id: string }>("select id from document_category where code = 'foto_prova_e2e'"))[0]!.id;
    await sql("insert into document (title, category_id, confidentiality) values ('Documento categoria E2E', $1, 'ordinary')", [category]);
    try {
      await page.goto("/impostazioni/categorie");
      const row = page.getByTestId("document-category").filter({ hasText: "Foto con documento E2E" });
      await expect(row).toContainText("1 documento");
      await expect(row).toContainText("Ha dei documenti");
      await expect(row.getByRole("button", { name: /^Rimuovi/ })).toHaveCount(0);
    } finally {
      await sql("delete from document where title = 'Documento categoria E2E'");
      await sql("delete from document_category where code = 'foto_prova_e2e'");
    }
  });
});
