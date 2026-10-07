import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, clientIp } from "./support/env";
import { STORAGE_STATE } from "./support/secrets";

test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(335) } });
test.describe.configure({ mode: "serial" });

const OFFICE = "Ufficio E2E Edilizia";
const MATTER = "Pratica E2E per ufficio";
const RULE_TITLE = "Regola E2E per controllo fonti";
let officeId = "";
let ruleId = "";

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
  await sql("delete from matter where title = $1", [MATTER]);
  await sql("delete from party where display_name = $1", [OFFICE]);
}

test.beforeAll(async () => {
  await cleanup();
  officeId = (await sql<{ id: string }>("insert into party (display_name, roles, address) values ($1, '{public_office}', 'Via di prova 1') returning id", [OFFICE]))[0]!.id;
  const matterId = (await sql<{ id: string }>("insert into matter (title, status, opened_on) values ($1, 'open', '2026-01-10') returning id", [MATTER]))[0]!.id;
  await sql("insert into matter_assignment (matter_id, party_id, role) values ($1, $2, 'edilizia')", [matterId, officeId]);
  await sql("insert into matter_document_request (matter_id, title, requested_from_party_id, requested_on, due_on) values ($1, 'Integrazione E2E', $2, '2026-01-12', '2026-02-01')", [matterId, officeId]);
});

test.afterAll(async () => {
  await sql("delete from matter where title = $1", [MATTER]);
  await sql("delete from party where display_name = $1", [OFFICE]);
  if (ruleId) {
    // Le versioni delle regole sono immutabili e non cancellabili (trigger): la regola di prova si disattiva soltanto.
    await sql("update rule set active = false where id = $1", [ruleId]);
  }
});

test.describe("uffici", () => {
  test("l'elenco mostra cosa e' aperto presso l'ufficio e il dettaglio le pratiche e le richieste", async ({ page }) => {
    await page.goto("/uffici");
    const row = page.getByTestId("office-list").getByRole("link", { name: new RegExp(OFFICE) });
    await expect(row).toContainText("Pratiche aperte: 1");
    await expect(row).toContainText("Richieste in attesa: 1");
    await expect(row).toContainText("Date superate: 1");
    expect(await a11yViolations(page)).toEqual([]);

    await row.click();
    await expect(page.getByRole("heading", { level: 1, name: OFFICE })).toBeVisible();
    await expect(page.getByTestId("office-matters")).toContainText(MATTER);
    await expect(page.getByTestId("office-matters")).toContainText("Integrazione E2E");
    await expect(page.getByTestId("office-matters")).toContainText("Ruolo: edilizia");
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("la pagina delle regole mostra stato di verifica e fonte senza dire se si applicano", async ({ page }) => {
    const created = await sql<{ id: string }>("insert into rule (key, active) values ('e2e_uffici_1', true) on conflict (key) do update set active = true returning id");
    ruleId = created[0]!.id;
    await sql(
      `insert into rule_version (rule_id, version_no, title, level, outcomes, source_text, verification_status)
       values ($1, 1, $2, 'national', '[{"type":"notice","key":"avviso","title":"Avviso","message":"Testo"}]'::jsonb, 'Fonte E2E inserita dall''utente', 'to_verify') on conflict do nothing`,
      [ruleId, RULE_TITLE],
    );
    await page.goto("/uffici/regole");
    const item = page.getByTestId("review-list").getByRole("listitem").filter({ hasText: RULE_TITLE });
    await expect(item).toContainText("Non verificata");
    await expect(item).toContainText("Fonte: Fonte E2E inserita dall'utente");
    await expect(page.getByTestId("review-summary")).toContainText("non verificate");
    expect(await a11yViolations(page)).toEqual([]);
    await page.setViewportSize({ width: 390, height: 800 });
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("un ufficio inesistente da pagina non trovata", async ({ page }) => {
    const response = await page.goto("/uffici/00000000-0000-4000-8000-000000000000");
    expect(response?.status()).toBe(404);
  });
});
