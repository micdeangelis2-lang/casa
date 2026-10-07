import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Riconferma recente (F-04 della revisione di sicurezza): logica PURA, senza framework ne' "server-only" (la usano anche gli
 * e2e per fabbricare la prova con il segreto di prova). Niente schema: la prova sta in un cookie httpOnly firmato con HMAC-SHA256,
 * legato all'utente e alla sessione, con scadenza breve. Una sessione rubata non ha il cookie; un cookie rubato non vale su
 * un'altra sessione ne' per un altro utente.
 */

export const RECONFIRM_COOKIE = "gi_reconfirm";
/** Durata della riconferma: dieci minuti. */
export const RECONFIRM_MAX_AGE_SECONDS = 10 * 60;
const RECONFIRM_PATH = "/riconferma";
/** Dopo un accesso con passkey la nuova sessione conta come riconferma solo se e' appena nata. */
export const PASSKEY_SESSION_MAX_AGE_MS = 60 * 1000;

const VERSION = "v1";
/** Scarto di orologio tollerato per un istante di emissione nel futuro. */
const CLOCK_SKEW_MS = 5 * 1000;

type Binding = { secret: string; userId: string; sessionId: string };

// Chiave derivata: il segreto di Better Auth non firma mai direttamente questo cookie (separazione degli usi).
const macOf = ({ secret, userId, sessionId }: Binding, issuedAtMs: number): Buffer => {
  const key = createHmac("sha256", secret).update("gestione-immobili/riconferma/v1").digest();
  return createHmac("sha256", key).update(`${userId}|${sessionId}|${issuedAtMs}`).digest();
};

/** Valore del cookie: `v1.<istante in ms>.<firma esadecimale>`. */
export function signReconfirmation(binding: Binding, issuedAtMs: number = Date.now()): string {
  return `${VERSION}.${issuedAtMs}.${macOf(binding, issuedAtMs).toString("hex")}`;
}

/** Vero solo se la firma torna per questo utente e questa sessione e la prova non e' scaduta. */
export function verifyReconfirmation(
  token: string | null | undefined,
  binding: Binding,
  options: { nowMs?: number; maxAgeMs?: number } = {},
): boolean {
  if (typeof token !== "string" || token.length > 200) return false;
  const match = /^v1\.(\d{1,15})\.([0-9a-f]{64})$/.exec(token);
  if (!match) return false;
  const issuedAtMs = Number(match[1]);
  const nowMs = options.nowMs ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? RECONFIRM_MAX_AGE_SECONDS * 1000;
  if (issuedAtMs > nowMs + CLOCK_SKEW_MS || nowMs - issuedAtMs > maxAgeMs) return false;
  const given = Buffer.from(match[2]!, "hex");
  const expected = macOf(binding, issuedAtMs);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Percorso di ritorno ammesso (anti open redirect): solo percorsi interni, cioe' che iniziano con una sola «/» e senza
 * barre rovesciate, caratteri di controllo o schemi. Qualunque altra cosa diventa null (l'interfaccia ripiega su «/»).
 * Il percorso di riconferma stesso non e' un ritorno valido (si girerebbe in tondo).
 */
export function safeReturnPath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 500) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return null;
  try {
    const base = "http://riconferma.invalid";
    const url = new URL(raw, base);
    if (url.origin !== base) return null;
    if (url.pathname === RECONFIRM_PATH || url.pathname.startsWith(`${RECONFIRM_PATH}/`)) return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

/** Indirizzo della pagina di riconferma con il ritorno gia' codificato (se il ritorno non e' ammesso, resta la pagina nuda). */
export function reconfirmPath(returnPath: string | null | undefined): string {
  const safe = safeReturnPath(returnPath);
  return safe ? `${RECONFIRM_PATH}?ritorno=${encodeURIComponent(safe)}` : RECONFIRM_PATH;
}

/**
 * Una navigazione del browser (clic su un link di scarico) va reindirizzata alla pagina di riconferma; ogni altra richiesta
 * (fetch, curl, client non browser) riceve una risposta JSON 403. Si guardano le intestazioni `Sec-Fetch-*` e, in loro assenza,
 * `Accept: text/html`.
 */
export function isNavigationRequest(headers: { get(name: string): string | null }): boolean {
  const mode = headers.get("sec-fetch-mode");
  const dest = headers.get("sec-fetch-dest");
  if (mode || dest) return mode === "navigate" || dest === "document";
  return (headers.get("accept") ?? "").toLowerCase().includes("text/html");
}
