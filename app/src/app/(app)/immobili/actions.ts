"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { createAsset, setAssetArchived, setAssetDeclaredValue, updateAsset } from "@/modules/assets";
import { evaluateDossier } from "@/modules/dossier";
import { isUuid } from "@/lib/ids";
import { ownerAction, type MiniResult } from "@/lib/owner-action";
import type { FormValues } from "@/components/simple-form";
import type { FieldErrors } from "@/shared/result";

export type SaveResult = { errors: FieldErrors } | undefined;

/** Crea (assetId nullo) o modifica un immobile. Con successo reindirizza alla scheda. */
export async function saveAssetAction(assetId: string | null, payload: unknown): Promise<SaveResult> {
  const owner = await requireOwner();
  if (assetId !== null && !isUuid(assetId)) return { errors: { _: ["Bene non trovato"] } };

  const ownerInfo = { displayName: owner.name, email: owner.email };
  // Il dossier si riallinea alle regole nella stessa transazione del salvataggio: il bene e le sue voci non divergono.
  const result = await runInUnitOfWork(getDb(), { type: "owner", id: owner.userId }, async (uow) => {
    const saved = assetId ? await updateAsset(uow, ownerInfo, assetId, payload) : await createAsset(uow, ownerInfo, payload);
    if (saved.ok) await evaluateDossier(uow, saved.value.id);
    return saved;
  });
  if (!result.ok) return { errors: result.errors };

  revalidatePath("/immobili");
  redirect(`/immobili/${result.value.id}`);
}

export async function archiveAssetAction(assetId: string, archived: boolean): Promise<void> {
  const owner = await requireOwner();
  if (!isUuid(assetId)) return;
  await runInUnitOfWork(getDb(), { type: "owner", id: owner.userId }, async (uow) => {
    const done = await setAssetArchived(uow, assetId, archived);
    // Un bene archiviato non si valuta; ripristinato, si riallinea alle regole di oggi.
    if (done.ok && !archived) await evaluateDossier(uow, assetId);
  });
  revalidatePath("/immobili");
  revalidatePath(`/immobili/${assetId}`);
}

/** Valore dichiarato dal proprietario: campo vuoto = nessun valore dichiarato. */
export async function setDeclaredValueAction(assetId: string, values: FormValues): Promise<MiniResult> {
  if (!isUuid(assetId)) return { errors: { _: ["Bene non trovato"] } };
  const declaredValue = typeof values.declaredValue === "string" ? values.declaredValue : "";
  return ownerAction((uow) => setAssetDeclaredValue(uow, assetId, { declaredValue }), [`/immobili/${assetId}`, "/assicurazioni/per-immobile"]);
}
