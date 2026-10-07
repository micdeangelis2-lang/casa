import { createHash, randomUUID } from "node:crypto";
import { fail, failGeneral, ok, zodIssuesToErrors, type FieldErrors, type Result } from "@/shared/result";
import {
  documentInputSchema,
  documentUpdateSchema,
  MAX_FILE_BYTES,
  sniffFile,
  versionInputSchema,
  type DocumentDetail,
  type VersionView,
} from "../domain/document";
import type { DocumentDeps, DuplicateMatch, ListArgs, ReadDeps, StoredFile } from "./ports";

export type UploadedFile = { name: string; bytes: Uint8Array };

/** Controlla il file caricato: presenza, dimensione e tipo (dai byte). */
function checkFile(file: UploadedFile | null): Result<{ mime: string }> {
  if (!file || file.bytes.length === 0) return fail({ file: ["Scegli il file da caricare"] });
  if (file.bytes.length > MAX_FILE_BYTES) {
    return fail({ file: [`Il file supera il limite di ${MAX_FILE_BYTES / (1024 * 1024)} MB`] });
  }
  const sniffed = sniffFile(file.bytes, file.name);
  if (!sniffed) {
    return fail({ file: ["Tipo di file non ammesso. Sono ammessi PDF, immagini (JPEG, PNG, GIF, WebP, TIFF), documenti Word/Excel/OpenDocument e file firmati .p7m"] });
  }
  return ok({ mime: sniffed.mime });
}

/** Controlli che richiedono di consultare il database o altri moduli. */
async function checkReferences(
  deps: Pick<DocumentDeps, "repo" | "others">,
  input: { categoryId: string; assetIds: string[]; issuerPartyId?: string },
): Promise<FieldErrors> {
  const errors: FieldErrors = {};
  const categories = await deps.repo.listCategories();
  if (!categories.some((c) => c.id === input.categoryId)) errors.categoryId = ["La categoria scelta non esiste"];
  if (input.assetIds.length > 0) {
    const known = new Set((await deps.others.assets()).map((a) => a.id));
    if (input.assetIds.some((id) => !known.has(id))) errors.assetIds = ["Uno dei beni scelti non esiste più"];
  }
  if (input.issuerPartyId) {
    const known = new Set((await deps.others.parties()).map((p) => p.id));
    if (!known.has(input.issuerPartyId)) errors.issuerPartyId = ["L'emittente non esiste più nella rubrica"];
  }
  return errors;
}

const EXTRACT_TIMEOUT_MS = 20_000;
const MAX_TEXT_CHARS = 2_000_000;

async function extractText(deps: DocumentDeps, file: UploadedFile, mime: string): Promise<string | null> {
  try {
    const text = await Promise.race([
      deps.extractor.extract(file.bytes, mime),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), EXTRACT_TIMEOUT_MS)),
    ]);
    return text ? text.slice(0, MAX_TEXT_CHARS) : null;
  } catch {
    // Un PDF illeggibile non deve impedire di archiviarlo: resta cercabile solo per titolo.
    return null;
  }
}

/**
 * Salva i byte nello storage e, se la scrittura nel database fallisce, li rimuove.
 * Lo storage non e' transazionale: l'ordine "prima i byte, poi le righe" evita righe che puntano al nulla.
 */
async function storeAndRecord<T>(
  deps: DocumentDeps,
  file: UploadedFile,
  mime: string,
  record: (fileObjectId: string, extractedText: string | null) => Promise<T>,
): Promise<T> {
  const storageKey = `documents/${randomUUID()}`;
  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  const extractedText = await extractText(deps, file, mime);
  await deps.storage.put(storageKey, file.bytes);
  try {
    const fileObjectId = await deps.repo.insertFileObject({ storageKey, sha256, sizeBytes: file.bytes.length, mimeType: mime });
    return await record(fileObjectId, extractedText);
  } catch (error) {
    await deps.storage.delete(storageKey).catch(() => undefined);
    throw error;
  }
}

export async function createDocument(deps: DocumentDeps, rawInput: unknown, file: UploadedFile | null): Promise<Result<{ id: string }>> {
  const parsed = documentInputSchema.safeParse(rawInput);
  const errors: FieldErrors = parsed.success ? {} : zodIssuesToErrors(parsed.error);
  const checked = checkFile(file);
  if (!checked.ok) Object.assign(errors, checked.errors);
  if (!parsed.success || !checked.ok || !file) return fail(errors);

  const referenceErrors = await checkReferences(deps, parsed.data);
  if (Object.keys(referenceErrors).length > 0) return fail(referenceErrors);

  const { title, categoryId, confidentiality, notes, assetIds, ...versionFields } = parsed.data;
  return storeAndRecord(deps, file, checked.value.mime, async (fileObjectId, extractedText) => {
    const id = await deps.repo.insertDocument({ title, categoryId, confidentiality, notes });
    const version = await deps.repo.insertVersion(id, { ...versionFields, fileObjectId, originalFilename: file.name, extractedText });
    await deps.repo.setAssets(id, assetIds);
    await deps.audit.record({
      action: "document.create",
      entityType: "document",
      entityId: id,
      diff: { title, categoryId, confidentiality, assets: assetIds.length, versionNo: version.versionNo, hasText: extractedText !== null },
    });
    return ok({ id });
  });
}

/** Documenti che contengono gia' esattamente questo file (stesso sha256 dei byte): stesso criterio dell'avviso sui duplicati. */
export async function findDocumentsWithSameFile(deps: ReadDeps, bytes: Uint8Array): Promise<{ documentId: string; title: string }[]> {
  return deps.repo.findBySha256(createHash("sha256").update(bytes).digest("hex"));
}

export async function addDocumentVersion(
  deps: DocumentDeps,
  documentId: string,
  rawInput: unknown,
  file: UploadedFile | null,
): Promise<Result<{ id: string; versionNo: number }>> {
  const parsed = versionInputSchema.safeParse(rawInput);
  const errors: FieldErrors = parsed.success ? {} : zodIssuesToErrors(parsed.error);
  const checked = checkFile(file);
  if (!checked.ok) Object.assign(errors, checked.errors);
  if (!parsed.success || !checked.ok || !file) return fail(errors);

  const existing = await deps.repo.getDetail(documentId);
  if (!existing) return failGeneral("Documento non trovato");
  const referenceErrors = await checkReferences(deps, { categoryId: existing.categoryId, assetIds: [], issuerPartyId: parsed.data.issuerPartyId });
  delete referenceErrors.categoryId;
  if (Object.keys(referenceErrors).length > 0) return fail(referenceErrors);

  return storeAndRecord(deps, file, checked.value.mime, async (fileObjectId, extractedText) => {
    const version = await deps.repo.insertVersion(documentId, { ...parsed.data, fileObjectId, originalFilename: file.name, extractedText });
    await deps.audit.record({
      action: "document.version.add",
      entityType: "document",
      entityId: documentId,
      diff: { versionNo: version.versionNo, hasText: extractedText !== null },
    });
    return ok({ id: documentId, versionNo: version.versionNo });
  });
}

const sameList = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

export async function updateDocument(deps: DocumentDeps, id: string, rawInput: unknown): Promise<Result<{ id: string }>> {
  const parsed = documentUpdateSchema.safeParse(rawInput);
  if (!parsed.success) return fail(zodIssuesToErrors(parsed.error));
  const before = await deps.repo.getDetail(id);
  if (!before) return failGeneral("Documento non trovato");
  const referenceErrors = await checkReferences(deps, parsed.data);
  if (Object.keys(referenceErrors).length > 0) return fail(referenceErrors);

  const { title, categoryId, confidentiality, notes, assetIds, ...versionFields } = parsed.data;
  const current = before.versions[0]!;
  const changed = [
    title !== before.title && "title",
    categoryId !== before.categoryId && "categoryId",
    confidentiality !== before.confidentiality && "confidentiality",
    (notes ?? null) !== before.notes && "notes",
    (versionFields.issuedOn ?? null) !== current.issuedOn && "issuedOn",
    (versionFields.validFrom ?? null) !== current.validFrom && "validFrom",
    (versionFields.validTo ?? null) !== current.validTo && "validTo",
    (versionFields.issuerPartyId ?? null) !== current.issuerPartyId && "issuerPartyId",
    versionFields.verificationStatus !== current.verificationStatus && "verificationStatus",
    (versionFields.note ?? null) !== current.note && "note",
  ].filter((f): f is string => f !== false);

  await deps.repo.updateDocument(id, { title, categoryId, confidentiality, notes });
  await deps.repo.updateVersion(current.id, versionFields);
  await deps.repo.setAssets(id, assetIds);
  await deps.audit.record({
    action: "document.update",
    entityType: "document",
    entityId: id,
    diff: { changed, assetsChanged: !sameList(assetIds, before.assetIds) },
  });
  return ok({ id });
}

export async function setDocumentArchived(deps: DocumentDeps, id: string, archived: boolean): Promise<Result<{ id: string }>> {
  if (!(await deps.repo.setArchived(id, archived))) return failGeneral("Documento non trovato");
  await deps.audit.record({ action: archived ? "document.archive" : "document.restore", entityType: "document", entityId: id, diff: {} });
  return ok({ id });
}

export type DocumentListItem = Awaited<ReturnType<ReadDeps["repo"]["list"]>>[number] & { categoryName: string };

export async function listDocuments(deps: ReadDeps, args: ListArgs): Promise<DocumentListItem[]> {
  const [rows, categories] = await Promise.all([deps.repo.list(args), deps.repo.listCategories()]);
  const names = new Map(categories.map((c) => [c.id, c.name]));
  return rows.map((r) => ({ ...r, categoryName: names.get(r.categoryId) ?? "" }));
}

export const countDocuments = (deps: ReadDeps, args: ListArgs): Promise<number> => deps.repo.count(args);

/** Titoli per identificativo (anche di documenti archiviati): per mostrare il nome di un documento collegato. */
export const documentTitles = (deps: ReadDeps, ids?: string[]): Promise<Map<string, string>> => deps.repo.titles(ids);

/** Quanti documenti al massimo compaiono in un menu a tendina: i piu' recenti (l'elenco completo ha la sua pagina con ricerca). */
export const PICKER_LIMIT = 1000;

export async function documentOptions(deps: ReadDeps, limit = PICKER_LIMIT): Promise<{ value: string; label: string }[]> {
  return (await deps.repo.options(limit)).map((d) => ({ value: d.id, label: d.title }));
}

export type DocumentDetailView = Omit<DocumentDetail, "versions" | "assetIds"> & {
  categoryName: string;
  assets: { id: string; name: string }[];
  versions: (VersionView & { issuerName: string | null })[];
  duplicates: DuplicateMatch[];
};

export async function getDocumentDetail(deps: ReadDeps, id: string): Promise<DocumentDetailView | null> {
  const detail = await deps.repo.getDetail(id);
  if (!detail) return null;
  const [categories, assets, parties, duplicates] = await Promise.all([
    deps.repo.listCategories(),
    deps.others.assets(),
    deps.others.parties(),
    deps.repo.findDuplicates(id),
  ]);
  const assetNames = new Map(assets.map((a) => [a.id, a.name]));
  const partyNames = new Map(parties.map((p) => [p.id, p.name]));
  const { assetIds, versions, ...rest } = detail;
  return {
    ...rest,
    categoryName: categories.find((c) => c.id === detail.categoryId)?.name ?? "",
    assets: assetIds.flatMap((a) => (assetNames.has(a) ? [{ id: a, name: assetNames.get(a)! }] : [])),
    versions: versions.map((v) => ({ ...v, issuerName: v.issuerPartyId ? (partyNames.get(v.issuerPartyId) ?? null) : null })),
    duplicates,
  };
}

export type OpenedFile = Pick<StoredFile, "mimeType" | "originalFilename" | "sizeBytes"> & { stream: ReadableStream<Uint8Array> };

/** Apre i byte di una versione per la route autenticata. Null se la versione o il file non esistono. */
export async function openDocumentFile(
  deps: Pick<DocumentDeps, "repo" | "storage">,
  documentId: string,
  versionId: string,
): Promise<OpenedFile | null> {
  const file = await deps.repo.findFile(documentId, versionId);
  if (!file) return null;
  const stream = await deps.storage.get(file.storageKey);
  if (!stream) return null;
  return { stream, mimeType: file.mimeType, originalFilename: file.originalFilename, sizeBytes: file.sizeBytes };
}
