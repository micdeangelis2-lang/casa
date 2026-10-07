"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { CONFIDENTIALITY_LEVELS, createPackage, revokePackage, type SheetInput } from "@/modules/sharing";
import type { Level } from "@/modules/agent";
import { isUuid } from "@/lib/ids";
import { loadSheet, proofDocumentsWithinCap, sheetSpecSchema } from "@/lib/share-sheets";
import { zodIssuesToErrors, type FieldErrors } from "@/shared/result";

type Selection = { documentId: string; overrideAboveCap?: boolean };

/**
 * Crea il pacchetto. Se il modulo indica una scheda (`sheet`), la si ricava ora dai moduli di lettura, con il tetto di riservatezza
 * scelto, e si include nello ZIP come pagina HTML; per il dossier del consulente si possono aggiungere i documenti di prova.
 */
export async function createPackageAction(payload: unknown): Promise<{ errors: FieldErrors } | undefined> {
  const owner = await requireOwner();
  const { sheet: sheetRaw, ...rest } = (payload ?? {}) as Record<string, unknown>;
  let input: Record<string, unknown> = rest;
  let sheet: SheetInput | null = null;

  if (sheetRaw !== undefined && sheetRaw !== null) {
    const spec = sheetSpecSchema.safeParse(sheetRaw);
    if (!spec.success) return { errors: zodIssuesToErrors(spec.error) };
    const capRaw = String(rest.confidentialityCap);
    if ((CONFIDENTIALITY_LEVELS as readonly string[]).includes(capRaw)) {
      const cap = capRaw as Level;
      const db = getDb();
      const loaded = await loadSheet(db, spec.data, cap);
      if (!loaded) return { errors: { sheet: ["Non trovo i dati per la scheda scelta: controlla l'immobile, l'anno, il periodo o la pratica"] } };
      sheet = { kind: loaded.kind, title: loaded.title, csv: loaded.csv };
      if (spec.data.includeProofs && loaded.proofDocumentIds.length > 0) {
        const chosen: Selection[] = Array.isArray(rest.documents) ? (rest.documents as Selection[]) : [];
        const have = new Set(chosen.map((d) => d.documentId));
        const proofs = (await proofDocumentsWithinCap(db, loaded.proofDocumentIds, cap)).filter((id) => !have.has(id));
        input = { ...rest, documents: [...chosen, ...proofs.map((documentId) => ({ documentId, overrideAboveCap: false }))] };
      }
    }
  }

  const result = await runInUnitOfWork(getDb(), { type: "owner", id: owner.userId }, (uow) => createPackage(uow, input, new Date(), sheet));
  if (!result.ok) return { errors: result.errors };
  revalidatePath("/condivisione");
  redirect(`/condivisione/${result.value.id}`);
}

export async function revokePackageAction(packageId: string): Promise<void> {
  const owner = await requireOwner();
  if (!isUuid(packageId)) return;
  await runInUnitOfWork(getDb(), { type: "owner", id: owner.userId }, (uow) => revokePackage(uow, packageId));
  revalidatePath("/condivisione");
  revalidatePath(`/condivisione/${packageId}`);
}
