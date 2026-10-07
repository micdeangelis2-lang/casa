import { getDb } from "@/platform/db/client";
import { listAssets } from "@/modules/assets";
import { listDocumentCategories } from "@/modules/documents";
import { listParties } from "@/modules/directory";

/** Opzioni dei selettori del modulo documento: categorie, immobili e contatti della rubrica. */
export async function loadDocumentFormOptions() {
  const db = getDb();
  const [categories, assets, parties] = await Promise.all([listDocumentCategories(db), listAssets(db), listParties(db)]);
  return {
    categories: categories.map((c) => ({ id: c.id, label: c.name })),
    assets: assets.map((a) => ({ id: a.id, label: a.name })),
    parties: parties.map((p) => ({ id: p.id, label: p.displayName })),
  };
}
