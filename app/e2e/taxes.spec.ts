import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, clientIp } from "./support/env";
import { STORAGE_STATE } from "./support/secrets";

// Gira per ultimo (ordine alfabetico) e condivide il database: crea il suo immobile, il suo contatto e le sue scadenze e li rimuove.
test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(110) } });
test.describe.configure({ mode: "serial" });

const alert = (page: Page) => page.locator('[data-slot="alert"]');
const today = new Date();
const day = (offset: number) => new Date(today.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
const it = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("it-IT");
const YEAR = today.getUTCFullYear();
const form = (page: Page, name: string) => page.getByRole("form", { name, exact: true });
const TITLE = `Imposta locale E2E ${YEAR} – Acconto`;

async function db<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function openObligation(page: Page, name: RegExp | string = TITLE) {
  await page.goto(`/tributi?anno=${YEAR}`);
  await page.getByTestId("obligation-list").getByRole("link", { name }).click();
  await expect(page).toHaveURL(/\/tributi\/[0-9a-f-]{36}$/);
}

test.beforeAll(async () => {
  await db(async (client) => {
    await client.query(`insert into asset (kind, name, territory_id) select 'dwelling', 'Appartamento Tributi E2E', id from territory where name = 'Comune Alfa'`);
    await client.query("insert into party (display_name, roles) values ('Commercialista E2E', '{accountant}')");
  });
});

test.afterAll(async () => {
  await db(async (client) => {
    await client.query("delete from tax_return");
    await client.query("delete from tax_obligation");
    await client.query("delete from tax_type");
    await client.query("delete from deadline");
    await client.query("delete from asset where name = 'Appartamento Tributi E2E'");
    await client.query("delete from party where display_name = 'Commercialista E2E'");
  });
});

test.describe("tributi e pagamenti", () => {
  test("la voce di menu e' attiva; senza voci c'e' lo stato vuoto e l'avviso sui limiti, accessibile", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Tributi e pagamenti", exact: true }).click();
    await expect(page).toHaveURL(/\/tributi$/);
    await expect(page.getByText("Nessuna voce", { exact: true })).toBeVisible();
    await expect(page.getByText("serve il tuo consulente fiscale")).toBeVisible();
    await expect(page.getByText(/Non hai ancora definito nessun tipo di tributo/)).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("i tipi di tributo li scrive il proprietario e il nome e' unico", async ({ page }) => {
    await page.goto("/tributi/tipi");
    expect(await a11yViolations(page)).toEqual([]);
    const add = form(page, "Aggiungi un tipo");
    await add.getByRole("button", { name: "Aggiungi il tipo" }).click();
    await expect(add).toContainText("Nome: campo obbligatorio");
    await add.getByLabel("Nome", { exact: true }).fill("Imposta locale E2E");
    await add.getByLabel("Territorio (tra quelli dei tuoi immobili)").selectOption({ index: 1 });
    await add.getByLabel("Fonte dell'informazione").fill("Comunicazione del Comune");
    await add.getByRole("button", { name: "Aggiungi il tipo" }).click();
    const list = page.getByTestId("tax-types");
    await expect(list).toContainText("Imposta locale E2E");
    await expect(list).toContainText("Fonte: Comunicazione del Comune");

    await add.getByLabel("Nome", { exact: true }).fill("imposta LOCALE e2e");
    await add.getByRole("button", { name: "Aggiungi il tipo" }).click();
    await expect(add).toContainText("Esiste già un tipo con questo nome");
  });

  test("si crea una voce con importo indicato, scadenza collegata e segno «da chiedere al consulente»", async ({ page }) => {
    await page.goto("/tributi/nuovo");
    expect(await a11yViolations(page)).toEqual([]);
    await page.getByRole("button", { name: "Salva la voce" }).click();
    await expect(alert(page)).toContainText("Scegli l'immobile");

    await page.getByLabel("Immobile").selectOption({ label: "Appartamento Tributi E2E" });
    await page.getByLabel("Tipo di tributo").selectOption({ label: "Imposta locale E2E" });
    await page.getByLabel("Anno", { exact: true }).fill(String(YEAR));
    await page.getByLabel("Dettaglio").fill("Acconto");
    await page.getByLabel("Scadenza", { exact: true }).fill(day(20));
    await page.getByLabel("Importo indicato (€)").fill("450,00");
    await page.getByLabel("Da chiedere al consulente").check();
    await page.getByLabel("Crea anche una scadenza").check();
    await page.getByRole("button", { name: "Salva la voce" }).click();

    await expect(page).toHaveURL(/\/tributi\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
    await expect(page.getByText("Nessun pagamento registrato", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Da chiedere al consulente", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Apri la scadenza" })).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("i pagamenti si registrano; la situazione dice solo cio' che risulta dai dati e la scadenza si chiude a importo raggiunto", async ({ page }) => {
    await openObligation(page);
    const pay = form(page, "Registra un pagamento");
    await pay.getByLabel("Data del pagamento").fill(day(-1));
    await pay.getByLabel("Importo pagato (€)").fill("200,00");
    await pay.getByLabel("Riferimento (CRO, numero dell'operazione)").fill("CRO-E2E-1");
    await pay.getByRole("button", { name: "Registra il pagamento" }).click();
    await expect(page.getByTestId("payments")).toContainText("200,00 €");
    await expect(page.getByTestId("payments")).toContainText("Riferimento: CRO-E2E-1");
    await expect(page.getByTestId("payments")).toContainText("Senza prova di pagamento");
    await expect(page.getByText("Pagata in parte", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("250,00 €")).toBeVisible();
    await expect(page.getByText(/non è un calcolo di quanto sia dovuto/)).toBeVisible();

    await pay.getByLabel("Data del pagamento").fill(day(0));
    await pay.getByLabel("Importo pagato (€)").fill("250,00");
    await pay.getByLabel("Natura del pagamento").selectOption("late_payment_correction");
    await pay.getByLabel("Di cui sanzioni (€)").fill("20,00");
    await pay.getByLabel("Di cui interessi (€)").fill("5,00");
    await pay.getByRole("button", { name: "Registra il pagamento" }).click();
    await expect(page.getByTestId("paid-total")).toHaveText("450,00 €");
    await expect(page.getByTestId("payment-extras")).toContainText("Correzione di un pagamento tardivo");
    await expect(page.getByTestId("payment-extras")).toContainText("sanzioni dichiarate 20,00 €");
    await expect(page.getByTestId("payment-extras")).toContainText("interessi dichiarati 5,00 €");
    await expect(page.getByText("Pagamenti pari all'importo indicato", { exact: true }).first()).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);

    await page.goto("/scadenze?vista=completate");
    await expect(page.getByText(`Imposta locale E2E ${YEAR} – Acconto (Appartamento Tributi E2E)`).first()).toBeVisible();
  });

  test("un importo non valido o uguale a zero viene rifiutato con un messaggio", async ({ page }) => {
    await openObligation(page);
    await page.getByRole("button", { name: /^Togli/ }).first().click();
    await expect(page.getByTestId("paid-total")).toHaveText("250,00 €");
    const pay = form(page, "Registra un pagamento");
    await pay.getByLabel("Data del pagamento").fill(day(0));
    await pay.getByLabel("Importo pagato (€)").fill("0");
    await pay.getByRole("button", { name: "Registra il pagamento" }).click();
    await expect(pay).toContainText("L'importo pagato deve essere maggiore di zero");
    await pay.getByLabel("Importo pagato (€)").fill("molto");
    await pay.getByRole("button", { name: "Registra il pagamento" }).click();
    await expect(pay).toContainText("importo non valido");
  });

  test("una voce con la data superata e senza pagamenti e' segnalata, senza giudizi", async ({ page }) => {
    await page.goto("/tributi/nuovo");
    await page.getByLabel("Immobile").selectOption({ label: "Appartamento Tributi E2E" });
    await page.getByLabel("Tipo di tributo").selectOption({ label: "Imposta locale E2E" });
    await page.getByLabel("Anno", { exact: true }).fill(String(YEAR));
    await page.getByLabel("Dettaglio").fill("Saldo");
    await page.getByLabel("Scadenza", { exact: true }).fill(day(-3));
    await page.getByLabel("Importo indicato (€)").fill("80,00");
    await page.getByRole("button", { name: "Salva la voce" }).click();
    await expect(page.getByRole("heading", { level: 1, name: `Imposta locale E2E ${YEAR} – Saldo` })).toBeVisible();
    await expect(page.getByText("Data superata", { exact: true })).toBeVisible();
    await expect(page.getByText("Scadenza", { exact: true }).first()).toBeVisible();

    await page.goto(`/tributi?anno=${YEAR}`);
    await expect(page.getByTestId("tax-totals")).toContainText("Con data superata");
    const row = page.getByTestId("obligation-list").getByRole("listitem").filter({ hasText: "Saldo" });
    await expect(row).toContainText("Data superata");
    await expect(row).toContainText(`scadenza ${it(day(-3))}`);
  });

  test("chiudere una voce richiede un motivo, blocca i pagamenti e si puo' riaprire", async ({ page }) => {
    await openObligation(page, /Saldo/);
    const close = form(page, "Chiudi la voce");
    await close.getByRole("button", { name: "Chiudi la voce" }).click();
    await expect(close).toContainText("Motivo: campo obbligatorio");
    await close.getByLabel("Motivo").fill("Indicazione scritta del consulente");
    await close.getByRole("button", { name: "Chiudi la voce" }).click();
    await expect(page.getByText(/Indicazione scritta del consulente/)).toBeVisible();
    await expect(page.getByText("Chiusa", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("form", { name: "Registra un pagamento" })).toHaveCount(0);
    await page.getByRole("button", { name: "Riapri la voce" }).click();
    await expect(page.getByRole("form", { name: "Registra un pagamento" })).toBeVisible();
  });

  test("le dichiarazioni hanno scadenza, protocollo e stato; presentarle si registra", async ({ page }) => {
    await page.goto("/tributi/dichiarazioni");
    expect(await a11yViolations(page)).toEqual([]);
    const add = form(page, "Aggiungi una dichiarazione o una comunicazione");
    await add.getByLabel("Titolo", { exact: true }).fill("Comunicazione E2E");
    await add.getByLabel("Immobile (facoltativo)").selectOption({ label: "Appartamento Tributi E2E" });
    await add.getByLabel("Scadenza", { exact: true }).fill(day(10));
    await add.getByLabel("Crea anche una scadenza").check();
    await add.getByRole("button", { name: "Aggiungi", exact: true }).click();
    const list = page.getByTestId("returns");
    await expect(list).toContainText(`Comunicazione E2E ${YEAR}`);
    await expect(list).toContainText("Da presentare");

    await list.getByText("Salva le modifiche").first().click();
    const edit = list.getByRole("form", { name: "Salva le modifiche" }).first();
    await edit.getByLabel("Presentata il").fill(day(0));
    await edit.getByLabel("Protocollo o numero di ricevuta").fill("PROT-E2E");
    await edit.getByRole("button", { name: "Salva le modifiche" }).click();
    await expect(list).toContainText("Presentata");
    await expect(list).toContainText("protocollo PROT-E2E");
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("il riepilogo per il consulente raccoglie i dati inseriti e si scarica in CSV", async ({ page, request }) => {
    await page.goto(`/tributi/riepilogo?anno=${YEAR}`);
    await expect(page.getByRole("heading", { level: 1, name: `Riepilogo per il consulente ${YEAR}` })).toBeVisible();
    const table = page.getByTestId("summary-table");
    await expect(table).toContainText("Appartamento Tributi E2E");
    await expect(table).toContainText("450,00 €");
    await expect(page.getByTestId("summary-totals")).toContainText("Totale indicato 530,00 € · pagato 250,00 €");
    await expect(page.getByRole("heading", { level: 2, name: "Da chiedere al consulente" })).toBeVisible();
    await expect(page.getByText(/Pagamenti senza prova di pagamento: 1/)).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);

    const response = await request.get(`/api/tributi/riepilogo?anno=${YEAR}`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/csv");
    expect(response.headers()["content-disposition"]).toContain(`riepilogo-tributi-${YEAR}.csv`);
    const body = await response.text();
    expect(body.charCodeAt(0)).toBe(0xfeff);
    expect(body).toContain(`Riepilogo tributi e pagamenti;${YEAR}`);
    expect(body).toContain("Appartamento Tributi E2E;Imposta locale E2E;Acconto");
    expect((await request.get("/api/tributi/riepilogo?anno=ieri")).status()).toBe(400);
  });
});

test.describe("sicurezza degli accessi ai tributi", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("senza sessione le pagine e il CSV sono chiusi", async ({ page, request }) => {
    for (const path of ["/tributi", "/tributi/nuovo", "/tributi/tipi", "/tributi/dichiarazioni", "/tributi/riepilogo"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/accesso$/);
    }
    const response = await request.get(`/api/tributi/riepilogo?anno=${YEAR}`);
    expect(response.status()).toBe(401);
    expect(await response.text()).not.toContain("Appartamento Tributi E2E");
  });
});
