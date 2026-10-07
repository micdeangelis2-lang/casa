import { z } from "zod";
import { parseEuroToCents } from "./money";

// Messaggi di Zod in italiano per tutto cio' che non ha un messaggio esplicito.
z.config(z.locales.it());

/** Stringa facoltativa: elimina gli spazi e trasforma "" in undefined. */
export const optionalText = (max = 500) =>
  z.preprocess(
    (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : v.trim()) : v),
    z.string().max(max, `Massimo ${max} caratteri`).optional(),
  );

/** Stringa obbligatoria con messaggio chiaro quando e' vuota. */
export const requiredText = (label: string, max = 200) =>
  z
    .string({ error: `${label}: campo obbligatorio` })
    .trim()
    .min(1, `${label}: campo obbligatorio`)
    .max(max, `${label}: massimo ${max} caratteri`);

/** Data di calendario ISO (AAAA-MM-GG) facoltativa. */
export const optionalDate = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.iso.date("Data non valida").optional(),
);

/** Data di calendario ISO (AAAA-MM-GG) obbligatoria. */
export const requiredDate = z.iso.date("Data non valida");

/** Identificatore facoltativo: "" diventa undefined. */
export const optionalUuid = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.uuid("Scelta non valida").optional());

/** Importo in euro scritto dall'utente ("1.234,56") -> centesimi, obbligatorio. */
export const euroAmount = (label: string) =>
  z
    .string({ error: `${label}: campo obbligatorio` })
    .trim()
    .min(1, `${label}: campo obbligatorio`)
    .transform((v, ctx) => {
      const cents = parseEuroToCents(v);
      if (cents === null) ctx.addIssue({ code: "custom", message: `${label}: importo non valido (es. 1.234,56)` });
      return cents ?? 0;
    });

/** Come `euroAmount`, ma facoltativo: "" diventa undefined. */
export const optionalEuroAmount = (label: string) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z
      .string()
      .optional()
      .transform((v, ctx) => {
        if (v === undefined) return undefined;
        const cents = parseEuroToCents(v);
        if (cents === null) ctx.addIssue({ code: "custom", message: `${label}: importo non valido (es. 1.234,56)` });
        return cents ?? undefined;
      }),
  );

export { z };
