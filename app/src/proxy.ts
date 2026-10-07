import { NextResponse, type NextRequest } from "next/server";

/**
 * Proxy (ex middleware) di Next.js 16: imposta la Content-Security-Policy con nonce per richiesta.
 * Il controllo di accesso vero NON sta qui (e' solo ottimistico, per le redirect):
 * ogni pagina e ogni azione verifica la sessione al livello dati.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Solo in sviluppo: l'indicatore e l'overlay di Next.js iniettano stili inline senza nonce.
    // Con un nonce presente i browser ignorano 'unsafe-inline', quindi in dev si usa solo quest'ultimo.
    // In produzione resta il nonce (verificato dagli e2e sulla build).
    isDev ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    // I componenti shadcn (es. sidebar) scrivono variabili CSS in attributi style.
    // Gli attributi style non eseguono script: si allentano solo questi, non gli elementi <style>.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    // Anteprima dei documenti: il visualizzatore PDF e' servito da una route dello stesso sito.
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Esclude asset statici e prefetch: non servono la CSP.
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
