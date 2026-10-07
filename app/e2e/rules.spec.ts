import { expect, test, type Page } from "@playwright/test";
import { makePdf } from "../tests/helpers/sample-pdf";
import { a11yViolations } from "./support/a11y";
import { clientIp } from "./support/env";
import { STORAGE_STATE } from "./support/secrets";

// Gira dopo registry.spec.ts (ordine alfabetico) e crea i suoi dati: regole di esempio, un bene e un documento.
test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(70) } });
test.describe.configure({ mode: "serial" });

const alert = (page: Page) => page.locator('[data-slot="alert"]');
const item = (page: Page, title: string | RegExp) => page.getByRole("article", { name: title });
let assetUrl = "";

test.describe("regole", () => {
  test("senza regole c'e' lo stato vuoto; le regole di esempio si caricano da qui, tutte da verificare", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Regole" }).click();
    await expect(page).toHaveURL(/\/regole$/);
    await expect(page.getByText("Nessuna regola", { exact: true })).toBeVisible();
    expect(await a11yViolations(page)).toEqual([]);

    const field = page.getByLabel("Comune per l'esempio comunale");
    await field.fill("alfa");
    await page.getByRole("option", { name: "Comune Alfa (EX) · Regione Esempio" }).click();
    await page.getByRole("button", { name: "Carica le regole di esempio" }).click();
    await expect(alert(page)).toContainText("Regole create: 7");

    const list = page.getByTestId("rule-list").getByRole("listitem");
    await expect(list).toHaveCount(7);
    await expect(list.filter({ hasText: "Regola non verificata" })).toHaveCount(7);
    await expect(list.filter({ hasText: "Esempio comunale" })).toContainText("Comunale");
    await expect(list.filter({ hasText: "Esempio comunale" })).toContainText("Comune Alfa");

    // Una seconda volta non duplica nulla.
    await page.getByRole("button", { name: "Carica le regole di esempio" }).click();
    await expect(alert(page)).toContainText("Regole create: 0. Già presenti: 7");
  });

  test("il modulo di una regola segnala cosa manca e non salva", async ({ page }) => {
    await page.goto("/regole/nuova");
    expect(await a11yViolations(page)).toEqual([]);
    await page.getByRole("button", { name: "Crea la regola" }).click();
    const summary = alert(page);
    await expect(summary).toContainText("Ci sono errori da correggere");
    await expect(summary).toContainText("Titolo: campo obbligatorio");
    await expect(summary).toContainText("Fonte: campo obbligatorio");
    await expect(page).toHaveURL(/\/regole\/nuova$/);
  });

  test("si crea una regola dal modulo, senza codice, e se ne legge la condizione a parole", async ({ page }) => {
    await page.goto("/regole/nuova");
    await page.getByLabel("Titolo", { exact: true }).fill("Regola creata a mano");
    await page.getByLabel("Si applica", { exact: true }).selectOption("all");
    const condition = page.getByRole("group", { name: "Condizione 1" });
    await condition.getByLabel("Caratteristica", { exact: true }).selectOption({ label: "Tipo di bene" });
    await condition.getByLabel("Valore", { exact: true }).selectOption("garage");
    await page.getByRole("button", { name: "Aggiungi una condizione" }).click();
    const second = page.getByRole("group", { name: "Condizione 2" });
    await second.getByLabel("Non").check();
    await second.getByLabel("Caratteristica", { exact: true }).selectOption({ label: "Fa parte di un condominio" });
    await second.getByLabel("Valore", { exact: true }).selectOption("true");

    const outcome = page.getByRole("group", { name: "Esito 1" });
    await outcome.getByLabel("Codice", { exact: true }).fill("voce_a_mano");
    await outcome.getByLabel("Titolo dell'esito").fill("Voce creata a mano");
    await outcome.getByLabel("Categoria del dossier").selectOption({ label: "Assicurazioni" });
    await page.getByLabel("Riferimento").fill("Prova automatica");
    expect(await a11yViolations(page)).toEqual([]);
    await page.getByRole("button", { name: "Crea la regola" }).click();

    await expect(page).toHaveURL(/\/regole\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: "Regola creata a mano" })).toBeVisible();
    await expect(page.getByText("Tutte queste condizioni:")).toBeVisible();
    await expect(page.getByText(/Tipo di bene è Garage/)).toBeVisible();
    await expect(page.getByText(/Non: .*Fa parte di un condominio è Sì/)).toBeVisible();
    await expect(page.getByText("Voce creata a mano")).toBeVisible();
    await expect(page.getByText("Regola non verificata").first()).toBeVisible();
  });
});

test.describe("dossier", () => {
  test("un bene con caratteristiche tecniche ottiene le voci attese e i fatti usati", async ({ page }) => {
    await page.goto("/immobili/nuovo");
    await page.getByLabel("Denominazione", { exact: true }).fill("Bene per il dossier");
    await page.getByLabel("Uso", { exact: true }).selectOption("primary_residence");
    await page.getByLabel("Fa parte di un condominio").check();
    const territory = page.getByLabel("Comune", { exact: true });
    await territory.fill("alfa");
    await page.getByRole("option", { name: "Comune Alfa (EX) · Regione Esempio" }).click();
    await page.getByRole("button", { name: "Aggiungi titolare" }).click();
    const right = page.getByRole("group", { name: "Titolare 1" });
    await right.getByLabel("Diritto", { exact: true }).selectOption("co_ownership");
    await right.getByLabel("Quota: numeratore").fill("1");
    await right.getByLabel("Quota: denominatore").fill("2");
    await page.getByRole("button", { name: "Aggiungi una caratteristica" }).click();
    const attribute = page.getByRole("group", { name: "Caratteristica 1" });
    await attribute.getByLabel("Nome", { exact: true }).fill("anno_costruzione");
    await attribute.getByLabel("Tipo", { exact: true }).selectOption("number");
    await attribute.getByLabel("Valore", { exact: true }).fill("1985");
    await page.getByRole("button", { name: "Salva immobile" }).click();

    await expect(page).toHaveURL(/\/immobili\/[0-9a-f-]{36}$/);
    assetUrl = new URL(page.url()).pathname;
    await expect(page.getByTestId("attributes")).toContainText("anno_costruzione");
    await expect(page.getByTestId("attributes")).toContainText("1985");
    // Il dossier e' stato valutato al salvataggio: 7 voci tutte "Mancante".
    await expect(page.getByTestId("dossier-glance")).toContainText("Mancante: 7");

    await page.getByRole("link", { name: "Apri il dossier" }).click();
    await expect(page).toHaveURL(/\/dossier$/);
    await expect(page.getByRole("heading", { level: 1, name: "Dossier: Bene per il dossier" })).toBeVisible();
    await expect(page.getByText("Non attesta la conformità del bene")).toBeVisible();
    await expect(page.getByTestId("dossier-summary")).toContainText("Mancante: 7");
    await expect(page.getByTestId("dossier-summary")).not.toContainText("Presente: 1");
    await expect(page.getByTestId("category-cadastre").getByRole("article")).toHaveCount(2);
    await expect(page.getByTestId("dossier-notices")).toContainText("Bene con più titolari");
    await expect(page.getByRole("article")).toHaveCount(7);
    await expect(item(page, "Visura catastale aggiornata")).toContainText("Regola non verificata");
    await expect(item(page, "Visura catastale aggiornata")).toContainText("Nazionale");

    const impianti = item(page, "Documentazione degli impianti");
    await impianti.getByText("Perché compare?").click();
    await expect(impianti).toContainText("Regola «Esempio: documentazione degli impianti», versione 1");
    await expect(impianti).toContainText("Caratteristica «anno_costruzione»: 1985");
    await expect(impianti).toContainText("Fonte: Esempio illustrativo");
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("lo stato, la nota e i documenti li sceglie il proprietario e si conservano", async ({ page }) => {
    // Un documento da collegare.
    await page.goto("/documenti/nuovo");
    await page.getByLabel("File", { exact: true }).setInputFiles({ name: "visura.pdf", mimeType: "application/pdf", buffer: Buffer.from(makePdf("visura catastale")) });
    await page.getByLabel("Titolo", { exact: true }).fill("Visura per il dossier");
    await page.getByLabel("Valido fino al").fill("2020-01-31");
    await page.getByRole("button", { name: "Carica", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Visura per il dossier" })).toBeVisible();

    await page.goto(`${assetUrl}/dossier`);
    const visura = item(page, "Visura catastale aggiornata");
    await visura.getByLabel(/^Collega un documento/).selectOption({ label: "Visura per il dossier" });
    await visura.getByRole("button", { name: /^Collega/ }).click();
    // Collegare un documento a una voce "mancante" la segna "presente"; il documento scaduto e' segnalato.
    await expect(visura.getByLabel(/^Stato/)).toHaveValue("present");
    await expect(visura).toContainText("Visura per il dossier");
    await expect(visura).toContainText("Documento scaduto il 31/01/2020");
    await expect(page.getByTestId("dossier-summary")).toContainText("Presente: 1");

    await visura.getByLabel(/^Stato/).selectOption("validated_by_professional");
    await visura.getByLabel(/^Nota/).fill("Chiesta al commercialista");
    await visura.getByRole("button", { name: /^Salva la nota/ }).click();
    await expect(visura).toContainText("Nota salvata.");

    await page.reload();
    await expect(item(page, "Visura catastale aggiornata").getByLabel(/^Stato/)).toHaveValue("validated_by_professional");
    await expect(item(page, "Visura catastale aggiornata").getByLabel(/^Nota/)).toHaveValue("Chiesta al commercialista");
    await expect(page.getByTestId("dossier-summary")).toContainText("Validato da un professionista: 1");

    await item(page, "Visura catastale aggiornata").getByRole("button", { name: /^Scollega/ }).click();
    await expect(item(page, "Visura catastale aggiornata")).toContainText("Nessun documento collegato.");
    // Scollegare non cambia lo stato scelto.
    await expect(item(page, "Visura catastale aggiornata").getByLabel(/^Stato/)).toHaveValue("validated_by_professional");
  });

  test("quando la regola non si applica piu' la voce resta, segnata, e lo stato scelto non cambia", async ({ page }) => {
    await page.goto(`${assetUrl}/modifica`);
    await page.getByLabel("Fa parte di un condominio").uncheck();
    await page.getByRole("button", { name: "Salva modifiche" }).click();
    await expect(page).toHaveURL(/\/immobili\/[0-9a-f-]{36}$/);

    await page.goto(`${assetUrl}/dossier`);
    await expect(page.getByRole("article")).toHaveCount(7);
    for (const title of ["Regolamento di condominio e tabelle millesimali", "Ultimo verbale di assemblea"]) {
      await expect(item(page, title)).toContainText("La regola non si applica più: da rivedere");
    }
    await expect(page.getByText("La voce resta com'è finché decidi tu")).toBeVisible();
    await expect(item(page, "Visura catastale aggiornata").getByLabel(/^Stato/)).toHaveValue("validated_by_professional");

    // Ripristinando il condominio le voci tornano valide.
    await page.goto(`${assetUrl}/modifica`);
    await page.getByLabel("Fa parte di un condominio").check();
    await page.getByRole("button", { name: "Salva modifiche" }).click();
    await page.goto(`${assetUrl}/dossier`);
    await expect(page.getByText("La regola non si applica più: da rivedere")).toHaveCount(0);
  });

  test("le voci manuali si aggiungono e si eliminano; quelle da regola no", async ({ page }) => {
    await page.goto(`${assetUrl}/dossier`);
    await page.getByLabel("Categoria", { exact: true }).selectOption({ label: "Controversie, sinistri e comunicazioni formali" });
    await page.getByRole("button", { name: "Aggiungi la voce" }).click();
    await expect(page.getByText("Titolo: campo obbligatorio")).toBeVisible();
    await page.getByLabel("Titolo", { exact: true }).fill("Lettera dell'amministratore");
    await page.getByRole("button", { name: "Aggiungi la voce" }).click();

    const manual = item(page, "Lettera dell'amministratore");
    await expect(manual).toContainText("Manuale");
    await expect(page.getByTestId("category-disputes").getByRole("article")).toHaveCount(1);
    await expect(item(page, "Visura catastale aggiornata").getByRole("button", { name: /Elimina la voce/ })).toHaveCount(0);
    await manual.getByRole("button", { name: /Elimina la voce/ }).click();
    await expect(page.getByRole("article", { name: "Lettera dell'amministratore" })).toHaveCount(0);
  });
});

test.describe("versioni delle regole", () => {
  test("modificare crea una nuova versione, la precedente resta, e il dossier segue senza perdere lo stato", async ({ page }) => {
    await page.goto("/regole");
    await page.getByRole("link", { name: /Esempio: documenti catastali/ }).click();
    await expect(page.getByText("Versione in vigore: 1")).toBeVisible();
    await page.getByRole("link", { name: /Modifica \(nuova versione\)/ }).click();
    await expect(page.getByText("Salvando si crea una nuova versione (2)")).toBeVisible();

    const first = page.getByRole("group", { name: "Esito 1" });
    await first.getByLabel("Titolo dell'esito").fill("Visura catastale rivista");
    await page.getByLabel("Motivo della modifica").fill("Titolo piu' chiaro");
    await page.getByRole("button", { name: "Salva come nuova versione" }).click();

    await expect(page).toHaveURL(/\/regole\/[0-9a-f-]{36}$/);
    await expect(page.getByText("Versione in vigore: 2")).toBeVisible();
    const versions = page.getByTestId("rule-versions").getByRole("listitem");
    await expect(versions).toHaveCount(2);
    await expect(versions.first()).toContainText("Motivo: Titolo piu' chiaro");
    await expect(page.getByText("Visura catastale rivista")).toBeVisible();

    await page.getByRole("button", { name: "Confronta" }).click();
    await expect(page).toHaveURL(/\/confronta\?a=1&b=2$/);
    const row = page.getByTestId("compare-table").getByRole("row").filter({ hasText: "Esiti" });
    await expect(row).toContainText("Diverso");
    await expect(row).toContainText("Visura catastale aggiornata");
    await expect(row).toContainText("Visura catastale rivista");
    expect(await a11yViolations(page)).toEqual([]);

    // Il dossier del bene ha seguito la nuova versione: stessa voce, nuovo titolo, stato scelto intatto.
    await page.goto(`${assetUrl}/dossier`);
    const visura = item(page, "Visura catastale rivista");
    await expect(visura).toContainText("versione 2");
    await visura.getByText("Perché compare?").click();
    await expect(visura).toContainText("versione 2");
    await expect(visura.getByLabel(/^Stato/)).toHaveValue("validated_by_professional");
    await expect(page.getByRole("article", { name: "Visura catastale aggiornata" })).toHaveCount(0);
  });

  test("lo stato di verifica si cambia senza creare una versione, e l'etichetta 'non verificata' sparisce", async ({ page }) => {
    await page.goto("/regole");
    await page.getByRole("link", { name: /Esempio: documenti catastali/ }).click();
    const latest = page.getByTestId("rule-versions").getByRole("listitem").first();
    await latest.getByLabel("Verifica", { exact: true }).selectOption("validated_by_professional");
    await latest.getByRole("button", { name: "Salva la verifica" }).click();
    await expect(latest.getByLabel("Verifica", { exact: true })).toHaveValue("validated_by_professional");
    await expect(page.getByTestId("rule-versions").getByRole("listitem")).toHaveCount(2);

    await page.goto(`${assetUrl}/dossier`);
    await expect(item(page, "Visura catastale rivista")).not.toContainText("Regola non verificata");
    await expect(item(page, "Planimetria catastale")).not.toContainText("Regola non verificata");
    await expect(item(page, "Atto di provenienza")).toContainText("Regola non verificata");
  });

  test("disattivare una regola la toglie dal dossier senza cancellare le voci", async ({ page }) => {
    await page.goto("/regole");
    await page.getByRole("link", { name: /Esempio: documenti di titolo e provenienza/ }).click();
    await page.getByRole("button", { name: "Disattiva" }).click();
    await expect(page.getByText("Questa regola è disattivata")).toBeVisible();

    await page.goto(`${assetUrl}/dossier`);
    await expect(item(page, /Atto di provenienza/)).toContainText("La regola non si applica più: da rivedere");

    await page.goto("/regole");
    await expect(page.getByTestId("rule-list").getByRole("listitem").filter({ hasText: "Esempio: documenti di titolo" })).toHaveCount(0);
    await page.goto("/regole?disattivate=1");
    await expect(page.getByTestId("rule-list")).toContainText("Disattivata");
    await page.getByRole("link", { name: /Esempio: documenti di titolo e provenienza/ }).click();
    await page.getByRole("button", { name: "Riattiva" }).click();
    await expect(page.getByText("Questa regola è disattivata")).toHaveCount(0);
  });

  test("senza sessione le pagine delle regole e del dossier sono chiuse", async ({ playwright, baseURL }) => {
    const anonymous = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { "x-real-ip": clientIp(71) } });
    for (const path of ["/regole", "/regole/nuova", `${assetUrl}/dossier`]) {
      expect((await anonymous.get(path, { maxRedirects: 0 })).status(), path).toBe(307);
    }
    await anonymous.dispose();
  });
});
