"use server";

import { redirect } from "next/navigation";
import { requireOwner } from "@/platform/auth/owner";
import { assignPlant, createPlant, linkPlantDocument, setPlantArchived, unlinkPlantDocument, updatePlant } from "@/modules/maintenance";
import { isUuid } from "@/lib/ids";
import { ownerAction, ownerActionWithValue, type MiniResult } from "@/lib/owner-action";
import type { FormValues } from "@/components/simple-form";
import type { FieldErrors } from "@/shared/result";

export type SaveResult = { errors: FieldErrors } | undefined;
const text = (v: FormValues, k: string) => (typeof v[k] === "string" ? (v[k] as string) : "");
const notFound = (): MiniResult => ({ errors: { _: ["Elemento non trovato"] } });
const pages = (id?: string) => ["/manutenzioni/impianti", "/manutenzioni/impianti/scheda", ...(id ? [`/manutenzioni/impianti/${id}`] : [])];

/** Registra (id nullo) o modifica un impianto. Con successo reindirizza alla sua scheda. */
export async function savePlantAction(plantId: string | null, values: FormValues): Promise<SaveResult> {
  await requireOwner();
  if (plantId !== null && !isUuid(plantId)) return { errors: { _: ["Impianto non trovato"] } };
  const payload = {
    assetId: text(values, "assetId"),
    kind: text(values, "kind"),
    name: text(values, "name"),
    installedOn: text(values, "installedOn"),
    installerPartyId: text(values, "installerPartyId"),
    maintainerPartyId: text(values, "maintainerPartyId"),
    serialNumber: text(values, "serialNumber"),
    note: text(values, "note"),
  };
  const result = await ownerActionWithValue((uow) => (plantId ? updatePlant(uow, plantId, payload) : createPlant(uow, payload)), pages(plantId ?? undefined));
  if (!result.ok) return { errors: result.errors };
  redirect(`/manutenzioni/impianti/${result.value.id}`);
}

export async function archivePlantAction(plantId: string, archived: boolean): Promise<void> {
  if (isUuid(plantId)) await ownerAction((uow) => setPlantArchived(uow, plantId, archived), pages(plantId));
}

export async function linkPlantDocumentAction(plantId: string, values: FormValues): Promise<MiniResult> {
  const documentId = text(values, "documentId");
  if (!isUuid(plantId)) return notFound();
  if (!isUuid(documentId)) return { errors: { documentId: ["Scegli un documento"] } };
  return ownerAction((uow) => linkPlantDocument(uow, plantId, documentId), pages(plantId));
}

export async function unlinkPlantDocumentAction(plantId: string, documentId: string): Promise<void> {
  if (isUuid(plantId) && isUuid(documentId)) await ownerAction((uow) => unlinkPlantDocument(uow, plantId, documentId), pages(plantId));
}

/** Collega un piano, una garanzia o un intervento esistente all'impianto (itemId dal modulo). */
export async function attachPlantItemAction(plantId: string, kind: string, values: FormValues): Promise<MiniResult> {
  const itemId = text(values, "itemId");
  if (!isUuid(plantId)) return notFound();
  if (!isUuid(itemId)) return { errors: { itemId: ["Scegli cosa collegare"] } };
  return ownerAction((uow) => assignPlant(uow, kind, itemId, plantId), [...pages(plantId), "/manutenzioni"]);
}

export async function detachPlantItemAction(plantId: string, kind: string, itemId: string): Promise<void> {
  if (isUuid(plantId) && isUuid(itemId)) await ownerAction((uow) => assignPlant(uow, kind, itemId, null), [...pages(plantId), "/manutenzioni"]);
}
