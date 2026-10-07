import { expect, test } from "@playwright/test";
import { Client } from "./support/pg-client";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, clientIp } from "./support/env";
import { STORAGE_STATE } from "./support/secrets";

// Polizze per immobile e scheda sinistro per il perito. Crea i suoi dati (nomi «Assicuratore E2E») e li rimuove alla fine.
test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(320) } });
test.describe.configure({ mode: "serial" });

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function db<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

let claimId = "";

test.beforeAll(async () => {
  await db(async (client) => {
    await client.query(`insert into asset (kind, name, territory_id, address) select 'dwelling', 'Casa Assicuratore E2E', id, 'Via Perito 1' from territory where name = 'Comune Alfa'`);
    await client.query(`insert into asset (kind, name, territory_id) select 'cellar', 'Cantina Assicuratore E2E', id from territory where name = 'Comune Alfa'`);
    const asset = (await client.query<{ id: string }>("select id from asset where name = 'Casa Assicuratore E2E'")).rows[0]!.id;
    const policy = (
      await client.query<{ id: string }>("insert into ins_policy (title, policy_number, starts_on, ends_on, premium_cents) values ('Polizza Assicuratore E2E', 'POL-ASS-1', $1, $2, 48000) returning id", [day(-30), day(200)])
    ).rows[0]!.id;
    await client.query("insert into ins_policy_asset (policy_id, asset_id) values ($1, $2)", [policy, asset]);
    await client.query("insert into ins_coverage (policy_id, title, sum_insured_cents, deductible_cents) values ($1, 'Incendio ass', 20000000, 25000)", [policy]);
    claimId = (
      await client.query<{ id: string }>("insert into ins_claim (policy_id, asset_id, title, occurred_on, claimed_cents, description) values ($1, $2, 'Sinistro Assicuratore E2E', $3, 150000, 'Acqua dal soffitto') returning id", [policy, asset, day(-5)])
    ).rows[0]!.id;
    await client.query("insert into ins_claim_entry (claim_id, entry_on, direction, summary) values ($1, $2, 'sent', 'Denuncia inviata al perito')", [claimId, day(-4)]);
  });
});

test.afterAll(async () => {
  await db(async (client) => {
    await client.query("delete from ins_claim where title = 'Sinistro Assicuratore E2E'");
    await client.query("delete from ins_policy where title = 'Polizza Assicuratore E2E'");
    await client.query("delete from asset where name in ('Casa Assicuratore E2E', 'Cantina Assicuratore E2E')");
  });
});

test.describe("assicuratore", () => {
  test("polizze per immobile: garanzie copiate e beni senza polizza registrata, senza verdetti", async ({ page }) => {
    await page.goto("/assicurazioni");
    await page.getByRole("link", { name: "Polizze per immobile" }).click();
    await expect(page).toHaveURL(/\/assicurazioni\/per-immobile$/);
    await expect(page.getByRole("heading", { level: 1, name: "Polizze per immobile" })).toBeVisible();
    const list = page.getByTestId("by-asset-list");
    const casa = list.locator("li[data-status]").filter({ hasText: "Casa Assicuratore E2E" });
    await expect(casa).toContainText("Almeno una polizza in corso");
    await expect(casa).toContainText("Polizza Assicuratore E2E");
    await expect(casa).toContainText("Incendio ass — somma assicurata 200.000,00 € — franchigia 250,00 €");
    const cantina = list.locator("li[data-status]").filter({ hasText: "Cantina Assicuratore E2E" });
    await expect(cantina).toContainText("Nessuna polizza registrata");
    expect(await a11yViolations(page)).toEqual([]);

    await page.goto("/assicurazioni/per-immobile?senza=1");
    await expect(page.getByTestId("by-asset-list")).toContainText("Cantina Assicuratore E2E");
    await expect(page.getByTestId("by-asset-list")).not.toContainText("Casa Assicuratore E2E");
  });

  test("scheda sinistro per il perito: dati registrati, cronologia ed elenco di controllo", async ({ page }) => {
    await page.goto(`/assicurazioni/sinistri/${claimId}`);
    await page.getByRole("link", { name: "Scheda per il perito" }).click();
    await expect(page).toHaveURL(new RegExp(`/assicurazioni/sinistri/${claimId}/scheda$`));
    await expect(page.getByRole("heading", { level: 1, name: "Scheda del sinistro per il perito" })).toBeVisible();
    await expect(page.getByTestId("sheet-claimed")).toHaveText("1.500,00 €");
    await expect(page.getByTestId("sheet-received")).toHaveText("Non indicato");
    await expect(page.getByTestId("sheet-coverages")).toContainText("Incendio ass");
    await expect(page.getByTestId("sheet-asset")).toContainText("Via Perito 1");
    await expect(page.getByTestId("sheet-entries")).toContainText("Denuncia inviata al perito");
    const checks = page.getByTestId("sheet-checks");
    await expect(checks.locator("li", { hasText: "Descrizione dell'evento" })).toHaveAttribute("data-present", "yes");
    await expect(checks.locator("li", { hasText: "Data della denuncia" })).toHaveAttribute("data-present", "no");
    await expect(page.getByRole("link", { name: "Prepara un pacchetto di documenti da inviare" })).toHaveAttribute("href", /\/condivisione\/nuovo\?immobile=[0-9a-f-]{36}&destinatario=insurer/);
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("un identificativo non valido da' 404", async ({ page }) => {
    const res = await page.goto("/assicurazioni/sinistri/non-un-id/scheda");
    expect(res?.status()).toBe(404);
  });
});
