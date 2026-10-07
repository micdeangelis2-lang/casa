import { createHash } from "node:crypto";
import {
  ARCHIVE_FORMAT,
  ARCHIVE_FORMAT_VERSION,
  filePath,
  manifestPath,
  readmeText,
  tablePath,
  tablesFor,
  type Manifest,
} from "../domain/archive";
import { verifiedStream } from "@/shared/archive/stream";
import { SIGNATURE_PATH, signManifest } from "./signature";
import { zipStream, type ZipEntry } from "@/shared/archive/zip";
import type { ArchiveDeps, SnapshotTable } from "./ports";

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const encoder = new TextEncoder();

type FileRow = { storage_key: string; sha256: string; size_bytes: number };

const fileRows = (tables: SnapshotTable[]): FileRow[] =>
  (tables.find((t) => t.name === "file_object")?.ndjson ?? "")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as FileRow);

/**
 * Prepara un archivio: fotografa il database, costruisce il manifest e restituisce il flusso ZIP.
 * `includeAuth` vale solo per i backup cifrati; l'esportazione completa non contiene credenziali.
 */
export async function createArchive(
  deps: ArchiveDeps,
  options: { includeAuth: boolean; now?: Date; signingSecret?: string | undefined },
): Promise<{ manifest: Manifest; stream: AsyncGenerator<Uint8Array> }> {
  const snapshot = await deps.reader.read(options.includeAuth);
  const wanted = tablesFor(options.includeAuth);
  const tables = wanted.map((name) => snapshot.tables.find((t) => t.name === name) ?? { name, ndjson: "", rows: 0 });

  const present: FileRow[] = [];
  const missing: string[] = [];
  for (const row of fileRows(tables)) {
    if (await deps.storage.exists(row.storage_key)) present.push(row);
    else missing.push(row.storage_key);
  }

  const manifest: Manifest = {
    format: ARCHIVE_FORMAT,
    formatVersion: ARCHIVE_FORMAT_VERSION,
    createdAt: (options.now ?? new Date()).toISOString(),
    includesAuth: options.includeAuth,
    schema: { migrations: snapshot.migrations },
    tables: Object.fromEntries(tables.map((t) => [t.name, { rows: t.rows, sha256: sha256(t.ndjson) }])),
    files: Object.fromEntries(present.map((f) => [f.storage_key, { sizeBytes: f.size_bytes, sha256: f.sha256 }])),
    missingFiles: missing,
    auditHead: snapshot.auditHead,
  };

  async function* entries(): AsyncGenerator<ZipEntry> {
    const manifestBytes = encoder.encode(JSON.stringify(manifest, null, 2));
    yield { name: manifestPath, data: manifestBytes, compress: true };
    // La firma segue subito il manifest: chi ripristina la verifica prima di fidarsi di qualunque altra voce.
    if (options.signingSecret) yield { name: SIGNATURE_PATH, data: encoder.encode(signManifest(manifestBytes, options.signingSecret)), compress: false };
    yield { name: "LEGGIMI.txt", data: encoder.encode(readmeText), compress: true };
    for (const table of tables) yield { name: tablePath(table.name), data: encoder.encode(table.ndjson), compress: true };
    for (const file of present) {
      const stream = await deps.storage.get(file.storage_key);
      if (!stream) throw new Error(`Il file ${file.storage_key} e' sparito dallo storage durante l'archiviazione`);
      yield { name: filePath(file.storage_key), data: verifiedStream(stream, file.storage_key, file.sha256), compress: false };
    }
  }

  return { manifest, stream: zipStream(entries()) };
}
