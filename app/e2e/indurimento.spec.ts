import { expect, test, type Page } from "@playwright/test";
import { Client } from "./support/pg-client";
import { E2E_DATABASE_URL, clientIp } from "./support/env";
import { STORAGE_STATE } from "./support/secrets";

// Indurimento dello schema: un canone, un premio, un codice o una voce di tributo uguali a una gia' registrata danno un
// messaggio in italiano (non un errore del database). Crea i suoi dati («Indurimento E2E») e li rimuove alla fine.
test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(364) } });
test.describe.configure({ mode: "serial" });

const YEAR = new Date().getFullYear();
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

let lettingId = "";
let policyId = "";

test.beforeAll(async () => {
  await db(async (client) => {
    const asset = (await client.query<{ id: string }>(`insert into asset (kind, name, territory_id) select 'dwelling', 'Casa Indurimento E2E', id from territory where name = 'Comune Alfa' returning id`)).rows[0]!.id;
    lettingId = (await client.query<{ id: string }>("insert into letting (asset_id, type, title) values ($1, 'residential', 'Locazione Indurimento E2E') returning id", [asset])).rows[0]!.id;
    policyId = (await client.query<{ id: string }>("insert into ins_policy (title) values ('Polizza Indurimento E2E') returning id")).rows[0]!.id;
    await client.query("insert into tax_type (name) values ('Tributo Indurimento E2E')");
  });
});

test.afterAll(async () => {
  await db(async (client) => {
    await client.query("delete from letting where title = 'Locazione Indurimento E2E'");
    await client.query("delete from ins_policy where title = 'Polizza Indurimento E2E'");
    await client.query("delete from tax_obligation where asset_id in (select id from asset where name = 'Casa Indurimento E2E')");
    await client.query("delete from tax_type where name = 'Tributo Indurimento E2E'");
    await client.query("delete from asset where name = 'Casa Indurimento E2E'");
  });
});

test.describe("indurimento", () => {
  test("un canone con la stessa scadenza e un codice uguale sono rifiutati con un messaggio", async ({ page }) => {
    await page.goto(`/locazioni/${lettingId}`);
    const rent = form(page, "Aggiungi un importo singolo");
    await rent.getByLabel("Scadenza", { exact: true }).fill(`${YEAR}-03-05`);
    await rent.getByLabel("Importo (€)").fill("500,00");
    await rent.getByRole("button", { name: "Aggiungi", exact: true }).click();
    await expect(page.getByTestId("rents")).toContainText("500,00");

    await rent.getByLabel("Scadenza", { exact: true }).fill(`${YEAR}-03-05`);
    await rent.getByLabel("Importo (€)").fill("90,00");
    await rent.getByRole("button", { name: "Aggiungi", exact: true }).click();
    await expect(rent).toContainText("Esiste già un canone con questa scadenza");

    const code = form(page, "Aggiungi un codice");
    await code.getByLabel("Nome del codice").fill("Codice di prova");
    await code.getByLabel("Codice", { exact: true }).fill("XYZ-1");
    await code.getByRole("button", { name: "Aggiungi un codice" }).click();
    await expect(page.getByTestId("codes")).toContainText("Codice di prova: XYZ-1");
    await code.getByLabel("Nome del codice").fill("Codice di prova");
    await code.getByLabel("Codice", { exact: true }).fill("XYZ-1");
    await code.getByRole("button", { name: "Aggiungi un codice" }).click();
    await expect(code).toContainText("Questo codice è già registrato per la locazione");
  });

  test("un premio con la stessa scadenza e' rifiutato con un messaggio", async ({ page }) => {
    await page.goto(`/assicurazioni/${policyId}`);
    const add = form(page, "Aggiungi un premio");
    await add.getByLabel("Scadenza", { exact: true }).fill(`${YEAR + 1}-01-10`);
    await add.getByLabel("Importo (€)").fill("120,00");
    await add.getByRole("button", { name: "Aggiungi un premio" }).click();
    await expect(page.getByTestId("premiums")).toContainText("120,00 €");
    await add.getByLabel("Scadenza", { exact: true }).fill(`${YEAR + 1}-01-10`);
    await add.getByLabel("Importo (€)").fill("120,00");
    await add.getByRole("button", { name: "Aggiungi un premio" }).click();
    await expect(add).toContainText("Esiste già un premio con questa scadenza");
  });

  test("una voce di tributo identica e' rifiutata finche' non si distingue con un dettaglio", async ({ page }) => {
    const fill = async (detail: string) => {
      await page.goto("/tributi/nuovo");
      await page.getByLabel("Immobile").selectOption({ label: "Casa Indurimento E2E" });
      await page.getByLabel("Tipo di tributo").selectOption({ label: "Tributo Indurimento E2E" });
      await page.getByLabel("Anno", { exact: true }).fill(String(YEAR));
      await page.getByLabel("Dettaglio").fill(detail);
      await page.getByRole("button", { name: "Salva la voce" }).click();
    };
    await fill("");
    await expect(page).toHaveURL(/\/tributi\/[0-9a-f-]{36}$/);
    await fill("");
    await expect(page.locator('[data-slot="alert"]')).toContainText("Esiste già una voce con lo stesso bene, tributo, anno ed etichetta");
    await fill("Acconto");
    await expect(page).toHaveURL(/\/tributi\/[0-9a-f-]{36}$/);
  });
});
