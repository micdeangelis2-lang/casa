import "server-only";
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { getAuthEnv } from "../config/env";
import { getAuth } from "./auth";
import type { OwnerContext } from "./owner";
import {
  PASSKEY_SESSION_MAX_AGE_MS,
  RECONFIRM_COOKIE,
  RECONFIRM_MAX_AGE_SECONDS,
  isNavigationRequest,
  reconfirmPath,
  signReconfirmation,
  verifyReconfirmation,
} from "./reconfirmation";

/**
 * Riconferma recente richiesta per i dati e le azioni piu' sensibili (F-04): vedi `reconfirmation.ts` per la prova firmata.
 * Questo file la lega al framework: legge/scrive il cookie e risponde dalle route di scarico.
 */

const binding = (owner: OwnerContext) => ({ secret: getAuthEnv().BETTER_AUTH_SECRET, userId: owner.userId, sessionId: owner.sessionId });

export async function hasRecentReconfirmation(owner: OwnerContext): Promise<boolean> {
  return verifyReconfirmation((await cookies()).get(RECONFIRM_COOKIE)?.value, binding(owner));
}

/** Scrive la prova nel cookie (httpOnly, SameSite=Strict, durata breve). Va chiamata solo dopo una verifica riuscita. */
export async function grantReconfirmation(owner: OwnerContext): Promise<void> {
  (await cookies()).set(RECONFIRM_COOKIE, signReconfirmation(binding(owner)), {
    httpOnly: true,
    sameSite: "strict",
    secure: new URL(getAuthEnv().BETTER_AUTH_URL).protocol === "https:",
    path: "/",
    maxAge: RECONFIRM_MAX_AGE_SECONDS,
  });
}

/**
 * Vero se la sessione in uso e' nata da pochissimo: dopo `signIn.passkey()` la riconferma con la passkey crea una sessione nuova
 * (la verifica della firma e' del plugin), e solo chi ha appena usato la passkey (o password e codice) ne ha una cosi' giovane.
 */
export async function isSessionJustCreated(): Promise<boolean> {
  const current = await getAuth().api.getSession({ headers: await headers() });
  return current ? Date.now() - new Date(current.session.createdAt).getTime() <= PASSKEY_SESSION_MAX_AGE_MS : false;
}

/**
 * Per le route di scarico: null se la riconferma e' valida, altrimenti la risposta da restituire.
 * Navigazione del browser (clic su un link): 303 verso `/riconferma?ritorno=<percorso>`, per poi tornare allo scarico.
 * Qualunque altra richiesta (fetch, curl): 403 con un JSON minimo `{ error: "reconfirm_required", reconfirm: "<pagina>" }`.
 * (401 resta riservato all'assenza di sessione.)
 */
export async function requireRecentAuthForApi(request: Request, owner: OwnerContext): Promise<NextResponse | null> {
  if (await hasRecentReconfirmation(owner)) return null;
  const url = new URL(request.url);
  const target = reconfirmPath(`${url.pathname}${url.search}`);
  const noStore = { "Cache-Control": "private, no-store" };
  if (isNavigationRequest(request.headers)) {
    return NextResponse.redirect(new URL(target, getAuthEnv().BETTER_AUTH_URL), { status: 303, headers: noStore });
  }
  return NextResponse.json({ error: "reconfirm_required", reconfirm: target }, { status: 403, headers: noStore });
}
