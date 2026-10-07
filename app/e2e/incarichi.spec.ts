import { expect, test, type Page } from "@playwright/test";
import { Client } from "./support/pg-client";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, clientIp } from "./support/env";
import { STORAGE_STATE } from "./support/secrets";

// Incarichi ai professionisti e elaborati. Crea i suoi dati («Incarichi E2E») e li rimuove alla fine.
test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(362) } });
test.describe.configure({ mode: "serial" });

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const form = (page: Page, name: string) => page.getByRole("form", { name, exact: true });

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
let matterId = "";

test.beforeAll(async () => {
  await db(async (client) => {
    assetId = (await client.query<{ id: string }>(`insert into asset (kind, name, territory_id) select 'dwelling', 'Casa Incarichi E2E', id from territory where name = 'Comune Alfa' returning id`)).rows[0]!.id;
    matterId = (await client.query<{ id: string }>("insert into matter (title, opened_on) values ('Pratica Incarichi E2E', $1) returning id", [day(-20)])).rows[0]!.id;
    await client.query("insert into party (display_name, roles) values ('Avvocato Incarichi E2E', '{lawyer}'), ('Geometra Incarichi E2E', '{surveyor}')");
    const category = (await client.query<{ id: string }>("select id from document_category order by position limit 1")).rows[0]!.id;
    const file = (await client.query<{ id: string }>("insert into file_object (storage_key, sha256, size_bytes, mime_type) values ('incarichi-e2e-1', md5('incarichi'), 1000, 'application/pdf') returning id")).rows[0]!.id;
    const doc = (await client.query<{ id: string }>("insert into document (title, category_id) values ('Relazione Incarichi E2E', $1) returning id", [category])).rows[0]!.id;
    await client.query("insert into document_version (document_id, version_no, file_object_id, original_filename) values ($1, 1, $2, 'relazione.pdf')", [doc, file]);
  });
});

test.afterAll(async () => {
  await db(async (client) => {
    await client.query("delete from engagement where subject like '%Incarichi E2E%'");
    await client.query("delete from matter where title = 'Pratica Incarichi E2E'");
    await client.query("delete from asset where name = 'Casa Incarichi E2E'");
    await client.query("delete from party where display_name in ('Avvocato Incarichi E2E', 'Geometra Incarichi E2E')");
    await client.query("delete from document where title = 'Relazione Incarichi E2E'");
    await client.query("delete from file_object where storage_key = 'incarichi-e2e-1'");
  });
});

test.describe("incarichi", () => {
  test("dalla pagina delle pratiche si apre l'elenco; senza incarichi c'e' lo stato vuoto accessibile", async ({ page }) => {
    await page.goto("/pratiche");
    await page.getByRole("link", { name: "Incarichi ai professionisti" }).click();
    await expect(page).toHaveURL(/\/pratiche\/incarichi$/);
    await expect(page.getByRole("heading", { level: 1, name: "Incarichi ai professionisti" })).toBeVisible();
    await expect(page.getByText("Nessun incarico registrato.")).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("si registra un incarico per professionista, con compenso dichiarato, e compare raggruppato", async ({ page }) => {
    await page.goto("/pratiche/incarichi");
    const add = form(page, "Registra un incarico");
    await add.getByRole("button", { name: "Registra l'incarico" }).click();
    await expect(add).toContainText("Scegli il professionista dalla rubrica");

    await add.getByLabel("Professionista").selectOption({ label: "Avvocato Incarichi E2E" });
    await add.getByLabel("Oggetto dell'incarico").fill("Assistenza Incarichi E2E");
    await add.getByLabel("Data dell'incarico").fill(day(-15));
    await add.getByLabel("Compenso dichiarato (€)").fill("2.000,00");
    await add.getByLabel("Pratica (facoltativa)").selectOption({ label: "Pratica Incarichi E2E" });
    await add.getByRole("button", { name: "Registra l'incarico" }).click();
    await expect(page.getByTestId("engagement-group")).toHaveCount(1);

    await add.getByLabel("Professionista").selectOption({ label: "Geometra Incarichi E2E" });
    await add.getByLabel("Oggetto dell'incarico").fill("Rilievo Incarichi E2E");
    await add.getByLabel("Data dell'incarico").fill(day(-10));
    await add.getByLabel("Immobile (facoltativo)").selectOption({ label: "Casa Incarichi E2E" });
    await add.getByRole("button", { name: "Registra l'incarico" }).click();

    const groups = page.getByTestId("engagement-group");
    await expect(groups).toHaveCount(2);
    const lawyer = groups.filter({ hasText: "Avvocato Incarichi E2E" });
    await expect(lawyer).toContainText("Assistenza Incarichi E2E");
    await expect(lawyer).toContainText("Compenso dichiarato: 2.000,00 €");
    await expect(lawyer).toContainText("In corso");
    const surveyor = groups.filter({ hasText: "Geometra Incarichi E2E" });
    await expect(surveyor).toContainText("Compenso non dichiarato");
    expect(await a11yViolations(page)).toEqual([]);

    // Filtro per professionista.
    await page.getByLabel("Professionista", { exact: true }).first().selectOption({ label: "Geometra Incarichi E2E" });
    await page.getByRole("button", { name: "Mostra" }).click();
    await expect(page.getByTestId("engagement-group")).toHaveCount(1);
    await expect(page.getByTestId("engagement-groups")).not.toContainText("Assistenza Incarichi E2E");
  });

  test("elaborati consegnati e ricevuti, stato e modifica", async ({ page }) => {
    await page.goto("/pratiche/incarichi");
    const item = page.getByTestId("engagement").filter({ hasText: "Rilievo Incarichi E2E" });
    const add = form(page, "Registra un elaborato: Rilievo Incarichi E2E");
    await add.getByRole("button", { name: "Registra l'elaborato" }).click();
    await expect(add).toContainText("Tipo di elaborato: campo obbligatorio");
    await add.getByLabel("Direzione").selectOption("delivered");
    await add.getByLabel("Tipo di elaborato").fill("Visura Incarichi E2E");
    await add.getByLabel("Data", { exact: true }).fill(day(-9));
    await add.getByRole("button", { name: "Registra l'elaborato" }).click();
    await expect(item.getByTestId("deliverables")).toContainText("Visura Incarichi E2E");
    await add.getByLabel("Direzione").selectOption("received");
    await add.getByLabel("Tipo di elaborato").fill("Planimetria Incarichi E2E");
    await add.getByLabel("Data", { exact: true }).fill(day(-5));
    await add.getByLabel("Documento (facoltativo)").selectOption({ label: "Relazione Incarichi E2E" });
    await add.getByRole("button", { name: "Registra l'elaborato" }).click();

    const list = item.getByTestId("deliverables");
    await expect(list.locator('li[data-direction="delivered"]')).toContainText("Visura Incarichi E2E");
    await expect(list.locator('li[data-direction="received"]')).toContainText("Planimetria Incarichi E2E");
    await expect(list.locator('li[data-direction="received"]')).toContainText("Relazione Incarichi E2E");

    await list.getByRole("listitem").filter({ hasText: "Visura Incarichi E2E" }).getByRole("button", { name: /^Togli/ }).click();
    await expect(list).not.toContainText("Visura Incarichi E2E");

    const status = form(page, "Aggiorna lo stato: Rilievo Incarichi E2E");
    await status.getByLabel("Stato").selectOption("completed");
    await status.getByRole("button", { name: "Aggiorna lo stato" }).click();
    await expect(item).toContainText("Concluso");

    await item.getByRole("button", { name: /^Modifica/ }).click();
    const edit = form(page, "Modifica l'incarico: Rilievo Incarichi E2E");
    await edit.getByLabel("Compenso dichiarato (€)").fill("-1");
    await edit.getByRole("button", { name: "Salva le modifiche" }).click();
    await expect(edit).toContainText("Compenso dichiarato: importo non valido");
    await edit.getByLabel("Compenso dichiarato (€)").fill("750,00");
    await edit.getByRole("button", { name: "Salva le modifiche" }).click();
    await expect(item).toContainText("Compenso dichiarato: 750,00 €");
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("gli incarichi compaiono nel fascicolo della pratica e nella scheda per il tecnico", async ({ page }) => {
    await page.goto(`/pratiche/${matterId}/fascicolo`);
    const dossier = page.getByTestId("dossier-engagements");
    await expect(dossier).toContainText("Avvocato Incarichi E2E");
    await expect(dossier).toContainText("Assistenza Incarichi E2E");
    await expect(dossier).toContainText("Compenso dichiarato: 2.000,00 €");
    await expect(dossier).not.toContainText("Rilievo Incarichi E2E");

    await page.goto(`/immobili/${assetId}/scheda-tecnica`);
    const brief = page.getByTestId("brief-engagements");
    await expect(brief).toContainText("Geometra Incarichi E2E");
    await expect(brief).toContainText("Rilievo Incarichi E2E");
    await expect(brief).toContainText("Ricevuto dal professionista: Planimetria Incarichi E2E");
    await expect(brief).not.toContainText("Assistenza Incarichi E2E");
    expect(await a11yViolations(page)).toEqual([]);
  });
});
