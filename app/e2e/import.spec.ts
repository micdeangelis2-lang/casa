import { expect, test } from "@playwright/test";
import { Client } from "./support/pg-client";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, clientIp } from "./support/env";
import { clickWhenHydrated } from "./support/hydration";
import { STORAGE_STATE } from "./support/secrets";

// Importazione da CSV: anteprima (nessuna scrittura), importazione, elenco. I dati inseriti si rimuovono alla fine
// (rubrica e immobili devono tornare vuoti per gli altri file di test); le righe di audit sono append-only e restano.
test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(380) } });
test.describe.configure({ mode: "serial" });

const PREFIX = "Import E2E";
const csv = (lines: string[]) => ({ name: "dati.csv", mimeType: "text/csv", buffer: Buffer.from(`${lines.join("\r\n")}\r\n`, "utf-8") });

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
    await client.query("delete from asset where name like $1", [`${PREFIX}%`]);
    await client.query("delete from party where display_name like $1", [`${PREFIX}%`]);
  });
}

test.beforeAll(async () => {
  await cleanup();
  await db((client) => client.query("insert into party (display_name, roles, email) values ($1, '{}', 'esistente@esempio.test')", [`${PREFIX} Esistente`]));
});
test.afterAll(cleanup);

test.describe("importazione CSV", () => {
  test("la pagina e' raggiungibile da Impostazioni, il modello si scarica ed e' accessibile", async ({ page }) => {
    await page.goto("/impostazioni");
    await page.getByRole("link", { name: /Importa da file CSV/ }).click();
    await expect(page).toHaveURL(/\/importa$/);
    await expect(page.getByRole("heading", { level: 1, name: "Importa da file CSV" })).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);

    for (const [tipo, intestazione] of [["contatti", "Codice fiscale o partita IVA"], ["immobili", "Denominazione"]] as const) {
      const response = await page.request.get(`/api/importa/modello?tipo=${tipo}`);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toContain("text/csv");
      const body = (await response.body()).toString("utf-8");
      expect(body.charCodeAt(0)).toBe(0xfeff);
      expect(body).toContain(intestazione);
      expect(body).toContain("\r\n");
    }
    expect((await page.request.get("/api/importa/modello?tipo=boh")).status()).toBe(400);
  });

  test("contatti: anteprima senza scrittura, poi importazione delle sole righe pronte", async ({ page }) => {
    await page.goto("/importa");
    await page.getByLabel("File CSV").setInputFiles(
      csv([
        "Nome;Ruoli;Email",
        `${PREFIX} Uno;tenant|Fornitore;uno@esempio.test`,
        `${PREFIX} Due;;due@esempio.test`,
        `${PREFIX} Duplicato;;esistente@esempio.test`,
        `${PREFIX} Errata;;non-una-email`,
      ]),
    );
    await clickWhenHydrated(page.getByRole("button", { name: "Controlla il file" }));

    await expect(page.getByText("Righe lette: 4. Pronte: 2. Già presenti (saltate): 1. Con errori: 1.")).toBeVisible();
    const table = page.getByRole("table", { name: "Esito per ogni riga del file" });
    await expect(table.getByRole("row", { name: new RegExp(`${PREFIX} Uno.*Pronta`) })).toBeVisible();
    await expect(table.getByRole("row", { name: new RegExp(`${PREFIX} Duplicato.*Già presente`) })).toBeVisible();
    await expect(table.getByRole("row", { name: new RegExp(`${PREFIX} Errata.*Errore.*Colonna Email`) })).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);

    // Nessuna scrittura finche' non si conferma.
    const before = await db((client) => client.query("select count(*)::int as n from party where display_name like $1", [`${PREFIX}%`]));
    expect(before.rows[0].n).toBe(1);

    await clickWhenHydrated(page.getByRole("button", { name: "Importa le 2 righe pronte" }));
    await expect(page.getByRole("heading", { name: "Importazione completata" })).toBeVisible();
    await expect(page.getByText("Righe importate: 2. Già presenti e saltate: 1. Con errori e non importate: 1.")).toBeVisible();

    await page.getByRole("link", { name: "Vai alla rubrica" }).click();
    await expect(page).toHaveURL(/\/rubrica$/);
    await expect(page.getByText(`${PREFIX} Uno`).first()).toBeVisible();
    await expect(page.getByText(`${PREFIX} Errata`)).toHaveCount(0);
    const after = await db((client) => client.query("select count(*)::int as n from party where display_name like $1", [`${PREFIX}%`]));
    expect(after.rows[0].n).toBe(3);
  });

  test("file non valido: messaggio leggibile con il numero di riga", async ({ page }) => {
    await page.goto("/importa");
    await page.getByLabel("File CSV").setInputFiles(csv(["Nome", '"aperta']));
    await clickWhenHydrated(page.getByRole("button", { name: "Controlla il file" }));
    await expect(page.locator("p[role=alert]")).toContainText("Riga 2: virgolette aperte e mai chiuse.");
  });

  test("immobili: Comune e titolare risolti, riga con Comune inesistente in errore, poi elenco", async ({ page }) => {
    await page.goto("/importa");
    await page.getByLabel("Cosa vuoi importare").selectOption("assets");
    await page.getByLabel("File CSV").setInputFiles(
      csv([
        "Tipo;Denominazione;Indirizzo;Comune;Provincia;Titolare;Quota;Diritto;Foglio;Particella",
        `Appartamento;${PREFIX} Casa;Via Prova 1;Comune Alfa;EX;${PREFIX} Uno;1/2;Comproprietà;10;20`,
        `garage;${PREFIX} Garage;Via Prova 2;Comune Inesistente;;;;;;`,
      ]),
    );
    await clickWhenHydrated(page.getByRole("button", { name: "Controlla il file" }));
    await expect(page.getByText("Righe lette: 2. Pronte: 1. Già presenti (saltate): 0. Con errori: 1.")).toBeVisible();
    await expect(page.getByRole("row", { name: new RegExp(`${PREFIX} Garage.*Errore.*Colonna Comune.*non trovato`) })).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);

    await clickWhenHydrated(page.getByRole("button", { name: "Importa le 1 righe pronte" }));
    await expect(page.getByRole("heading", { name: "Importazione completata" })).toBeVisible();
    await page.getByRole("link", { name: "Vai agli immobili" }).click();
    await expect(page).toHaveURL(/\/immobili$/);
    await expect(page.getByText(`${PREFIX} Casa`).first()).toBeVisible();
    await expect(page.getByText(`${PREFIX} Garage`)).toHaveCount(0);
  });
});
