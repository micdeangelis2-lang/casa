import { requiredText, z } from "@/shared/zod";

/**
 * Categorie documentali modificabili dal proprietario. Il codice (`code`) e' l'identita' stabile: lo usano le regole del dossier
 * e le schede del notaio, del tecnico e dell'agente. Si assegna una volta, alla creazione, e non cambia piu': si rinomina solo il nome.
 */

/** Categorie seminate dalle migrazioni: si possono rinominare e riordinare, non rimuovere (il codice le richiama per codice). */
export const PROTECTED_CATEGORY_CODES = ["title_deed", "cadastral", "building", "systems", "energy", "condominium", "taxes", "insurance", "leases", "works", "correspondence", "other"] as const;

/** Nome della categoria che l'editor propone se non esiste: e' un dato creato dal proprietario, non una categoria predefinita. */
export const SUGGESTED_CATEGORY_NAME = "Fotografie";

export const categoryNameSchema = z.object({ name: requiredText("Nome", 120) });

/** Codice dal nome: minuscole senza accenti, parole unite da «_», al massimo 34 caratteri (le regole accettano fino a 40). */
export function categoryCodeFrom(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 34)
    .replace(/_+$/g, "");
  return base || "categoria";
}

export type DocumentCategoryUsage = {
  id: string;
  name: string;
  position: number;
  /** Quanti documenti (anche archiviati) hanno questa categoria. */
  documents: number;
  /** Quante sottocategorie. */
  children: number;
  /** Quante voci del dossier e versioni di regole la richiamano per codice. */
  references: number;
  /** Categoria seminata: non si rimuove. */
  protected: boolean;
  /** Si puo' rimuovere: non protetta e non usata. */
  removable: boolean;
};
