/** Lunghezza massima del titolo di un documento (come `documentInputSchema`). */
export const MAX_TITLE_LENGTH = 200;

/**
 * Titolo proposto a partire dal nome del file: toglie il percorso e l'ultima estensione, sostituisce le serie di
 * `_` e `-` con uno spazio, toglie i caratteri di controllo e normalizza gli spazi. Mai vuoto e mai oltre
 * `MAX_TITLE_LENGTH` caratteri (nome vuoto o fatto solo di simboli: «Documento»).
 */
export function titleFromFilename(filename: string): string {
  const base = filename.split(/[\\/]/u).pop() ?? "";
  // Un nome come ".pdf" non ha un'estensione da togliere: si tiene cio' che c'e' dopo il punto.
  const withoutExtension = base.replace(/(?<=.)\.[^.\s]{1,10}$/u, "").replace(/^\.+/u, "");
  const cleaned = withoutExtension
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/[_-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const title = Array.from(cleaned).slice(0, MAX_TITLE_LENGTH).join("").trim();
  return title || "Documento";
}
