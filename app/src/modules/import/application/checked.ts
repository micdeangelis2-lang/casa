import { normalizeHeader } from "../domain/csv-reader";
import { DATE_HINT, parseFlexibleDate } from "../domain/dates";
import type { ColumnIssue } from "../domain/contacts";

/** Esito del controllo di una riga: dato pronto per la scrittura, oppure problemi per colonna, oppure «già presente». */
export type Checked = { payload?: unknown; label: string; issues: ColumnIssue[]; duplicate?: string };

export type Found = { id?: string; issue?: string };

/** Errori del validatore (per percorso) -> problemi per colonna. */
export function toIssues(errors: Record<string, string[]>, columnOf: (path: string) => string): ColumnIssue[] {
  return Object.entries(errors).flatMap(([path, messages]) => messages.map((message) => ({ column: columnOf(path), message })));
}

/** Aggiunge gli errori del validatore, senza ripetere quelli sulle colonne gia' segnalate dal controllo della riga. */
export function addSchemaIssues(issues: ColumnIssue[], errors: Record<string, string[]>, columnOf: (path: string) => string): void {
  for (const issue of toIssues(errors, columnOf)) if (!issues.some((i) => i.column === issue.column)) issues.push(issue);
}

/** Legge una data («gg/mm/aaaa» o «aaaa-mm-gg»); se non e' valida aggiunge il problema. Una cella vuota restituisce `undefined`. */
export function readDate(raw: string | undefined, column: string, issues: ColumnIssue[]): string | undefined {
  const parsed = parseFlexibleDate(raw ?? "");
  if (parsed.invalid) issues.push({ column, message: `Data non valida: ${DATE_HINT}` });
  return parsed.value;
}

/** Cerca per nome (senza badare a maiuscole, accenti e punteggiatura): una sola corrispondenza, altrimenti un problema leggibile. */
export function findByName<T extends { id: string }>(items: readonly T[], nameOf: (item: T) => string, text: string, messages: { missing: string; many: string }): Found {
  const norm = normalizeHeader(text);
  const hits = items.filter((item) => normalizeHeader(nameOf(item)) === norm);
  if (hits.length === 0) return { issue: messages.missing };
  if (hits.length > 1) return { issue: messages.many };
  return { id: hits[0]!.id };
}

type PartyLike = { id: string; displayName: string; taxCode: string | null };

/** Cerca un contatto in rubrica per codice fiscale o per nome. */
export function findParty(parties: readonly PartyLike[], text: string, subject: string): Found {
  const norm = normalizeHeader(text);
  const code = text.replace(/\s+/g, "").toUpperCase();
  const hits = parties.filter((p) => (p.taxCode && p.taxCode === code) || normalizeHeader(p.displayName) === norm);
  if (hits.length === 0) return { issue: `${subject} «${text}» non trovato in rubrica: importa o inserisci prima il contatto` };
  if (hits.length > 1) return { issue: `Più contatti corrispondono a «${text}»: usa il codice fiscale` };
  return { id: hits[0]!.id };
}
