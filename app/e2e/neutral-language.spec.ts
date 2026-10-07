import { expect, test } from "@playwright/test";
import { conclusiveClaims } from "../tests/helpers/neutral";
import { a11yViolations } from "./support/a11y";
import { clientIp } from "./support/env";
import { PAGES } from "./support/pages";
import { STORAGE_STATE } from "./support/secrets";

// Sola lettura: visita ogni schermata dell'app e controlla il testo che l'utente vede davvero (dati compresi).
// Gira dopo i file che creano dati (ordine alfabetico: documents, insurance, lettings, maintenance, matters-sharing) ma questi
// ripuliscono: qui si verifica il linguaggio, non i flussi.
test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(150) } });


test.describe("linguaggio neutro e limiti dell'assistenza", () => {
  test("nessuna schermata contiene un verdetto e ognuna rimanda ai limiti dell'assistenza", async ({ page }) => {
    for (const path of PAGES) {
      await page.goto(path);
      await expect(page.locator("main").first(), path).toBeVisible();
      const text = await page.locator("body").innerText();
      expect(conclusiveClaims(text), `verdetto su ${path}`).toEqual([]);
      // Su ogni schermata, nella barra laterale, c'e' l'avvertenza e il collegamento ai limiti.
      await expect(page.getByRole("link", { name: "Cosa fa e cosa non fa l'app" }), path).toBeVisible();
    }
  });

  test("la pagina dei limiti elenca cio' che l'app non dichiara mai e quando serve un professionista, ed e' accessibile", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Cosa fa e cosa non fa l'app" }).first().click();
    await expect(page).toHaveURL(/\/limiti$/);
    await expect(page.getByRole("heading", { level: 1, name: "Cosa fa e cosa non fa l'app" })).toBeVisible();
    const never = page.getByTestId("never-list");
    await expect(never).toContainText("che un immobile sia conforme o in regola");
    await expect(never).toContainText("che un tributo non sia dovuto");
    await expect(never).toContainText("che una delibera sia valida o non valida");
    await expect(never).toContainText("che un'attività si possa avviare");
    const professional = page.getByTestId("professional-list");
    for (const item of ["interpretazione", "sopralluogo", "asseverazione", "firma", "registri ufficiali"]) await expect(professional).toContainText(item);
    await expect(page.getByText(/non conserva le credenziali dei portali pubblici/)).toBeVisible();
    await expect(page.getByTestId("areas").getByRole("term")).toHaveCount(8);
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("la panoramica rimanda ai limiti dal testo completo dell'avvertenza", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Tutti i limiti dell'assistenza" })).toBeVisible();
  });
});

test.describe("limiti: senza sessione la pagina e' chiusa", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("redirect all'accesso", async ({ page }) => {
    await page.goto("/limiti");
    await expect(page).toHaveURL(/\/accesso$/);
  });
});
