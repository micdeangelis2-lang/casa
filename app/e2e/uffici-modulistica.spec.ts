import { expect, test, type Page } from "@playwright/test";
import { Client } from "./support/pg-client";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, clientIp } from "./support/env";
import { STORAGE_STATE } from "./support/secrets";

// Modulistica di un ufficio. Crea i suoi dati («Ufficio Modulistica E2E») e li rimuove alla fine.
test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(363) } });
test.describe.configure({ mode: "serial" });

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

let officeId = "";

test.beforeAll(async () => {
  await db(async (client) => {
    officeId = (await client.query<{ id: string }>("insert into party (display_name, roles) values ('Ufficio Modulistica E2E', '{public_office}') returning id")).rows[0]!.id;
  });
});

test.afterAll(async () => {
  await db(async (client) => {
    await client.query("delete from office_form_template where office_party_id = $1", [officeId]);
    await client.query("delete from party where display_name = 'Ufficio Modulistica E2E'");
  });
});

test.describe("modulistica degli uffici", () => {
  test("senza moduli c'e' lo stato vuoto accessibile con l'avvertenza", async ({ page }) => {
    await page.goto(`/uffici/${officeId}`);
    await expect(page.getByRole("heading", { level: 2, name: "Modulistica" })).toBeVisible();
    await expect(page.getByText("Nessun modulo annotato per questo ufficio.")).toBeVisible();
    await expect(page.getByText(/L'app non conosce i moduli degli uffici e non dice cosa un ufficio richieda/)).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("si annota un modulo con checklist, fonte e verifica; si modifica e si archivia", async ({ page }) => {
    await page.goto(`/uffici/${officeId}`);
    const add = form(page, "Annota un modulo");
    await add.getByRole("button", { name: "Annota il modulo" }).click();
    await expect(add).toContainText("Nome del modulo: campo obbligatorio");

    await add.getByLabel("Nome del modulo o della procedura").fill("Modulo A Modulistica E2E");
    await add.getByLabel("Documenti da presentare (uno per riga)").fill("Documento uno\nDocumento due\n\nDocumento uno");
    await add.getByLabel("Fonte").fill("Sportello, annotazione di prova");
    await add.getByLabel("Stato di verifica").selectOption("verified_by_owner");
    await add.getByRole("button", { name: "Annota il modulo" }).click();
    await expect(add).toContainText("Indica la data in cui hai verificato il modulo");
    await add.getByLabel("Data di verifica").fill(new Date().toISOString().slice(0, 10));
    await add.getByRole("button", { name: "Annota il modulo" }).click();

    const item = page.getByTestId("office-forms").getByRole("listitem").filter({ hasText: "Modulo A Modulistica E2E" }).first();
    await expect(item).toBeVisible();
    await expect(item).toContainText("Fonte: Sportello, annotazione di prova");
    await expect(item).toContainText("Verificata da me");
    await expect(item).toContainText("Controllato di recente");
    const checklist = item.getByTestId("office-form-checklist").getByRole("listitem");
    await expect(checklist).toHaveCount(2);
    await expect(checklist.nth(0)).toHaveText("Documento uno");
    await expect(checklist.nth(1)).toHaveText("Documento due");
    expect(await a11yViolations(page)).toEqual([]);

    await item.getByRole("button", { name: /^Modifica/ }).click();
    const edit = form(page, "Modifica il modulo: Modulo A Modulistica E2E");
    await edit.getByLabel("Documenti da presentare (uno per riga)").fill("Solo il terzo");
    await edit.getByLabel("Stato di verifica").selectOption("to_verify");
    await edit.getByRole("button", { name: "Salva le modifiche" }).click();
    await expect(item).toContainText("Non verificato");
    await expect(item.getByTestId("office-form-checklist")).toHaveText("Solo il terzo");

    await item.getByRole("button", { name: /^Archivia/ }).click();
    await expect(page.getByText("Nessun modulo annotato per questo ufficio.")).toBeVisible();
  });
});
