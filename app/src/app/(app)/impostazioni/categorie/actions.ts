"use server";

import { addDocumentCategory, moveDocumentCategory, removeDocumentCategory, renameDocumentCategory, SUGGESTED_CATEGORY_NAME } from "@/modules/documents";
import { isUuid } from "@/lib/ids";
import { ownerAction, type MiniResult } from "@/lib/owner-action";
import type { FormValues } from "@/components/simple-form";

const text = (v: FormValues, k: string) => (typeof v[k] === "string" ? (v[k] as string) : "");
// Le categorie compaiono nei moduli dei documenti, nei filtri e nelle schede: si ricaricano tutte le pagine che le elencano.
const PATHS = ["/impostazioni/categorie", "/documenti", "/documenti/nuovo", "/documenti/carica-piu"];
const notFound = (): MiniResult => ({ errors: { _: ["Categoria non trovata"] } });

export async function addCategoryAction(values: FormValues): Promise<MiniResult> {
  return ownerAction((uow) => addDocumentCategory(uow, { name: text(values, "name") }), PATHS);
}

/** Aggiunge la categoria proposta («Fotografie»): e' un dato creato dal proprietario con un clic, non una categoria predefinita. */
export async function addSuggestedCategoryAction(): Promise<MiniResult> {
  return ownerAction((uow) => addDocumentCategory(uow, { name: SUGGESTED_CATEGORY_NAME }), PATHS);
}

export async function renameCategoryAction(categoryId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(categoryId)) return notFound();
  return ownerAction((uow) => renameDocumentCategory(uow, categoryId, { name: text(values, "name") }), PATHS);
}

export async function moveCategoryAction(categoryId: string, direction: "up" | "down"): Promise<void> {
  if (isUuid(categoryId)) await ownerAction((uow) => moveDocumentCategory(uow, categoryId, direction), PATHS);
}

export async function removeCategoryAction(categoryId: string): Promise<void> {
  if (isUuid(categoryId)) await ownerAction((uow) => removeDocumentCategory(uow, categoryId), PATHS);
}
