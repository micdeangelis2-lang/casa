import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // PGlite avvia un Postgres in-process: la prima inizializzazione richiede qualche secondo.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Con TEST_DATABASE_URL (Postgres reale in CI) ogni test ricrea lo schema `public`:
    // i file non possono girare in parallelo sullo stesso database. Con PGlite ogni test ha il proprio.
    fileParallelism: !process.env.TEST_DATABASE_URL,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.d.ts",
        // UI, route e pagine: coperte dai test e2e, non da quelli unitari.
        "src/app/**",
        "src/components/**",
        "src/hooks/**",
        "src/i18n/**",
        "src/proxy.ts",
        "src/modules/*/client.ts",
        // Schema generato da `pnpm auth:schema`.
        "src/platform/db/schema/auth.ts",
      ],
      reporter: ["text-summary", "json-summary", "lcov"],
      reportsDirectory: "coverage",
      // Il report si scrive anche se un test fallisce (utile come artefatto in CI).
      reportOnFailure: true,
      // Soglie poco sotto i valori misurati (2026-10-06): se la copertura scende, qualcuno se ne accorge.
      // Misurato: globale 89,6 istr. / 81,0 rami / 88,7 funz. / 93,8 righe; domain 98,2 / 92,5 / 99,5 / 99,5;
      // application 89,9 / 78,1 / 98,3 / 99,8; infrastructure 96,0 / 83,6 / 97,3 / 98,5.
      thresholds: {
        statements: 85,
        branches: 75,
        functions: 85,
        lines: 90,
        "src/modules/*/domain/**": { statements: 96, branches: 90, functions: 97, lines: 98 },
        "src/modules/*/application/**": { statements: 87, branches: 75, functions: 95, lines: 98 },
      },
    },
  },
});
