import { expect, test } from "@playwright/test";
import { Client } from "./support/pg-client";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, clientIp } from "./support/env";
import { STORAGE_STATE } from "./support/secrets";

test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(343) } });
test.describe.configure({ mode: "serial" });

const ASSET = "Immobile registri notaio E2E";
const BANK = "Banca registri E2E";
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
  await sql("delete from party where display_name = $1", [BANK]);
}

test.beforeAll(async () => {
  await cleanup();
  assetId = (await sql<{ id: string }>("insert into asset (kind, name, territory_id, address) select 'dwelling', $1, id, 'Via Registri 1' from territory where name = 'Comune Alfa' returning id", [ASSET]))[0]!.id;
  await sql("insert into party (display_name) values ($1)", [BANK]);
});

test.afterAll(cleanup);

test.describe("provenienza e gravami nella scheda del notaio", () => {
  test("senza dati la scheda lo dice e la lacuna sulla provenienza compare", async ({ page }) => {
    await page.goto(`/immobili/${assetId}/notaio`);
    await expect(page.getByTestId("notary-provenance-empty")).toBeVisible();
    await expect(page.getByTestId("notary-encumbrances-empty")).toBeVisible();
    await expect(page.getByTestId("notary-gaps")).toContainText("Non risulta la provenienza");
  });

  test("si registra una provenienza e la lacuna sparisce", async ({ page }) => {
    await page.goto(`/immobili/${assetId}/notaio`);
    const form = page.getByRole("form", { name: "Registra un titolo di provenienza" });
    await form.getByLabel("Tipo").selectOption("inheritance");
    await form.getByLabel("Data dell'atto").fill("2010-05-04");
    await form.getByLabel("Estremi dell'atto (repertorio, raccolta)").fill("Rep. 123 E2E");
    await form.getByRole("button", { name: "Registra la provenienza" }).click();
    const list = page.getByTestId("notary-provenance");
    await expect(list).toContainText("Successione");
    await expect(list).toContainText("04/05/2010");
    await expect(list).toContainText("Rep. 123 E2E");
    await expect(list).toContainText("senza documento collegato");
    await expect(page.getByTestId("notary-gaps")).not.toContainText("Non risulta la provenienza");
    await expect(page.getByTestId("notary-gaps")).toContainText("titoli di provenienza registrati senza documento collegato");
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("si registra un gravame con creditore e importo e si toglie", async ({ page }) => {
    await page.goto(`/immobili/${assetId}/notaio`);
    const form = page.getByRole("form", { name: "Registra un gravame o un vincolo" });
    await form.getByLabel("Tipo").selectOption("mortgage");
    await form.getByLabel("Titolo").fill("Ipoteca registri E2E");
    await form.getByLabel("Data di registrazione").fill("2015-01-02");
    await form.getByLabel("A favore di").selectOption({ label: BANK });
    await form.getByLabel("Importo (€)").fill("100.000,00");
    await form.getByRole("button", { name: "Registra il gravame" }).click();
    const records = page.getByTestId("notary-encumbrance-records");
    await expect(records).toContainText("Ipoteca registri E2E");
    await expect(records).toContainText(`a favore di ${BANK}`);
    await expect(records).toContainText("importo 100.000,00 €");
    await expect(page.getByTestId("notary-encumbrances-empty")).toHaveCount(0);
    expect(await a11yViolations(page)).toEqual([]);

    await records.getByRole("button", { name: /Togli/ }).click();
    await expect(page.getByTestId("notary-encumbrances-empty")).toBeVisible();
  });

  test("un valore non valido viene rifiutato accanto al campo", async ({ page }) => {
    await page.goto(`/immobili/${assetId}/notaio`);
    const form = page.getByRole("form", { name: "Registra un gravame o un vincolo" });
    await form.getByLabel("Tipo").selectOption("restriction");
    await form.getByLabel("Titolo").fill("Vincolo E2E");
    await form.getByLabel("Data di registrazione").fill("2020-01-01");
    await form.getByLabel("Data di fine (se la conosci)").fill("2019-01-01");
    await form.getByRole("button", { name: "Registra il gravame" }).click();
    await expect(form).toContainText("La data di fine è precedente a quella di registrazione");
  });
});
