import { createHash } from "node:crypto";
import { verifiedStream } from "@/shared/archive/stream";
import { zipStream, type ZipEntry } from "@/shared/archive/zip";
import { fail, failGeneral, ok, zodIssuesToErrors, type FieldErrors, type Result } from "@/shared/result";
import { renderSheetHtml, SHEET_PATH, type SheetKind } from "../domain/sheet";
import { buildCsv, buildIndexHtml, buildManifest, exceedsCap, packageInputSchema, safeFileName, type ConfidentialityLevel, type IndexLabels, type ManifestInput, type PackageItemInfo } from "../domain/sharing";
import type { CandidateDocument, DocumentForPackage, LogRow, PackageItemRow, PackageRow, SharingDeps, SharingReadDeps } from "./ports";

export type Candidate = CandidateDocument & { exceedsCap: boolean };

/** Documenti che si possono mettere in un pacchetto, con l'avviso su quelli piu' riservati del livello scelto. */
export async function candidates(deps: SharingReadDeps, filter: { assetIds?: string[]; categoryIds?: string[] }, cap: ConfidentialityLevel): Promise<Candidate[]> {
  const list = await deps.others.candidates(filter);
  return list.map((d) => ({ ...d, exceedsCap: exceedsCap(d.confidentiality, cap) }));
}

const pad = (n: number) => String(n).padStart(3, "0");

function toInfo(doc: DocumentForPackage, position: number, override: boolean): PackageItemInfo {
  return {
    path: `files/${pad(position + 1)}-${safeFileName(doc.filename)}`,
    title: doc.title,
    categoryName: doc.categoryName,
    confidentiality: doc.confidentiality,
    issuerName: doc.issuerName,
    issuedOn: doc.issuedOn,
    validFrom: doc.validFrom,
    validTo: doc.validTo,
    verificationStatus: doc.verificationStatus,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
    sha256: doc.sha256,
    overrideAboveCap: override,
    assetNames: doc.assetNames,
  };
}

/**
 * Crea un pacchetto: registra destinatario, contenuto (con le impronte), tetto di riservatezza e quali documenti
 * superavano il tetto e sono stati inclusi comunque. Il file ZIP non si salva: si genera quando lo si scarica.
 */
export type SheetInput = { kind: SheetKind; title: string; csv: string };

export async function createPackage(deps: SharingDeps, raw: unknown, now: Date, sheetInput?: SheetInput | null): Promise<Result<{ id: string }>> {
  const parsed = packageInputSchema.safeParse(raw);
  if (!parsed.success) return fail(zodIssuesToErrors(parsed.error));
  const input = parsed.data;

  const ids = [...new Set(input.documents.map((d) => d.documentId))];
  const found = new Map((await deps.others.documents(ids)).map((d) => [d.id, d]));
  const errors: FieldErrors = {};
  const problems: string[] = [];
  const chosen: { doc: DocumentForPackage; override: boolean }[] = [];
  for (const selection of input.documents) {
    const doc = found.get(selection.documentId);
    if (!doc) problems.push("Un documento scelto non esiste più");
    else if (doc.archived) problems.push(`«${doc.title}» è archiviato`);
    else if (exceedsCap(doc.confidentiality, input.confidentialityCap) && !selection.overrideAboveCap) {
      problems.push(`«${doc.title}» supera il livello di riservatezza scelto: toglilo oppure includilo comunque dopo aver letto l'avviso`);
    } else if (!chosen.some((c) => c.doc.id === doc.id)) chosen.push({ doc, override: exceedsCap(doc.confidentiality, input.confidentialityCap) });
  }
  if (input.documents.length === 0 && !sheetInput) problems.push("Scegli almeno un documento");
  if (problems.length > 0) errors.documents = [...new Set(problems)];
  if (Object.keys(errors).length > 0) return fail(errors);

  const items = chosen.map(({ doc, override }, i) => toInfo(doc, i, override));
  const manifestInput: ManifestInput = {
    createdAt: now.toISOString(),
    recipientType: input.recipientType,
    recipientName: input.recipientName,
    confidentialityCap: input.confidentialityCap,
    note: input.note ?? null,
    items,
    sheet: sheetInput ? { ...sheetInput, sha256: createHash("sha256").update(sheetInput.csv).digest("hex") } : null,
  };
  const id = await deps.repo.insertPackage({
    recipientType: input.recipientType,
    recipientName: input.recipientName,
    confidentialityCap: input.confidentialityCap,
    note: input.note ?? null,
    fileCount: items.length,
    totalBytes: items.reduce((n, i) => n + i.sizeBytes, 0),
    snapshot: manifestInput,
    manifestSha256: createHash("sha256").update(buildManifest(manifestInput)).digest("hex"),
  });
  await deps.repo.insertItems(
    id,
    chosen.map(({ doc, override }, i) => ({ documentId: doc.id, versionId: doc.currentVersionId, position: i, path: items[i]!.path, sha256: doc.sha256, sizeBytes: doc.sizeBytes, confidentiality: doc.confidentiality, overrideAboveCap: override })),
  );
  await deps.repo.log(id, "created");
  await deps.audit.record({
    action: "share.create",
    entityType: "share_package",
    entityId: id,
    diff: { recipientType: input.recipientType, files: items.length, cap: input.confidentialityCap, aboveCap: items.filter((i) => i.overrideAboveCap).length, ...(sheetInput ? { sheet: sheetInput.kind } : {}) },
  });
  return ok({ id });
}

export async function revokePackage(deps: SharingDeps, id: string): Promise<Result<{ id: string }>> {
  if (!(await deps.repo.revoke(id))) return failGeneral("Pacchetto non trovato");
  await deps.repo.log(id, "revoked");
  await deps.audit.record({ action: "share.revoke", entityType: "share_package", entityId: id, diff: {} });
  return ok({ id });
}

export type PackageDownload = { package: PackageRow; items: PackageItemRow[]; filename: string };

/** Prepara lo scarico (dentro una transazione): controlla che non sia revocato e lo registra. Il flusso si genera dopo. */
export async function preparePackageDownload(deps: SharingDeps, id: string): Promise<Result<PackageDownload>> {
  const pkg = await deps.repo.getPackage(id);
  if (!pkg) return failGeneral("Pacchetto non trovato");
  if (pkg.revoked) return failGeneral("Il pacchetto è stato revocato");
  const items = await deps.repo.items(id);
  await deps.repo.log(id, "downloaded");
  await deps.audit.record({ action: "share.download", entityType: "share_package", entityId: id, diff: { files: items.length } });
  const day = pkg.createdAt.toISOString().slice(0, 10);
  return ok({ package: pkg, items, filename: `pacchetto-${day}-${safeFileName(pkg.recipientName).toLowerCase()}.zip` });
}

/**
 * Genera il file ZIP a pezzi, direttamente verso chi scarica (nessuna copia in giro). Rilegge i file e controlla le impronte
 * registrate alla creazione: se un file e' cambiato lo scarico fallisce invece di consegnare altro.
 */
export async function packageStream(deps: SharingReadDeps, download: PackageDownload, labels: IndexLabels): Promise<AsyncGenerator<Uint8Array>> {
  // Indice, manifest ed elenco si generano dall'istantanea registrata alla creazione: sono esattamente cio' che e' stato condiviso.
  const snapshot = download.package.snapshot;
  const encoder = new TextEncoder();

  async function* entries(): AsyncGenerator<ZipEntry> {
    yield { name: "INDEX.html", data: encoder.encode(buildIndexHtml(snapshot, labels)), compress: true };
    yield { name: "manifest.json", data: encoder.encode(buildManifest(snapshot)), compress: true };
    yield { name: "elenco.csv", data: encoder.encode(buildCsv(snapshot.items, snapshot.sheet)), compress: true };
    // La scheda si genera dall'istantanea registrata alla creazione, come l'indice: e' cio' che il proprietario ha deciso di condividere.
    if (snapshot.sheet) {
      yield { name: SHEET_PATH, data: encoder.encode(renderSheetHtml(snapshot.sheet, { createdAt: snapshot.createdAt, recipientName: snapshot.recipientName, recipientLabel: labels.recipient[snapshot.recipientType], capLabel: labels.confidentiality[snapshot.confidentialityCap] })), compress: true };
    }
    for (const item of download.items) {
      const stream = await deps.others.openFile(item.documentId, item.versionId);
      if (!stream) throw new Error(`Il file ${item.path} non è più nello storage`);
      yield { name: item.path, data: verifiedStream(stream, item.path, item.sha256), compress: false };
    }
  }
  return zipStream(entries());
}

export type PackageListItem = PackageRow & { downloads: number };
export const listPackages = (deps: SharingReadDeps): Promise<PackageListItem[]> => deps.repo.listPackages();

export type PackageDetail = { package: PackageRow; items: (PackageItemRow & { title: string })[]; log: LogRow[] };

export async function getPackageDetail(deps: SharingReadDeps, id: string): Promise<PackageDetail | null> {
  const pkg = await deps.repo.getPackage(id);
  if (!pkg) return null;
  const [items, log] = await Promise.all([deps.repo.items(id), deps.repo.logs(id)]);
  const docs = new Map((await deps.others.documents(items.map((i) => i.documentId))).map((d) => [d.id, d.title]));
  return { package: pkg, items: items.map((i) => ({ ...i, title: docs.get(i.documentId) ?? "(documento non più disponibile)" })), log };
}

/** Storia delle condivisioni di un documento: in quali pacchetti e' stato incluso, quando e per chi. */
export const documentSharingHistory = (deps: SharingReadDeps, documentId: string) => deps.repo.packagesForDocument(documentId);

