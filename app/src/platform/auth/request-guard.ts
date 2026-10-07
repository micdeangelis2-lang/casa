import { headers } from "next/headers";
import { NextResponse } from "next/server";

/**
 * Difesa contro le navigazioni cross-site verso le route `/api/*` che producono dati o file (esportazione, backup, pacchetti...).
 * Il cookie di sessione e' `SameSite=Lax`: un sito terzo puo' comunque far partire un GET di primo livello. Il browser dichiara
 * l'origine con `Sec-Fetch-Site`: `same-origin` (link/fetch dell'app) e `none` (indirizzo digitato, segnalibro) sono ammessi;
 * `cross-site` e `same-site` (altro sottodominio) no. Senza intestazione (curl, Playwright `request`, client non browser) si
 * ammette: non e' una difesa contro chi ha la sessione, ma contro il browser dell'utente usato da una pagina altrui.
 */
export function isCrossSiteFetch(secFetchSite: string | null | undefined): boolean {
  if (secFetchSite === null || secFetchSite === undefined || secFetchSite === "") return false;
  const value = secFetchSite.trim().toLowerCase();
  return value !== "same-origin" && value !== "none";
}

/** Restituisce una risposta 403 se la richiesta corrente e' cross-site, altrimenti null. Da chiamare all'inizio di ogni GET di scarico. */
export async function rejectCrossSite(): Promise<NextResponse | null> {
  if (!isCrossSiteFetch((await headers()).get("sec-fetch-site"))) return null;
  return new NextResponse(null, { status: 403, headers: { "Cache-Control": "private, no-store" } });
}
