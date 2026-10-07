import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, clientIp } from "./support/env";
import { STORAGE_STATE } from "./support/secrets";

test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(345) } });
test.describe.configure({ mode: "serial" });

const PARTY = "Professionista competenze E2E";
let partyId = "";

async function sql<T = unknown>(text: string, values: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(text, values)).rows as T[];
  } finally {
    await client.end();
  }
}

test.beforeAll(async () => {
  await sql("delete from party where display_name = $1", [PARTY]);
  partyId = (await sql<{ id: string }>("insert into party (display_name, roles) values ($1, '{technician}') returning id", [PARTY]))[0]!.id;
});

test.afterAll(async () => {
  await sql("delete from party where display_name = $1", [PARTY]);
});

test.describe("competenze di un contatto", () => {
  test("si registra una competenza dalla modifica del contatto e si toglie", async ({ page }) => {
    await page.goto(`/rubrica/${partyId}/modifica`);
    await expect(page.getByTestId("competences-empty")).toBeVisible();
    const form = page.getByRole("form", { name: "Registra una competenza" });
    await form.getByLabel("Tipo").selectOption("registration");
    await form.getByLabel("Descrizione").fill("Collegio dei geometri E2E");
    await form.getByLabel("Numero o estremi").fill("ISCR-E2E-5");
    await form.getByLabel("Valida fino al").fill("2020-12-31");
    await form.getByRole("button", { name: "Registra la competenza" }).click();
    const list = page.getByTestId("competence-list");
    await expect(list).toContainText("Collegio dei geometri E2E");
    await expect(list).toContainText("estremi: ISCR-E2E-5");
    await expect(list).toContainText("data di fine superata");
    expect(await a11yViolations(page)).toEqual([]);

    await list.getByRole("button", { name: /Togli/ }).click();
    await expect(page.getByTestId("competences-empty")).toBeVisible();
  });

  test("date incoerenti vengono rifiutate accanto al campo", async ({ page }) => {
    await page.goto(`/rubrica/${partyId}/modifica`);
    const form = page.getByRole("form", { name: "Registra una competenza" });
    await form.getByLabel("Tipo").selectOption("insurance");
    await form.getByLabel("Descrizione").fill("Polizza E2E");
    await form.getByLabel("Valida dal").fill("2026-05-01");
    await form.getByLabel("Valida fino al").fill("2026-04-01");
    await form.getByRole("button", { name: "Registra la competenza" }).click();
    await expect(form).toContainText("La data di fine è precedente a quella di inizio");
  });
});
