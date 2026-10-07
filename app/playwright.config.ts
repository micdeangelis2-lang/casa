import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateBackupKeyPair } from "./src/shared/archive/crypto";
import {
  E2E_AUTH_SECRET,
  E2E_BOOTSTRAP_TOKEN,
  E2E_CRON_SECRET,
  E2E_DATABASE_URL,
  E2E_DB_READY_PORT,
  E2E_ORIGIN,
  E2E_PORT,
} from "./e2e/support/env";

/**
 * Gli e2e girano contro la build di PRODUZIONE (`next build` + `next start`):
 * e' l'unico modo di verificare CSP con nonce e cookie come saranno online.
 * Il database e' un Postgres in memoria (PGlite) esposto su socket: nessun Docker.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: E2E_ORIGIN,
    trace: "retain-on-failure",
    locale: "it-IT",
    timezoneId: "Europe/Rome",
  },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/, use: { ...devices["Desktop Chrome"] } },
    {
      name: "chromium",
      testMatch: /.*\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "pnpm exec tsx e2e/support/db-server.ts",
      url: `http://127.0.0.1:${E2E_DB_READY_PORT}`,
      stdout: "pipe",
      stderr: "pipe",
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `pnpm build && pnpm exec next start -p ${E2E_PORT}`,
      url: E2E_ORIGIN,
      stdout: "pipe",
      stderr: "pipe",
      reuseExistingServer: false,
      timeout: 240_000,
      env: {
        DATABASE_URL: E2E_DATABASE_URL,
        // Un solo collegamento: il multiplexer di PGlite non garantisce transazioni interattive concorrenti.
        DATABASE_POOL_MAX: "1",
        BETTER_AUTH_SECRET: E2E_AUTH_SECRET,
        BETTER_AUTH_URL: E2E_ORIGIN,
        OWNER_BOOTSTRAP_TOKEN: E2E_BOOTSTRAP_TOKEN,
        // I file dei documenti dei test stanno fuori dal progetto.
        STORAGE_DIR: join(tmpdir(), "gestione-immobili-e2e-storage"),
        // Backup: chiave pubblica usa e getta (la privata non serve ai test e non viene salvata) e cartella fuori dal progetto.
        BACKUP_PUBLIC_KEY: generateBackupKeyPair().publicKey,
        BACKUP_DIR: join(tmpdir(), "gestione-immobili-e2e-backups"),
        CRON_SECRET: E2E_CRON_SECRET,
      },
    },
  ],
});
