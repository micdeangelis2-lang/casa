import { describe, expect, it } from "vitest";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { findPostgresCode, formatRequestError, serializeRequestError } from "@/platform/logging/request-error";

const NOW = new Date("2026-10-06T10:00:00.000Z");
const CONTEXT = { routePath: "/immobili/[id]", routeType: "render" };
const line = (error: unknown, request = { method: "GET" }, context: Record<string, unknown> = CONTEXT) =>
  serializeRequestError(formatRequestError(error, request, context, NOW));

describe("riga di log degli errori del server", () => {
  it("contiene i campi previsti e il digest mostrato all'utente", () => {
    const error = Object.assign(new TypeError("boom"), { digest: "1234567890" });
    expect(JSON.parse(line(error))).toEqual({
      level: "error",
      time: "2026-10-06T10:00:00.000Z",
      digest: "1234567890",
      route: "/immobili/[id]",
      method: "GET",
      routeType: "render",
      errorName: "TypeError",
    });
    expect(line(error)).not.toContain("\n");
  });

  it("senza digest o contesto scrive null, senza inventare nulla", () => {
    expect(JSON.parse(line(new Error("x"), {} as { method: string }, {}))).toMatchObject({ digest: null, route: null, method: null, routeType: null });
    expect(JSON.parse(line("stringa lanciata", { method: "POST" }))).toMatchObject({ errorName: "Error", digest: null });
    expect(JSON.parse(line(null))).toMatchObject({ errorName: "Error" });
  });

  it("non riporta messaggio ne' stack, anche se contengono dati personali", () => {
    const error = new Error("Utente mario.rossi@example.com, CF RSSMRA80A01H501U, IBAN IT60X0542811101000000123456");
    const out = line(error);
    expect(out).not.toMatch(/mario|rossi|example\.com|RSSMRA|IT60X|Utente/);
    expect(out).not.toContain("request-error.test");
    expect(out).not.toContain("stack");
    expect(out).not.toContain("message");
  });

  it("un errore di Drizzle (query e parametri) non fa trapelare nulla, ma conserva il codice Postgres", () => {
    const pgError = Object.assign(new Error('duplicate key value violates unique constraint "party_tax_code_idx"'), { code: "23505", detail: "Key (tax_code)=(RSSMRA80A01H501U) already exists." });
    const error = new DrizzleQueryError('insert into "party" ("tax_code","email") values ($1, $2)', ["RSSMRA80A01H501U", "mario.rossi@example.com"], pgError);
    const out = line(error);
    expect(JSON.parse(out)).toMatchObject({ errorName: "DrizzleQueryError", code: "23505" });
    expect(out).not.toMatch(/RSSMRA|mario|example\.com|insert into|party|tax_code|\$1/);
  });

  it("una causa annidata a piu' livelli non entra nella riga, solo il suo codice", () => {
    const inner = Object.assign(new Error("password for user casa=secret123"), { code: "28P01" });
    const error = new Error("livello 1 mario@example.com", { cause: new Error("livello 2", { cause: inner }) });
    const out = line(error);
    expect(JSON.parse(out).code).toBe("28P01");
    expect(out).not.toMatch(/secret123|mario|livello|password/);
  });

  it("scarta valori ostili nei campi: nome, digest, route, metodo, tipo", () => {
    const error = Object.assign(new Error("x"), { name: "Errore di mario@example.com", digest: "a b\nc@example.com" });
    const out = line(error, { method: "FOO mario" }, { routePath: "/immobili/RSSMRA80A01H501U?email=a@b.it", routeType: "mario@example.com" });
    expect(JSON.parse(out)).toMatchObject({ errorName: "Error", digest: null, route: null, method: null, routeType: null });
    expect(out).not.toMatch(/mario|RSSMRA|example|a@b/);
    expect(out.split("\n")).toHaveLength(1);
  });

  it("il codice non valido (non SQLSTATE) viene ignorato e la catena circolare non si blocca", () => {
    expect(findPostgresCode(Object.assign(new Error("x"), { code: "ECONNREFUSED mario@example.com" }))).toBeUndefined();
    const a: { cause?: unknown } = {};
    a.cause = a;
    expect(findPostgresCode(a)).toBeUndefined();
  });

  it("non lancia se le proprieta' dell'errore lanciano", () => {
    const hostile = new Proxy({}, { get() { throw new Error("no"); } });
    expect(() => line(hostile)).not.toThrow();
  });

  it("accetta il digest con suffisso del codice errore di Next", () => {
    expect(JSON.parse(line(Object.assign(new Error("x"), { digest: "4018112@E394" }))).digest).toBe("4018112@E394");
  });

  it("i metodi in minuscolo si normalizzano; le route con gruppi e slot sono ammesse", () => {
    expect(JSON.parse(line(new Error("x"), { method: "post" }, { routePath: "/(app)/api/[...slug]", routeType: "route" }))).toMatchObject({ method: "POST", route: "/(app)/api/[...slug]" });
  });
});
