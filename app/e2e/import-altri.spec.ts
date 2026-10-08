import { expect, test, type Page } from "@playwright/test";
import { Client } from "./support/pg-client";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, clientIp } from "./support/env";
import { clickWhenHydrated } from "./support/hydration";
import { STORAGE_STATE } from "./support/secrets";

// Importazione da CSV degli altri tipi: scadenze, canoni, voci e pagamenti di tributo, polizze, e riga di esempio dei modelli.
// Tutto cio' che si inserisce (anche via importazione) si rimuove alla fine: scadenze, locazioni, tributi, polizze, immobili e
// contatti devono tornare vuoti per gli altri file di test; le righe di audit sono append-only e restano.
test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(381) } });
test.describe.configure({ mode: "serial" });

const P = "Import Alt";
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
    await client.query("delete from deadline where title like $1", [`${P}%`]);
    await client.query("delete from ins_policy where title like $1", [`${P}%`]);
    await client.query("delete from letting where title like $1", [`${P}%`]);
    await client.query("delete from tax_obligation where asset_id in (select id from asset where name like $1)", [`${P}%`]);
    await client.query("delete from tax_type where name like $1", [`${P}%`]);
    await client.query("delete from asset where name like $1", [`${P}%`]);
    await client.query("delete from party where display_name like $1", [`${P}%`]);
  });
}

test.beforeAll(async () => {
  await cleanup();
  await db(async (client) => {
    const asset = (await client.query(`insert into asset (kind, name, territory_id) select 'dwelling', $1, id from territory where name = 'Comune Alfa' returning id`, [`${P} Casa`])).rows[0].id as string;
    await client.query("insert into tax_type (name) values ($1)", [`${P} Imposta`]);
    await client.query("insert into letting (asset_id, type, title) values ($1, 'residential', $2)", [asset, `${P} Locazione`]);
    await client.query("insert into party (display_name, roles) values ($1, '{}')", [`${P} Compagnia`]);
  });
});
test.afterAll(cleanup);

async function upload(page: Page, kind: string, lines: string[]) {
  await page.goto("/importa");
  await page.getByLabel("Cosa vuoi importare").selectOption(kind);
  await page.getByLabel("File CSV").setInputFiles(csv(lines));
  await clickWhenHydrated(page.getByRole("button", { name: "Controlla il file" }));
}

const count = (sql: string, params: unknown[] = []) => db(async (client) => (await client.query(sql, params)).rows[0].n as number);

test.describe("importazione CSV: altri tipi", () => {
  test("i modelli di ogni tipo si scaricano e la pagina offre tutte le scelte, in modo accessibile", async ({ page }) => {
    await page.goto("/importa");
    const options = await page.getByLabel("Cosa vuoi importare").locator("option").allTextContents();
    expect(options).toEqual(["Contatti (rubrica)", "Immobili", "Scadenze (con data scritta a mano)", "Canoni di locazione", "Voci di tributo", "Pagamenti di tributo", "Polizze"]);
    await page.getByLabel("Cosa vuoi importare").selectOption("rents");
    await expect(page.getByText(/Colonne: locazione già registrata/)).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);

    for (const [tipo, intestazione] of [
      ["scadenze", "Titolo;Categoria;Livello;Immobile;Data;Priorità;Note"],
      ["canoni", "Locazione;Scadenza;Importo;Data incasso;Importo incassato"],
      ["tributi", "Immobile;Tipo di tributo;Anno;Etichetta;Importo atteso;Note"],
      ["pagamenti-tributi", "Immobile;Tipo di tributo;Anno;Etichetta;Data pagamento;Importo pagato;Riferimento"],
      ["polizze", "Titolo;Compagnia;Numero polizza;Data inizio;Data fine;Premio;Immobili;Note"],
    ] as const) {
      const response = await page.request.get(`/api/importa/modello?tipo=${tipo}`);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-disposition"]).toContain(`modello-${tipo}.csv`);
      const body = (await response.body()).toString("utf-8");
      expect(body.charCodeAt(0)).toBe(0xfeff);
      expect(body).toContain(intestazione);
      expect(body).toContain("ESEMPIO");
    }
  });

  test("il modello importato cosi' com'e': la riga di esempio e' saltata e non si importa nulla", async ({ page }) => {
    const template = await page.request.get("/api/importa/modello?tipo=scadenze");
    const lines = (await template.body()).toString("utf-8").replace(String.fromCharCode(0xfeff), "").split("\r\n").filter(Boolean);
    await upload(page, "deadlines", lines);
    await expect(page.getByText("Righe lette: 1. Pronte: 0. Già presenti (saltate): 0. Con errori: 0.")).toBeVisible();
    await expect(page.getByText("Righe di esempio del modello (saltate, non vengono mai importate): 1.")).toBeVisible();
    await expect(page.getByRole("row", { name: /ESEMPIO.*Saltata \(riga di esempio\)/ })).toBeVisible();
    await expect(page.getByText("Non ci sono righe pronte da importare.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Importa le/ })).toHaveCount(0);
    expect(await a11yViolations(page)).toEqual([]);
    expect(await count("select count(*)::int as n from deadline where title like 'ESEMPIO%'")).toBe(0);
  });

  test("scadenze: anteprima, importazione e rilettura come già presenti", async ({ page }) => {
    const rows = [
      "Titolo;Categoria;Livello;Immobile;Data;Priorità",
      `${P} Scadenza A;other;contract;${P} Casa;31/12/2099;Alta`,
      `${P} Scadenza B;Tecnica;Nazionale;;2099-06-30;`,
      `${P} Scadenza C;boh;contract;;01/01/2099;`,
    ];
    await upload(page, "deadlines", rows);
    await expect(page.getByText("Righe lette: 3. Pronte: 2. Già presenti (saltate): 0. Con errori: 1.")).toBeVisible();
    await expect(page.getByRole("row", { name: new RegExp(`${P} Scadenza C.*Errore.*Colonna Categoria`) })).toBeVisible();
    expect(await count("select count(*)::int as n from deadline where title like $1", [`${P}%`])).toBe(0);

    await clickWhenHydrated(page.getByRole("button", { name: "Importa le 2 righe pronte" }));
    await expect(page.getByRole("heading", { name: "Importazione completata" })).toBeVisible();
    expect(await count("select count(*)::int as n from deadline_occurrence o join deadline d on d.id = o.deadline_id where d.title like $1 and o.due_on in ('2099-12-31', '2099-06-30') and d.origin = 'manual'", [`${P}%`])).toBe(2);

    await upload(page, "deadlines", rows);
    await expect(page.getByText("Righe lette: 3. Pronte: 0. Già presenti (saltate): 2. Con errori: 1.")).toBeVisible();
  });

  test("canoni: incasso registrato, scadenza già presente saltata", async ({ page }) => {
    await upload(page, "rents", [
      "Locazione;Scadenza;Importo;Data incasso;Importo incassato",
      `${P} Locazione;28/02/2099;1.234,56;05/03/2099;1.234,56`,
      `${P} Locazione;31/03/2099;500,00;;`,
      `${P} Locazione;31/03/2099;500,00;;`,
      `${P} Locazione Sconosciuta;30/04/2099;500,00;;`,
    ]);
    await expect(page.getByText("Righe lette: 4. Pronte: 2. Già presenti (saltate): 1. Con errori: 1.")).toBeVisible();
    await expect(page.getByRole("row", { name: new RegExp(`${P} Locazione Sconosciuta.*Errore.*Colonna Locazione.*non trovata`) })).toBeVisible();
    await clickWhenHydrated(page.getByRole("button", { name: "Importa le 2 righe pronte" }));
    await expect(page.getByRole("heading", { name: "Importazione completata" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Vai alle locazioni" })).toBeVisible();
    expect(await count("select count(*)::int as n from letting_rent r join letting l on l.id = r.letting_id where l.title = $1", [`${P} Locazione`])).toBe(2);
    expect(await count("select paid_cents::int as n from letting_rent r join letting l on l.id = r.letting_id where l.title = $1 and r.due_on = '2099-02-28'", [`${P} Locazione`])).toBe(123456);

    await upload(page, "rents", ["Locazione;Scadenza;Importo", `${P} Locazione;28/02/2099;1.234,56`]);
    await expect(page.getByText("Righe lette: 1. Pronte: 0. Già presenti (saltate): 1. Con errori: 0.")).toBeVisible();
  });

  test("voci e pagamenti di tributo: il tipo deve esistere, il pagamento si lega alla voce", async ({ page }) => {
    await upload(page, "taxes", [
      "Immobile;Tipo di tributo;Anno;Etichetta;Importo atteso",
      `${P} Casa;${P} Imposta;2099;Acconto;400,00`,
      `${P} Casa;${P} Imposta;2099;Acconto;400,00`,
      `${P} Casa;${P} Tipo mai creato;2099;Saldo;`,
    ]);
    await expect(page.getByText("Righe lette: 3. Pronte: 1. Già presenti (saltate): 1. Con errori: 1.")).toBeVisible();
    await expect(page.getByRole("row", { name: /Errore.*Colonna Tipo di tributo.*non crea i tipi/ })).toBeVisible();
    await clickWhenHydrated(page.getByRole("button", { name: "Importa le 1 righe pronte" }));
    await expect(page.getByRole("heading", { name: "Importazione completata" })).toBeVisible();
    expect(await count("select count(*)::int as n from tax_obligation o join asset a on a.id = o.asset_id where a.name = $1 and o.year = 2099", [`${P} Casa`])).toBe(1);
    expect(await count("select count(*)::int as n from tax_type where name like $1", [`${P}%`])).toBe(1);

    await upload(page, "taxPayments", [
      "Immobile;Tipo di tributo;Anno;Etichetta;Data pagamento;Importo pagato;Riferimento",
      `${P} Casa;${P} Imposta;2099;Acconto;10/03/2099;200,00;Rif E2E`,
      `${P} Casa;${P} Imposta;2099;Acconto;10/03/2099;200,00;`,
      `${P} Casa;${P} Imposta;2099;Saldo;10/03/2099;10,00;`,
    ]);
    await expect(page.getByText("Righe lette: 3. Pronte: 1. Già presenti (saltate): 1. Con errori: 1.")).toBeVisible();
    await expect(page.getByRole("row", { name: /Errore.*Nessuna voce/ })).toBeVisible();
    await clickWhenHydrated(page.getByRole("button", { name: "Importa le 1 righe pronte" }));
    await expect(page.getByRole("heading", { name: "Importazione completata" })).toBeVisible();
    await page.getByRole("link", { name: "Vai ai tributi" }).click();
    await expect(page).toHaveURL(/\/tributi$/);
    expect(await count("select coalesce(sum(p.amount_cents), 0)::int as n from tax_payment p join tax_obligation o on o.id = p.obligation_id join asset a on a.id = o.asset_id where a.name = $1", [`${P} Casa`])).toBe(20000);
  });

  test("polizze: compagnia dalla rubrica, immobili collegati, duplicato saltato", async ({ page }) => {
    await upload(page, "policies", [
      "Titolo;Compagnia;Numero polizza;Data inizio;Data fine;Premio;Immobili",
      `${P} Polizza;${P} Compagnia;P-E2E;01/01/2099;31/12/2099;1.234,56;${P} Casa`,
      `${P} Polizza;${P} Compagnia;P-E2E;01/01/2099;;;`,
      `${P} Polizza errata;Compagnia Sconosciuta;;;;;`,
    ]);
    await expect(page.getByText("Righe lette: 3. Pronte: 1. Già presenti (saltate): 1. Con errori: 1.")).toBeVisible();
    await expect(page.getByRole("row", { name: /Errore.*Colonna Compagnia.*non trovato in rubrica/ })).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);
    await clickWhenHydrated(page.getByRole("button", { name: "Importa le 1 righe pronte" }));
    await expect(page.getByRole("heading", { name: "Importazione completata" })).toBeVisible();
    await page.getByRole("link", { name: "Vai alle assicurazioni" }).click();
    await expect(page).toHaveURL(/\/assicurazioni$/);
    expect(await count("select premium_cents::int as n from ins_policy where title = $1", [`${P} Polizza`])).toBe(123456);
    expect(await count("select count(*)::int as n from ins_policy_asset pa join ins_policy p on p.id = pa.policy_id where p.title = $1", [`${P} Polizza`])).toBe(1);
  });
});
