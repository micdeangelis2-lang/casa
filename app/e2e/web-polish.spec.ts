import { expect, test, type Page } from "@playwright/test";
import { Client } from "./support/pg-client";
import { a11yViolations } from "./support/a11y";
import { E2E_DATABASE_URL, E2E_ORIGIN, clientIp } from "./support/env";
import { PAGES } from "./support/pages";
import { STORAGE_STATE } from "./support/secrets";

// Indirizzi x-real-ip di questo file: 260 (risposte HTTP), 261 (tema), 262 (accessibilita' in tema scuro), 263 (stampa).
test.use({ storageState: STORAGE_STATE, extraHTTPHeaders: { "x-real-ip": clientIp(260) } });

async function db<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

test.describe("identita', robots e manifest", () => {
  test("robots.txt vieta tutto", async ({ request }) => {
    const response = await request.get("/robots.txt");
    expect(response.status()).toBe(200);
    const text = await response.text();
    expect(text).toContain("User-Agent: *");
    expect(text).toMatch(/Disallow: \/\s*$/m);
    expect(text).not.toMatch(/Allow: \//);
  });

  test("il manifest e' JSON valido e le icone sono raggiungibili con il tipo giusto, anche senza sessione", async ({ playwright }) => {
    const anonymous = await playwright.request.newContext({ baseURL: E2E_ORIGIN, extraHTTPHeaders: { "x-real-ip": clientIp(260) } });
    try {
      const response = await anonymous.get("/manifest.webmanifest");
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toContain("json");
      const manifest = (await response.json()) as {
        name: string;
        short_name: string;
        lang: string;
        display: string;
        start_url: string;
        icons: { src: string; sizes: string; type: string }[];
      };
      expect(manifest).toMatchObject({ name: "Gestione Immobili", lang: "it", display: "standalone", start_url: "/" });
      expect(manifest.short_name.length).toBeGreaterThan(0);
      expect(manifest.icons.map((icon) => icon.sizes).sort()).toEqual(["192x192", "512x512"]);
      for (const icon of manifest.icons) {
        const png = await anonymous.get(icon.src);
        expect(png.status(), icon.src).toBe(200);
        expect(png.headers()["content-type"]).toBe(icon.type);
        expect((await png.body()).subarray(1, 4).toString("latin1")).toBe("PNG");
      }
    } finally {
      await anonymous.dispose();
    }
  });

  test("icone dell'app (SVG, apple-touch, favicon) e collegamenti nella pagina di accesso", async ({ playwright }) => {
    const anonymous = await playwright.request.newContext({ baseURL: E2E_ORIGIN, extraHTTPHeaders: { "x-real-ip": clientIp(260) } });
    try {
      const svg = await anonymous.get("/icon.svg");
      expect(svg.status()).toBe(200);
      expect(svg.headers()["content-type"]).toContain("image/svg+xml");
      const apple = await anonymous.get("/apple-icon.png");
      expect(apple.status()).toBe(200);
      expect(apple.headers()["content-type"]).toBe("image/png");
      const favicon = await anonymous.get("/favicon.ico");
      expect(favicon.status()).toBe(200);
      expect((await favicon.body()).readUInt16LE(2)).toBe(1); // contenitore ICO

      const html = await (await anonymous.get("/accesso")).text();
      expect(html).toMatch(/rel="manifest"/);
      expect(html).toMatch(/rel="apple-touch-icon"/);
      expect(html).toMatch(/name="theme-color"[^>]*media="\(prefers-color-scheme: dark\)"/);
    } finally {
      await anonymous.dispose();
    }
  });

  test("intestazioni di sicurezza complete anche nelle pagine di accesso e negli asset statici", async ({ playwright }) => {
    const anonymous = await playwright.request.newContext({ baseURL: E2E_ORIGIN, extraHTTPHeaders: { "x-real-ip": clientIp(260) } });
    try {
      for (const path of ["/accesso", "/", "/robots.txt", "/icon-192.png"]) {
        const h = (await anonymous.get(path, { maxRedirects: 0 })).headers();
        expect(h["x-content-type-options"], path).toBe("nosniff");
        expect(h["x-frame-options"], path).toBe("DENY");
        expect(h["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
        expect(h["cross-origin-opener-policy"], path).toBe("same-origin");
        expect(h["cross-origin-resource-policy"], path).toBe("same-origin");
        expect(h["strict-transport-security"], path).toContain("max-age=");
        const permissions = h["permissions-policy"] ?? "";
        expect(permissions, path).toContain("publickey-credentials-get=(self)");
        expect(permissions, path).toContain("publickey-credentials-create=(self)");
        expect(permissions, path).toContain("camera=()");
      }
      const csp = (await anonymous.get("/accesso")).headers()["content-security-policy"] ?? "";
      expect(csp).toContain("default-src 'self'");
      expect(csp).not.toContain("'unsafe-eval'");
      expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    } finally {
      await anonymous.dispose();
    }
  });
});

test.describe("tema", () => {
  test.use({ extraHTTPHeaders: { "x-real-ip": clientIp(261) } });

  test("il selettore cambia tema, scrive il cookie e la scelta resta dopo il ricaricamento", async ({ page, context }) => {
    const problems: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") problems.push(`console: ${msg.text()}`);
    });
    page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));
    await context.clearCookies({ name: "theme" });

    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    const html = page.locator("html");
    const toggle = page.getByTestId("theme-toggle");
    await expect(toggle.getByRole("button", { name: "Sistema" })).toHaveAttribute("aria-pressed", "true");
    await expect(html).not.toHaveClass(/\bdark\b/);

    await toggle.getByRole("button", { name: "Scuro" }).click();
    await expect(html).toHaveClass(/\bdark\b/);
    await expect(toggle.getByRole("button", { name: "Scuro" })).toHaveAttribute("aria-pressed", "true");
    const cookie = (await context.cookies()).find((c) => c.name === "theme");
    expect(cookie?.value).toBe("dark");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("Lax");

    await page.reload();
    await expect(html).toHaveClass(/\bdark\b/);

    await toggle.getByRole("button", { name: "Chiaro" }).click();
    await expect(html).not.toHaveClass(/\bdark\b/);
    await page.reload();
    await expect(html).not.toHaveClass(/\bdark\b/);

    // «Sistema» segue la preferenza del sistema, anche senza lampeggiare al caricamento (script con nonce).
    await toggle.getByRole("button", { name: "Sistema" }).click();
    await expect(toggle.getByRole("button", { name: "Sistema" })).toHaveAttribute("aria-pressed", "true");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(html).toHaveClass(/\bdark\b/);
    await page.reload();
    await expect(html).toHaveClass(/\bdark\b/);
    await page.emulateMedia({ colorScheme: "light" });
    await expect(html).not.toHaveClass(/\bdark\b/);

    expect(problems, problems.join("\n")).toEqual([]);
    await context.clearCookies({ name: "theme" });
  });

  test("un valore del cookie non valido ricade su «Sistema»", async ({ page, context }) => {
    await context.addCookies([{ name: "theme", value: "viola", url: E2E_ORIGIN }]);
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await expect(page.getByTestId("theme-toggle").getByRole("button", { name: "Sistema" })).toHaveAttribute("aria-pressed", "true");
    await context.clearCookies({ name: "theme" });
  });
});

test.describe("accessibilita' in tema scuro (1280 px)", () => {
  test.use({ extraHTTPHeaders: { "x-real-ip": clientIp(262) }, viewport: { width: 1280, height: 800 } });

  test.beforeEach(async ({ context }) => {
    await context.addCookies([{ name: "theme", value: "dark", url: E2E_ORIGIN }]);
  });
  test.afterEach(async ({ context }) => {
    await context.clearCookies({ name: "theme" });
  });

  for (const path of PAGES) {
    test(`senza violazioni WCAG A/AA: ${path}`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.locator("html")).toHaveClass(/\bdark\b/);
      await expect(page.locator("#main")).toBeVisible();
      expect(await a11yViolations(page)).toEqual([]);
    });
  }
});

test.describe("stampa", () => {
  test.use({ extraHTTPHeaders: { "x-real-ip": clientIp(263) } });
  let assetId = "";

  test.beforeAll(async () => {
    assetId = await db(async (client) => {
      const row = await client.query(
        "insert into asset (kind, name, territory_id) select 'dwelling', 'Appartamento Stampa E2E', id from territory where name = 'Comune Alfa' returning id",
      );
      return row.rows[0].id as string;
    });
  });
  test.afterAll(async () => {
    await db(async (client) => {
      await client.query("delete from dossier_item where asset_id in (select id from asset where name = 'Appartamento Stampa E2E')");
      await client.query("delete from asset where name = 'Appartamento Stampa E2E'");
    });
  });

  async function expectCleanPrint(page: Page, path: string) {
    await page.goto(path);
    await expect(page.locator("#main")).toBeVisible();
    await page.emulateMedia({ media: "print" });
    // Menu laterale, intestazione con ricerca/tema/uscita e pulsanti non devono comparire sulla carta.
    await expect(page.locator('[data-slot="sidebar"]'), path).toBeHidden();
    await expect(page.locator("header").first(), path).toBeHidden();
    await expect(page.getByTestId("theme-toggle"), path).toBeHidden();
    await expect(page.getByRole("button", { name: "Esci" }), path).toBeHidden();
    await expect(page.locator("#main button:visible"), path).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path}: contenuto piu' largo della pagina`).toBeLessThanOrEqual(1);
  }

  test("dossier", async ({ page }) => {
    await expectCleanPrint(page, `/immobili/${assetId}/dossier`);
  });
  for (const path of ["/tributi/riepilogo", "/economia", "/documenti"]) {
    test(`stampa pulita: ${path}`, async ({ page }) => {
      await expectCleanPrint(page, path);
    });
  }
});
