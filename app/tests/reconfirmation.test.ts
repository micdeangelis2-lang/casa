import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import {
  RECONFIRM_MAX_AGE_SECONDS,
  isNavigationRequest,
  reconfirmPath,
  safeReturnPath,
  signReconfirmation,
  verifyReconfirmation,
} from "@/platform/auth/reconfirmation";

const secret = "un-segreto-di-prova-lungo-almeno-trentadue-caratteri";
const binding = { secret, userId: "utente-1", sessionId: "sessione-1" };
const NOW = 1_800_000_000_000;

describe("riconferma recente: cookie firmato (F-04)", () => {
  it("una prova appena emessa vale per lo stesso utente e la stessa sessione", () => {
    const token = signReconfirmation(binding, NOW);
    expect(token).toMatch(/^v1\.\d+\.[0-9a-f]{64}$/);
    expect(verifyReconfirmation(token, binding, { nowMs: NOW })).toBe(true);
    expect(verifyReconfirmation(token, binding, { nowMs: NOW + 5 * 60_000 })).toBe(true);
  });

  it("scade: dopo dieci minuti (e un secondo) non vale piu'", () => {
    const token = signReconfirmation(binding, NOW);
    const limit = RECONFIRM_MAX_AGE_SECONDS * 1000;
    expect(verifyReconfirmation(token, binding, { nowMs: NOW + limit })).toBe(true);
    expect(verifyReconfirmation(token, binding, { nowMs: NOW + limit + 1000 })).toBe(false);
    expect(verifyReconfirmation(token, binding, { nowMs: NOW + limit + 1000, maxAgeMs: limit + 5000 })).toBe(true);
  });

  it("una prova con istante nel futuro non vale (orologio manomesso o prova fabbricata)", () => {
    const token = signReconfirmation(binding, NOW + 60_000);
    expect(verifyReconfirmation(token, binding, { nowMs: NOW })).toBe(false);
  });

  it("manomissione: istante cambiato, firma cambiata, formato sbagliato", () => {
    const token = signReconfirmation(binding, NOW);
    const [v, issued, mac] = token.split(".") as [string, string, string];
    expect(verifyReconfirmation(`${v}.${Number(issued) + 1000}.${mac}`, binding, { nowMs: NOW + 2000 })).toBe(false);
    const flipped = `${mac.slice(0, -1)}${mac.endsWith("0") ? "1" : "0"}`;
    expect(verifyReconfirmation(`${v}.${issued}.${flipped}`, binding, { nowMs: NOW })).toBe(false);
    for (const bad of ["", "v1", "v1..", `v2.${issued}.${mac}`, `${token}x`, token.toUpperCase(), "a".repeat(500), null, undefined]) {
      expect(verifyReconfirmation(bad, binding, { nowMs: NOW }), String(bad)).toBe(false);
    }
  });

  it("e' legata all'utente e alla sessione: un altro utente, un'altra sessione o un altro segreto non la accettano", () => {
    const token = signReconfirmation(binding, NOW);
    expect(verifyReconfirmation(token, { ...binding, userId: "utente-2" }, { nowMs: NOW })).toBe(false);
    expect(verifyReconfirmation(token, { ...binding, sessionId: "sessione-2" }, { nowMs: NOW })).toBe(false);
    expect(verifyReconfirmation(token, { ...binding, secret: `${secret}!` }, { nowMs: NOW })).toBe(false);
  });

  it("non e' una firma diretta del segreto di Better Auth (chiave derivata)", () => {
    const direct = createHmac("sha256", secret).update(`${binding.userId}|${binding.sessionId}|${NOW}`).digest("hex");
    expect(verifyReconfirmation(`v1.${NOW}.${direct}`, binding, { nowMs: NOW })).toBe(false);
  });
});

describe("riconferma recente: percorso di ritorno (anti open redirect)", () => {
  it("ammette solo percorsi interni", () => {
    expect(safeReturnPath("/")).toBe("/");
    expect(safeReturnPath("/api/esportazione")).toBe("/api/esportazione");
    expect(safeReturnPath("/impostazioni/sicurezza?x=1#a")).toBe("/impostazioni/sicurezza?x=1");
    expect(safeReturnPath("/condivisione/2f9c1d2e-0000-4000-8000-000000000000")).toBe("/condivisione/2f9c1d2e-0000-4000-8000-000000000000");
  });

  it("rifiuta indirizzi esterni, schemi, doppia barra, barre rovesciate e caratteri di controllo", () => {
    const bad: unknown[] = [
      "https://evil.test",
      "http://evil.test/x",
      "//evil.test",
      "///evil.test",
      "/\\evil.test",
      "\\\\evil.test",
      "/..\\evil",
      "javascript:alert(1)",
      "data:text/html,x",
      "evil.test",
      "",
      "relativo/senza/barra",
      "/ok\nHeader: x",
      "/ok\r\n",
      "/\u0000",
      "/" + "a".repeat(600),
      "/riconferma",
      "/riconferma?ritorno=/x",
      null,
      undefined,
      42,
      ["/ok"],
    ];
    for (const value of bad) expect(safeReturnPath(value), String(value)).toBeNull();
  });

  it("reconfirmPath codifica il ritorno e ripiega sulla pagina nuda", () => {
    expect(reconfirmPath("/api/esportazione")).toBe("/riconferma?ritorno=%2Fapi%2Fesportazione");
    expect(reconfirmPath("//evil.test")).toBe("/riconferma");
    expect(reconfirmPath(null)).toBe("/riconferma");
  });

  it("distingue una navigazione del browser da una richiesta non navigazionale", () => {
    const h = (o: Record<string, string>) => new Headers(o);
    expect(isNavigationRequest(h({ "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" }))).toBe(true);
    expect(isNavigationRequest(h({ "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" }))).toBe(false);
    expect(isNavigationRequest(h({ accept: "text/html,application/xhtml+xml" }))).toBe(true);
    expect(isNavigationRequest(h({ accept: "*/*" }))).toBe(false);
    expect(isNavigationRequest(h({}))).toBe(false);
  });
});
