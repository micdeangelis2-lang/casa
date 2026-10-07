import type { z } from "zod";

/** Errori per campo, con percorso puntato (es. `rights.0.quotaNumerator`). Chiave `_` = errore generale. */
export type FieldErrors = Record<string, string[]>;

export type Result<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = (errors: FieldErrors): Result<never> => ({ ok: false, errors });
export const failGeneral = (message: string): Result<never> => fail({ _: [message] });

export function zodIssuesToErrors(error: z.ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "_";
    (errors[key] ??= []).push(issue.message);
  }
  return errors;
}

/** Valida un input con uno schema Zod e lo restituisce come `Result` (errori per campo). */
export function parseInput<T>(schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: z.ZodError } }, raw: unknown): Result<T> {
  const parsed = schema.safeParse(raw);
  return parsed.success ? ok(parsed.data) : fail(zodIssuesToErrors(parsed.error));
}
