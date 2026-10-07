import { expect, test, type Page } from "@playwright/test";
import { Client } from "./support/pg-client";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, clientIp } from "./support/env";
import { STORAGE_STATE } from "./support/secrets";

// Gira dopo backup.spec.ts e prima di deadlines/documents/registry (ordine alfabetico) e condivide il database:
// crea i suoi immobili, il suo contatto e le sue scadenze e li rimuove alla fine.
test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(100) } });
test.describe.configure({ mode: "serial" });

const alert = (page: Page) => page.locator('[data-slot="alert"]');
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const it = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("it-IT");
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

async function openCondominium(page: Page, section?: string) {
  await page.goto("/condominio");
  await page.getByRole("link", { name: /Condominio E2E/ }).click();
  await expect(page).toHaveURL(/\/condominio\/[0-9a-f-]{36}$/);
  if (section) await page.getByRole("navigation", { name: "Sezioni del condominio" }).getByRole("link", { name: section, exact: true }).click();
}

test.beforeAll(async () => {
  await db(async (client) => {
    await client.query(`insert into asset (kind, name, territory_id) select 'dwelling', 'Appartamento A E2E', id from territory where name = 'Comune Alfa'`);
    await client.query(`insert into asset (kind, name, territory_id) select 'other', 'Box E2E', id from territory where name = 'Comune Alfa'`);
    await client.query("insert into party (display_name, roles) values ('Amministratore E2E', '{administrator}')");
  });
});

test.afterAll(async () => {
  await db(async (client) => {
    await client.query("delete from condominium");
    await client.query("delete from deadline");
    await client.query("delete from asset where name in ('Appartamento A E2E', 'Box E2E')");
    await client.query("delete from party where display_name = 'Amministratore E2E'");
  });
});

test.describe("condominio", () => {
  test("la voce di menu e' attiva e senza condomini c'e' lo stato vuoto accessibile", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Condominio", exact: true }).click();
    await expect(page).toHaveURL(/\/condominio$/);
    await expect(page.getByText("Nessun condominio", { exact: true })).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("si crea il condominio e il modulo segnala cosa manca", async ({ page }) => {
    await page.goto("/condominio/nuovo");
    expect(await a11yViolations(page)).toEqual([]);
    await page.getByRole("button", { name: "Crea il condominio" }).click();
    await expect(alert(page)).toContainText("Nome: campo obbligatorio");
    await page.getByLabel("Nome", { exact: true }).fill("Condominio E2E");
    await page.getByLabel("Indirizzo").fill("Via Esempio 1");
    await page.getByLabel("Amministratore").selectOption({ label: "Amministratore E2E" });
    await page.getByRole("button", { name: "Crea il condominio" }).click();
    await expect(page).toHaveURL(/\/condominio\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: "Condominio E2E" })).toBeVisible();
    await expect(page.getByText("Amministratore: Amministratore E2E").first()).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("si collegano gli immobili e ciascuno puo' stare in un solo condominio", async ({ page }) => {
    await openCondominium(page);
    const members = form(page, "Collega un immobile");
    await members.getByLabel("Immobile").selectOption({ label: "Appartamento A E2E" });
    await members.getByLabel("Unità (scala, interno)").fill("Scala A int. 3");
    await members.getByRole("button", { name: "Collega" }).click();
    await expect(page.getByTestId("condo-members")).toContainText("Appartamento A E2E");
    await expect(page.getByTestId("condo-members")).toContainText("Scala A int. 3");
    await form(page, "Collega un immobile").getByLabel("Immobile").selectOption({ label: "Box E2E" });
    await form(page, "Collega un immobile").getByRole("button", { name: "Collega" }).click();
    await expect(page.getByTestId("condo-members")).toContainText("Box E2E");
    await expect(page.getByText("Tutti i tuoi immobili sono già in un condominio.")).toBeVisible();
  });

  test("le tabelle millesimali avvisano se la somma non e' 1000 senza imporla", async ({ page }) => {
    await openCondominium(page, "Millesimi");
    await expect(page.getByText(/Nessuna tabella/)).toBeVisible();
    const add = form(page, "Aggiungi una tabella");
    await add.getByLabel("Nome della tabella").fill("Proprietà generale");
    await add.getByRole("button", { name: "Aggiungi la tabella" }).click();
    await expect(page.getByTestId("millesimal-table")).toHaveCount(1);

    const values = form(page, "Salva i valori");
    await values.getByLabel("Appartamento A E2E (Scala A int. 3)").fill("700");
    await values.getByLabel("Box E2E").fill("200");
    await values.getByRole("button", { name: "Salva i valori" }).click();
    await expect(page.getByText("Somma: 900")).toBeVisible();
    await expect(page.getByText(/La somma non è 1000/)).toBeVisible();

    await values.getByLabel("Appartamento A E2E (Scala A int. 3)").fill("700,5");
    await values.getByLabel("Box E2E").fill("299,5");
    await values.getByRole("button", { name: "Salva i valori" }).click();
    await expect(page.getByText("Somma: 1000")).toBeVisible();
    await expect(page.getByText(/La somma non è 1000/)).toHaveCount(0);
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("un valore dei millesimi non valido viene rifiutato con un messaggio", async ({ page }) => {
    await openCondominium(page, "Millesimi");
    const values = form(page, "Salva i valori");
    await values.getByLabel("Box E2E").fill("abc");
    await values.getByRole("button", { name: "Salva i valori" }).click();
    await expect(values).toContainText(/millesimi non validi/i);
  });

  test("un preventivo si ripartisce in rate in base ai millesimi e le rate si segnano pagate", async ({ page }) => {
    await openCondominium(page, "Esercizi e rate");
    const year = form(page, "Aggiungi un esercizio");
    await year.getByLabel("Esercizio", { exact: true }).fill("2026");
    await year.getByLabel("Dal", { exact: true }).fill("2026-01-01");
    await year.getByLabel("Al", { exact: true }).fill("2026-12-31");
    await year.getByRole("button", { name: "Aggiungi l'esercizio" }).click();
    await expect(page.getByTestId("fiscal-year")).toHaveCount(1);

    const budget = form(page, "Aggiungi il preventivo");
    await budget.getByLabel("Titolo").fill("Preventivo ordinario 2026");
    await budget.getByLabel("Importo totale (€)").fill("1.000,00");
    await budget.getByLabel("Tabella millesimale per la ripartizione").selectOption({ label: "Proprietà generale" });
    await budget.getByRole("button", { name: "Aggiungi il preventivo" }).click();
    await expect(page.getByTestId("budget")).toContainText("Preventivo ordinario 2026");
    await expect(page.getByTestId("budget")).toContainText("Ripartito con: Proprietà generale");

    const first = day(30);
    const plan = form(page, "Calcola le rate");
    await plan.getByLabel("Numero di rate").fill("2");
    await plan.getByLabel("Prima scadenza").fill(first);
    await plan.getByLabel("Ogni quanti mesi").fill("6");
    await plan.getByLabel("Crea anche una scadenza per ogni rata").check();
    await plan.getByRole("button", { name: "Calcola le rate" }).click();
    await expect(page.getByTestId("budget")).toContainText("Rate: 0,00 € pagati su 1.000,00 €");

    await page.getByTestId("budget").getByText("Rate", { exact: true }).click();
    await expect(page.getByTestId("installment")).toHaveCount(4);
    // 700,5 su 1000 di 1.000,00 € = 700,50 € in 2 rate; 299,5 -> 299,50 € in 2 rate
    await expect(page.getByTestId("installment").first()).toContainText(`Rata 1 · Appartamento A E2E · scade il ${it(first)} · 350,25 €`);
    await expect(page.getByTestId("installment").first()).toContainText("Da pagare");

    const firstRow = page.getByTestId("installment").first();
    await firstRow.locator("summary").click();
    await firstRow.getByLabel("Importo pagato (€)").fill("350,25");
    await firstRow.getByRole("button", { name: "Registra il pagamento", exact: true }).click();
    await expect(page.getByTestId("installment").first()).toContainText("Pagata");
    await expect(page.getByTestId("installment").first()).toContainText("senza prova di pagamento");
    await expect(page.getByTestId("budget")).toContainText("Rate: 350,25 € pagati su 1.000,00 €");
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("le scadenze delle rate compaiono nell'elenco delle scadenze", async ({ page }) => {
    await page.goto("/scadenze");
    // Il periodo predefinito e' di 90 giorni: la rata del box (non pagata) c'e', quella dell'appartamento (pagata) e' stata chiusa.
    await expect(page.getByText(/Rata 1\/2 – Preventivo ordinario 2026 \(Box E2E\)/).first()).toBeVisible();
    await expect(page.getByText(/Rata 1\/2 – Preventivo ordinario 2026 \(Appartamento A E2E\)/)).toHaveCount(0);
  });

  test("un'assemblea si prepara con punti e domande, e le delibere non vengono giudicate", async ({ page }) => {
    await openCondominium(page, "Assemblee");
    await expect(page.getByText("Nessuna assemblea.")).toBeVisible();
    const add = form(page, "Aggiungi un'assemblea");
    await add.getByLabel("Data dell'assemblea").fill(day(20));
    await add.getByLabel("Luogo").fill("Sala condominiale");
    await add.getByRole("button", { name: "Aggiungi l'assemblea" }).click();
    await page.getByTestId("meeting-list").getByRole("link", { name: /Assemblea ordinaria del/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: `Assemblea ordinaria del ${it(day(20))}` })).toBeVisible();

    const item = form(page, "Aggiungi il punto");
    await item.getByLabel("Punto", { exact: true }).fill("Approvazione del preventivo");
    await item.getByLabel("Domande da porre").fill("Come sono ripartite le spese?");
    await item.getByRole("button", { name: "Aggiungi il punto" }).click();
    await expect(page.getByTestId("agenda")).toContainText("Approvazione del preventivo");
    await expect(page.getByTestId("preparation")).toContainText("Come sono ripartite le spese?");
    await expect(page.getByTestId("preparation")).toContainText("Nessun documento collegato ai punti.");

    const proxy = form(page, "Registra la delega");
    await proxy.getByLabel("Delegato").selectOption({ label: "Amministratore E2E" });
    await proxy.getByRole("button", { name: "Registra la delega" }).click();
    await expect(page.getByTestId("proxies")).toContainText("Amministratore E2E");

    const resolution = form(page, "Registra la delibera");
    await resolution.getByLabel("Delibera", { exact: true }).fill("Approvazione del preventivo 2026");
    await resolution.getByLabel("Punto all'ordine del giorno").selectOption({ label: "Approvazione del preventivo" });
    await resolution.getByLabel("Esito").selectOption("approved");
    await resolution.getByLabel("Millesimi favorevoli").fill("400");
    await resolution.getByLabel("Soglia indicata (millesimi)").fill("500");
    await resolution.getByRole("button", { name: "Registra la delibera" }).click();
    const recorded = page.getByTestId("resolution").first();
    await expect(recorded).toContainText("Approvata");
    await expect(recorded).toContainText("Registrati: favorevoli 400, contrari —, astenuti —");
    await expect(recorded).toContainText("I favorevoli non raggiungono la soglia indicata.");
    await expect(recorded).toContainText("Da ricontrollare");
    await expect(recorded).toContainText("ricontrolla il verbale con l'amministratore o un professionista");
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("dalla delibera si crea una scadenza e si collega la spesa", async ({ page }) => {
    await openCondominium(page, "Assemblee");
    await page.getByTestId("meeting-list").getByRole("link", { name: /Assemblea ordinaria del/ }).click();
    const recorded = page.getByTestId("resolution").first();
    await expect(recorded).toContainText("Nessun seguito.");

    const deadline = recorded.getByRole("form", { name: "Crea la scadenza" });
    await deadline.getByLabel("Titolo della scadenza").fill("Versare la prima rata del preventivo");
    await deadline.getByLabel("Entro il").fill(day(40));
    await deadline.getByRole("button", { name: "Crea la scadenza" }).click();
    await expect(recorded).toContainText("Scadenza creata");

    const budget = recorded.getByRole("form", { name: "Spesa collegata (preventivo)" });
    await budget.getByLabel("Spesa collegata (preventivo)").selectOption({ label: "2026 – Preventivo ordinario 2026" });
    await budget.getByRole("button", { name: "Collega la spesa" }).click();
    await expect(recorded).toContainText("Spesa: Preventivo ordinario 2026");

    await page.goto("/scadenze");
    await expect(page.getByText("Versare la prima rata del preventivo").first()).toBeVisible();
  });

  test("i lavori hanno stato, preventivi e fatture", async ({ page }) => {
    await openCondominium(page, "Lavori");
    const add = form(page, "Aggiungi un lavoro");
    await add.getByLabel("Lavoro", { exact: true }).fill("Rifacimento della facciata");
    await add.getByLabel("Importo previsto (€)").fill("20.000,00");
    await add.getByRole("button", { name: "Aggiungi il lavoro" }).click();
    const work = page.getByTestId("work").first();
    await expect(work).toContainText("Rifacimento della facciata");
    await expect(work).toContainText("Previsto 20.000,00 €");

    const entry = work.getByRole("form", { name: "Aggiungi la voce" });
    await entry.getByLabel("Tipo").selectOption("invoice");
    await entry.getByLabel("Titolo").fill("Acconto");
    await entry.getByLabel("Importo (€)").fill("5.000,00");
    await entry.getByRole("button", { name: "Aggiungi la voce" }).click();
    await expect(work).toContainText("Fatturato 5.000,00 €");

    const status = work.getByRole("form", { name: "Aggiorna lo stato" });
    await status.getByLabel("Stato").selectOption("in_progress");
    await status.getByRole("button", { name: "Aggiorna lo stato" }).click();
    await expect(work).toContainText("In corso");
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("sinistri e comunicazioni si aprono e si chiudono", async ({ page }) => {
    await openCondominium(page, "Segnalazioni");
    const add = form(page, "Aggiungi una voce");
    await add.getByLabel("Titolo").fill("Infiltrazione dal terrazzo");
    await add.getByLabel("Descrizione").fill("Macchia sul soffitto del box");
    await add.getByRole("button", { name: "Aggiungi la voce" }).click();
    const claim = page.getByTestId("claim-list").getByRole("listitem").first();
    await expect(claim).toContainText("Infiltrazione dal terrazzo");
    await expect(claim).toContainText("Aperta");
    await claim.getByRole("button", { name: /Chiudi/ }).click();
    await expect(claim).toContainText("Chiusa");
    await expect(claim.getByRole("button", { name: /Riapri/ })).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("un contratto scaduto viene segnalato", async ({ page }) => {
    await openCondominium(page, "Contratti");
    const add = form(page, "Aggiungi un contratto o una certificazione");
    await add.getByLabel("Titolo").fill("Pulizia scale");
    await add.getByLabel("Valido fino al").fill(day(-5));
    await add.getByRole("button", { name: "Aggiungi", exact: true }).click();
    await expect(page.getByTestId("contract-list")).toContainText("Pulizia scale");
    await expect(page.getByTestId("contract-list")).toContainText("Scaduto");

    await add.getByLabel("Titolo").fill("Manutenzione ascensore");
    await add.getByLabel("Valido fino al").fill(day(30));
    await add.getByRole("button", { name: "Aggiungi", exact: true }).click();
    await expect(page.getByTestId("contract-list")).toContainText("In scadenza entro 60 giorni");
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("si archivia il condominio: sparisce dall'elenco ma si ritrova e si ripristina", async ({ page }) => {
    await openCondominium(page);
    await page.getByRole("button", { name: "Archivia" }).click();
    await expect(page.getByText("Archiviato", { exact: true }).first()).toBeVisible();
    await page.goto("/condominio");
    await expect(page.getByText("Nessun condominio", { exact: true })).toBeVisible();
    await page.getByLabel("Mostra anche i condomini archiviati").check();
    await page.getByRole("button", { name: "Applica" }).click();
    await page.getByRole("link", { name: /Condominio E2E/ }).click();
    await page.getByRole("button", { name: "Ripristina" }).click();
    await expect(page.getByRole("button", { name: "Archivia" })).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);
  });
});
