import type { BrowserContext } from "@playwright/test";
import { Client } from "./pg-client";
import { RECONFIRM_COOKIE, RECONFIRM_MAX_AGE_SECONDS, signReconfirmation } from "../../src/platform/auth/reconfirmation";
import { E2E_AUTH_SECRET, E2E_DATABASE_URL, E2E_ORIGIN } from "./env";

/**
 * Riconferma recente (F-04) per i test che scaricano dati riservati o usano le azioni sensibili della pagina Sicurezza.
 * La sessione condivisa degli e2e e' vecchia per costruzione, quindi il server (giustamente) pretende la riconferma. Qui il test
 * fabbrica la PROVA al posto dell'interfaccia: stesso cookie firmato (HMAC) col segreto di prova, legato all'utente e alla
 * sessione REALI del contesto (letti dal database). Il controllo del server non cambia: senza questa chiamata gli scarichi
 * rispondono 403 (e2e/reconfirm.spec.ts prova anche il percorso vero dall'interfaccia, con passkey e con password + codice).
 */
export async function reconfirm(context: BrowserContext): Promise<void> {
  const cookies = await context.cookies(E2E_ORIGIN);
  const session = cookies.find((c) => c.name === "better-auth.session_token");
  if (!session) throw new Error("reconfirm: il contesto non ha una sessione");
  const token = decodeURIComponent(session.value).split(".")[0]!;
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string; user_id: string }>('select id, user_id from "session" where token = $1', [token]);
    const row = rows[0];
    if (!row) throw new Error("reconfirm: sessione non trovata nel database");
    const value = signReconfirmation({ secret: E2E_AUTH_SECRET, userId: row.user_id, sessionId: row.id });
    await context.addCookies([
      {
        name: RECONFIRM_COOKIE,
        value,
        url: E2E_ORIGIN,
        httpOnly: true,
        sameSite: "Strict",
        expires: Math.floor(Date.now() / 1000) + RECONFIRM_MAX_AGE_SECONDS,
      },
    ]);
  } finally {
    await client.end();
  }
}
