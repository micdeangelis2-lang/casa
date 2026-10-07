import { getDb } from "@/platform/db/client";
import { listDocumentCategories } from "@/modules/documents";
import { listDossierCategories } from "@/modules/dossier";

/** Categorie (dati) per i selettori degli esiti: quelle del dossier e quelle documentali. */
export async function loadRuleFormOptions() {
  const db = getDb();
  const [dossier, documents] = await Promise.all([listDossierCategories(db), listDocumentCategories(db)]);
  return {
    dossierCategories: dossier.map((c) => ({ code: c.code, name: c.name })),
    documentCategories: documents.map((c) => ({ code: c.code, name: c.name })),
  };
}
