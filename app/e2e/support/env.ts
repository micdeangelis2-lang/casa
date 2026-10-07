/** Valori condivisi tra playwright.config.ts e i test. Solo per i test: nessun segreto reale. */
export const E2E_PORT = 3100;
export const E2E_DB_PORT = 54329;
/** Porta HTTP di sola prontezza: Playwright non deve sondare la porta del database (vedi db-server.ts). */
export const E2E_DB_READY_PORT = 54330;
export const E2E_ORIGIN = `http://localhost:${E2E_PORT}`;
export const E2E_DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${E2E_DB_PORT}/postgres`;

export const E2E_BOOTSTRAP_TOKEN = "e2e-bootstrap-token-0123456789abcdef0123456789";
export const E2E_CRON_SECRET = "e2e-cron-secret-0123456789abcdef";
export const E2E_AUTH_SECRET = "e2e-auth-secret-0123456789abcdef0123456789abcdef";

export const OWNER = {
  name: "Proprietario di prova",
  email: "proprietario@example.test",
  password: "Cavallo-Batteria-Graffetta-9",
} as const;

/**
 * Better Auth conta le richieste per IP (header x-real-ip, che su Vercel e' impostato dalla piattaforma).
 * Ogni flusso di test usa un IP diverso, cosi' i limiti di frequenza non si sommano tra test.
 */
export function clientIp(n: number): string {
  return `198.51.100.${n}`;
}
