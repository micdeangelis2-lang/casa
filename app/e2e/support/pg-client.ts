import pg from "pg";

/**
 * Client `pg` per i test e2e che ritenta la connessione. Il database degli e2e e' un PGlite a thread singolo esposto su socket:
 * sotto carico, per qualche secondo, puo' non rispondere e la connessione fallisce con `ETIMEDOUT` o `ECONNRESET` (e prima si
 * perdeva un test intero, spesso in `afterAll`, lasciando dati sporchi agli altri file). Qui il timeout e' breve e il tentativo
 * si ripete su un client nuovo. Espone solo cio' che i test usano: `connect`, `query`, `end`.
 */
const ATTEMPTS = 4;
const CONNECT_TIMEOUT_MS = 6000;
const PAUSE_MS = 1500;

const TRANSIENT = /ETIMEDOUT|ECONNRESET|ECONNREFUSED|EPIPE|timeout|Connection terminated|terminated unexpectedly/i;

export class Client {
  private inner: pg.Client;

  constructor(private readonly config: pg.ClientConfig) {
    this.inner = new pg.Client({ connectionTimeoutMillis: CONNECT_TIMEOUT_MS, ...config });
  }

  async connect(): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.inner.connect();
        return;
      } catch (error) {
        const message = error instanceof Error ? `${error.message} ${(error as { code?: string }).code ?? ""}` : String(error);
        if (attempt >= ATTEMPTS || !TRANSIENT.test(message)) throw error;
        await this.inner.end().catch(() => undefined);
        await new Promise((done) => setTimeout(done, PAUSE_MS));
        this.inner = new pg.Client({ connectionTimeoutMillis: CONNECT_TIMEOUT_MS, ...this.config });
      }
    }
  }

  query: pg.Client["query"] = ((...args: unknown[]) => (this.inner.query as (...a: unknown[]) => unknown)(...args)) as pg.Client["query"];

  end(): Promise<void> {
    return this.inner.end();
  }
}
