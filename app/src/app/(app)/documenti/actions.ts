"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { addDocumentVersion, createDocument, setDocumentArchived, updateDocument } from "@/modules/documents";
import { isUuid } from "@/lib/ids";
import { discardStagedFile, readStagedFile } from "@/lib/staged-upload";
import type { FieldErrors } from "@/shared/result";

export type SaveResult = { errors: FieldErrors } | undefined;

const text = (data: FormData, key: string) => {
  const value = data.get(key);
  return typeof value === "string" ? value : "";
};

type Upload = { file: { name: string; bytes: Uint8Array } | null; stagedKey: string | null; errors?: FieldErrors };

/** Il file arriva nel FormData (percorso classico) oppure e' gia' in staging (`stagedKey` + `stagedName`, caricamento diretto). */
async function readUpload(data: FormData): Promise<Upload> {
  const stagedKey = text(data, "stagedKey");
  if (stagedKey) {
    const staged = await readStagedFile(stagedKey, text(data, "stagedName"));
    if (!staged.ok) return { file: null, stagedKey, errors: { file: [staged.error] } };
    return { file: staged.file, stagedKey };
  }
  const file = data.get("file");
  if (!(file instanceof File) || file.size === 0) return { file: null, stagedKey: null };
  return { file: { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, stagedKey: null };
}

const versionPayload = (data: FormData) => ({
  issuerPartyId: text(data, "issuerPartyId"),
  issuedOn: text(data, "issuedOn"),
  validFrom: text(data, "validFrom"),
  validTo: text(data, "validTo"),
  verificationStatus: text(data, "verificationStatus"),
  note: text(data, "note"),
});

const payloadFrom = (data: FormData, fallbackTitle: string) => ({
  title: text(data, "title").trim() || fallbackTitle,
  categoryId: text(data, "categoryId"),
  confidentiality: text(data, "confidentiality"),
  notes: text(data, "notes"),
  assetIds: data.getAll("assetIds").filter((v): v is string => typeof v === "string" && v !== ""),
  ...versionPayload(data),
});

/** Carica un documento nuovo (id nullo) o ne modifica i dati (il file non cambia). Con successo reindirizza alla scheda. */
export async function saveDocumentAction(documentId: string | null, data: FormData): Promise<SaveResult> {
  const owner = await requireOwner();
  if (documentId !== null && !isUuid(documentId)) return { errors: { _: ["Documento non trovato"] } };

  const upload: Upload = documentId === null ? await readUpload(data) : { file: null, stagedKey: null };
  try {
    if (upload.errors) return { errors: upload.errors };
    const file = upload.file;
    const fallbackTitle = file?.name.replace(/\.[^.]+$/, "") ?? "";
    const payload = payloadFrom(data, fallbackTitle);

    const result = await runInUnitOfWork(getDb(), { type: "owner", id: owner.userId }, (uow) =>
      documentId ? updateDocument(uow, documentId, payload) : createDocument(uow, payload, file),
    );
    if (!result.ok) return { errors: result.errors };

    revalidatePath("/documenti");
    redirect(`/documenti/${result.value.id}`);
  } finally {
    if (upload.stagedKey) await discardStagedFile(upload.stagedKey);
  }
}

/** Aggiunge una versione a un documento esistente. */
export async function addVersionAction(documentId: string, data: FormData): Promise<SaveResult> {
  const owner = await requireOwner();
  if (!isUuid(documentId)) return { errors: { _: ["Documento non trovato"] } };

  const upload = await readUpload(data);
  try {
    if (upload.errors) return { errors: upload.errors };
    const result = await runInUnitOfWork(getDb(), { type: "owner", id: owner.userId }, (uow) =>
      addDocumentVersion(uow, documentId, versionPayload(data), upload.file),
    );
    if (!result.ok) return { errors: result.errors };

    revalidatePath("/documenti");
    redirect(`/documenti/${documentId}`);
  } finally {
    if (upload.stagedKey) await discardStagedFile(upload.stagedKey);
  }
}

export async function archiveDocumentAction(documentId: string, archived: boolean): Promise<void> {
  const owner = await requireOwner();
  if (!isUuid(documentId)) return;
  await runInUnitOfWork(getDb(), { type: "owner", id: owner.userId }, (uow) => setDocumentArchived(uow, documentId, archived));
  revalidatePath("/documenti");
  revalidatePath(`/documenti/${documentId}`);
}
