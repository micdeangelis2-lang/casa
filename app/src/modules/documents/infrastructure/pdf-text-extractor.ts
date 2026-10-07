import { extractText, getDocumentProxy } from "unpdf";
import type { TextExtractor } from "../application/ports";

/**
 * Estrae il testo incorporato nei PDF, in processo (nessun servizio esterno: D6).
 * Un PDF che e' solo scansione non ha testo: resta cercabile per titolo e nome file. L'OCR e' disattivato.
 */
export const pdfTextExtractor: TextExtractor = {
  async extract(bytes, mimeType) {
    if (mimeType !== "application/pdf") return null;
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    const trimmed = text.replace(/\s+/g, " ").trim();
    return trimmed === "" ? null : trimmed;
  },
};
