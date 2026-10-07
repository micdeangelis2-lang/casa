import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_DATABASE_URL, clientIp } from "./support/env";
import { STORAGE_STATE } from "./support/secrets";

// La scadenza si inserisce direttamente nel database (data lontana, cosi' non si mescola con quelle di altri file di test) e si rimuove alla fine.
test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(220) } });
test.describe.configure({ mode: "serial" });

const TITLE = "Scadenza Calendario E2E";

async function db<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

test.beforeAll(async () => {
  await db(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `insert into deadline (title, category, level, calc, lead_days, priority) values ($1, 'fiscal', 'national', '{"type":"manual"}', '{7,0}', 'high') returning id`,
      [TITLE],
    );
    await client.query("insert into deadline_occurrence (deadline_id, due_on) values ($1, '2041-03-31')", [inserted.rows[0]!.id]);
  });
});

test.afterAll(async () => {
  await db((client) => client.query("delete from deadline where title = $1", [TITLE]));
});

test.describe("calendario delle scadenze", () => {
  test("dall'elenco delle scadenze si scarica un file .ics con le scadenze aperte", async ({ page, request }) => {
    await page.goto("/scadenze");
    await expect(page.getByRole("link", { name: "Calendario .ics" })).toHaveAttribute("href", "/api/calendario");

    const response = await request.get("/api/calendario");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/calendar");
    expect(response.headers()["content-disposition"]).toContain("scadenze-immobili.ics");
    expect(response.headers()["cache-control"]).toContain("no-store");

    const body = await response.text();
    expect(body.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(body.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(body).toContain(`SUMMARY:${TITLE}\r\n`);
    expect(body).toContain("DTSTART;VALUE=DATE:20410331\r\nDTEND;VALUE=DATE:20410401\r\n");
    expect(body).toContain("Categoria: Fiscale");
    expect(body).toContain("Priorità: Alta");
    expect(body).toMatch(/URL:http:\/\/[^\r\n]+\/scadenze\/[0-9a-f-]{36}\r\n/);
    // Preavvisi 7 e 0 giorni: due promemoria.
    expect(body.split("BEGIN:VALARM").length - 1).toBeGreaterThanOrEqual(2);
  });
});

test.describe("calendario senza sessione", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("il file e' chiuso e non rivela nulla", async ({ request }) => {
    const response = await request.get("/api/calendario");
    expect(response.status()).toBe(401);
    expect(await response.text()).not.toContain(TITLE);
  });
});
