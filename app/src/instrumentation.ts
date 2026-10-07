import type { Instrumentation } from "next";

/**
 * Una riga JSON su stderr per ogni errore del server, con il `digest` che la pagina d'errore mostra all'utente.
 * Non contiene mai messaggio, stack, corpo, intestazioni, query string o parametri SQL (vedi `request-error.ts`).
 * Nota: Next stampa per conto suo anche l'errore completo (messaggio e stack) nei log di produzione: questo hook
 * non puo' impedirlo, aggiunge soltanto la riga strutturata e sicura.
 */
export function register(): void {}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  // Solo il runtime Node: l'import dinamico evita di portare il codice nel runtime edge.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { writeRequestError } = await import("@/platform/logging/write-request-error");
  writeRequestError(error, request, context);
};
