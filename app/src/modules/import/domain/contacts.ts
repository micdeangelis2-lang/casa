import { normalizeHeader } from "./csv-reader";
import { resolveChoice, type ImportColumn } from "./columns";

/** Colonne del modello «Contatti». Le chiavi coincidono con i campi del modulo Rubrica. */
export const CONTACT_COLUMNS: readonly ImportColumn[] = [
  { key: "displayName", header: "Nome", aliases: ["Nome visualizzato", "Denominazione"], example: "ESEMPIO – Mario Rossi (riga fittizia, da cancellare)", required: true },
  { key: "roles", header: "Ruoli", aliases: ["Ruolo"], example: "tenant|supplier" },
  { key: "taxCode", header: "Codice fiscale o partita IVA", aliases: ["Codice fiscale", "Partita IVA", "CF", "P. IVA"], example: "" },
  { key: "email", header: "Email", aliases: ["E-mail", "Posta elettronica"], example: "esempio@esempio.test" },
  { key: "phone", header: "Telefono", aliases: ["Tel"], example: "000 0000000" },
  { key: "pec", header: "PEC", example: "" },
  { key: "address", header: "Indirizzo", example: "Via Esempio 1, 00000 Località" },
  { key: "notes", header: "Note", example: "Riga di esempio" },
];

export type ColumnIssue = { column: string; message: string };

/** Elenco di ruoli separati da «|» (anche «,» non e' ammesso: la virgola puo' stare nei nomi): ogni voce e' un codice o un'etichetta. */
export function parseRoles(raw: string, codes: readonly string[], labels: Record<string, string>): { roles: string[]; issues: ColumnIssue[] } {
  const roles: string[] = [];
  const issues: ColumnIssue[] = [];
  for (const part of raw.split("|")) {
    if (part.trim() === "") continue;
    const code = resolveChoice(part, codes, labels);
    if (!code) issues.push({ column: "roles", message: `Ruolo non riconosciuto: «${part.trim()}»` });
    else if (!roles.includes(code)) roles.push(code);
  }
  return { roles, issues };
}

/** Chiavi con cui si riconosce un contatto gia' presente. Il nome conta solo se la riga non ha altri identificativi. */
export function contactKeys(c: { displayName: string; taxCode?: string | null; email?: string | null }): { taxCode?: string; email?: string; name?: string } {
  const taxCode = c.taxCode ? c.taxCode.replace(/\s+/g, "").toUpperCase() : undefined;
  const email = c.email ? c.email.trim().toLowerCase() : undefined;
  return { ...(taxCode ? { taxCode } : {}), ...(email ? { email } : {}), name: normalizeHeader(c.displayName) };
}

/** Motivo per cui `row` e' un duplicato di `other` (stesso codice fiscale o stessa email; il nome solo senza altri identificativi). */
export function contactDuplicateReason(
  row: ReturnType<typeof contactKeys>,
  other: ReturnType<typeof contactKeys>,
): string | null {
  if (row.taxCode && row.taxCode === other.taxCode) return "stesso codice fiscale o partita IVA";
  if (row.email && row.email === other.email) return "stessa email";
  if (!row.taxCode && !row.email && row.name && row.name === other.name) return "stesso nome";
  return null;
}
