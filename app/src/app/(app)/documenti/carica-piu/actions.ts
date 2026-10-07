"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { createDocument, findDocumentsWithSameFile } from "@/modules/documents";

/** Esito del caricamento di un solo file del lotto. */
export type UploadOutcome =
  | { status: "created"; id: string; title: string }
  | { status: "duplicate"; matches: { id: string; title: string }[] }
  | { status: "rejected"; message: string }
  | { status: "error" };

const text = (data: FormData, key: string) => {
  const value = data.get(key);
  return typeof value === "string" ? value : "";
};

/**
 * Carica UN file del lotto con lo stesso caso d'uso del modulo singolo (`createDocument`: stessi controlli su
 * dimensione, tipo dai byte, categoria e immobile; stessa scrittura con audit). Prima controlla se lo stesso file
 * (sha256) e' gia' in archivio, come fa l'avviso sui duplicati della scheda: se si', non lo carica a meno che
 * `force` non sia "1". Una richiesta per file: ogni corpo resta sotto il limite delle azioni del server.
 */
export async function uploadOneDocumentAction(data: FormData): Promise<UploadOutcome> {
  const owner = await requireOwner();
  try {
    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0) return { status: "rejected", message: "Il file è vuoto" };
    const bytes = new Uint8Array(await file.arrayBuffer());

    if (text(data, "force") !== "1") {
      const matches = await findDocumentsWithSameFile(getDb(), bytes);
      if (matches.length > 0) return { status: "duplicate", matches: matches.map((m) => ({ id: m.documentId, title: m.title })) };
    }

    const title = text(data, "title").trim();
    const payload = {
      title,
      categoryId: text(data, "categoryId"),
      confidentiality: text(data, "confidentiality"),
      assetIds: text(data, "assetId") ? [text(data, "assetId")] : [],
    };
    const result = await runInUnitOfWork(getDb(), { type: "owner", id: owner.userId }, (uow) =>
      createDocument(uow, payload, { name: file.name, bytes }),
    );
    if (!result.ok) {
      const first = Object.values(result.errors).flat()[0];
      return { status: "rejected", message: first ?? "Il documento non è stato caricato" };
    }
    // Ricarica l'elenco dei documenti.
    revalidatePath("/documenti");
    return { status: "created", id: result.value.id, title };
  } catch {
    return { status: "error" };
  }
}
