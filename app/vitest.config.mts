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
      // Soglie poco sotto i valori misurati (2026-10-07): se la copertura scende, qualcuno se ne accorge.
      // Misurato: globale 90,2 istr. / 82,6 rami / 88,2 funz. / 92,9 righe; domain 99,5 / 96,3 / 99,6 / 99,7;
      // application 91,9 / 81,0 / 97,4 / 99,7; infrastructure 97,1 / 86,3 / 98,3 / 99,1.
      thresholds: {
        statements: 88,
        branches: 80,
        functions: 86,
        lines: 91,
        "src/modules/*/domain/**": { statements: 96, branches: 92, functions: 97, lines: 98 },
        "src/modules/*/application/**": { statements: 89, branches: 78, functions: 95, lines: 98 },
        "src/modules/*/infrastructure/**": { statements: 95, branches: 84, functions: 96, lines: 97 },
      },
    },
  },
});
