import { expect, test, type Page } from "@playwright/test";
import { Client } from "./support/pg-client";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, clientIp } from "./support/env";
import { STORAGE_STATE } from "./support/secrets";

// Documenti del sinistro con ruolo e scheda per il perito. Crea i suoi dati («Sinistro Documenti E2E») e li rimuove alla fine.
test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(360) } });
test.describe.configure({ mode: "serial" });

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
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

let claimId = "";

test.beforeAll(async () => {
  await db(async (client) => {
    const policy = (await client.query<{ id: string }>("insert into ins_policy (title, starts_on, ends_on) values ('Polizza Sinistro Documenti E2E', $1, $2) returning id", [day(-30), day(200)])).rows[0]!.id;
    claimId = (await client.query<{ id: string }>("insert into ins_claim (policy_id, title, occurred_on) values ($1, 'Sinistro Documenti E2E', $2) returning id", [policy, day(-5)])).rows[0]!.id;
    const category = (await client.query<{ id: string }>("select id from document_category order by position limit 1")).rows[0]!.id;
    for (const [title, key] of [["Foto Sinistro E2E", "sinistro-doc-e2e-1"], ["Perizia Sinistro E2E", "sinistro-doc-e2e-2"]] as const) {
      const file = (await client.query<{ id: string }>("insert into file_object (storage_key, sha256, size_bytes, mime_type) values ($1, md5($1), 1000, 'application/pdf') returning id", [key])).rows[0]!.id;
      const doc = (await client.query<{ id: string }>("insert into document (title, category_id) values ($1, $2) returning id", [title, category])).rows[0]!.id;
      await client.query("insert into document_version (document_id, version_no, file_object_id, original_filename) values ($1, 1, $2, 'file.pdf')", [doc, file]);
    }
  });
});

test.afterAll(async () => {
  await db(async (client) => {
    await client.query("delete from ins_claim where title = 'Sinistro Documenti E2E'");
    await client.query("delete from ins_policy where title = 'Polizza Sinistro Documenti E2E'");
    await client.query("delete from document where title in ('Foto Sinistro E2E', 'Perizia Sinistro E2E')");
    await client.query("delete from file_object where storage_key like 'sinistro-doc-e2e-%'");
  });
});

test.describe("documenti del sinistro", () => {
  test("si collegano con il ruolo scelto, non due volte, e si tolgono", async ({ page }) => {
    await page.goto(`/assicurazioni/sinistri/${claimId}`);
    await expect(page.getByText("Nessun documento collegato.")).toBeVisible();
    const add = form(page, "Collega un documento");
    await add.getByRole("button", { name: "Collega un documento" }).click();
    await expect(add).toContainText("Scegli un documento");

    await add.getByLabel("Documento").selectOption({ label: "Foto Sinistro E2E" });
    await add.getByLabel("Ruolo").selectOption("photo");
    await add.getByRole("button", { name: "Collega un documento" }).click();
    const list = page.getByTestId("claim-documents");
    await expect(list).toContainText("Foto Sinistro E2E");
    await expect(list).toContainText("Fotografia");

    await add.getByLabel("Documento").selectOption({ label: "Foto Sinistro E2E" });
    await add.getByRole("button", { name: "Collega un documento" }).click();
    await expect(add).toContainText("Questo documento è già collegato al sinistro");

    await add.getByLabel("Documento").selectOption({ label: "Perizia Sinistro E2E" });
    await add.getByLabel("Ruolo").selectOption("appraisal");
    await add.getByRole("button", { name: "Collega un documento" }).click();
    await expect(list.getByRole("listitem").filter({ hasText: "Perizia Sinistro E2E" })).toContainText("Perizia");
    expect(await a11yViolations(page)).toEqual([]);
  });

  test("la scheda per il perito elenca i documenti del sinistro con il ruolo e conta le fotografie scelte", async ({ page }) => {
    await page.goto(`/assicurazioni/sinistri/${claimId}/scheda`);
    const docs = page.getByTestId("sheet-claim-documents");
    await expect(docs.locator('li[data-role="photo"]')).toContainText("Foto Sinistro E2E");
    await expect(docs.locator('li[data-role="appraisal"]')).toContainText("Perizia Sinistro E2E");
    await expect(page.getByTestId("sheet-checks").locator("li", { hasText: "Fotografie collegate al sinistro" })).toHaveAttribute("data-present", "yes");
    expect(await a11yViolations(page)).toEqual([]);

    await page.goto(`/assicurazioni/sinistri/${claimId}`);
    await page.getByTestId("claim-documents").getByRole("listitem").filter({ hasText: "Foto Sinistro E2E" }).getByRole("button", { name: /^Togli/ }).click();
    await expect(page.getByTestId("claim-documents")).not.toContainText("Foto Sinistro E2E");
    await page.goto(`/assicurazioni/sinistri/${claimId}/scheda`);
    await expect(page.getByTestId("sheet-checks").locator("li", { hasText: "Fotografie collegate al sinistro" })).toHaveAttribute("data-present", "no");
  });
});
