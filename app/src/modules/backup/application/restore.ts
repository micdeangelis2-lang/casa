import { createHash } from "node:crypto";
import type { StoragePort } from "@/platform/storage";
import { unzipStream } from "@/shared/archive/zip";
import { ARCHIVE_FORMAT_VERSION, manifestPath, manifestSchema, tablesFor, type Manifest } from "../domain/archive";
import type { RestoreTarget, SnapshotTable } from "./ports";

export type RestoreReport = {
  manifest: Manifest;
  tables: Record<string, number>;
  files: number;
  /** Vero se si e' solo verificato l'archivio, senza scrivere nulla. */
  dryRun: boolean;
};

const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
const decoder = new TextDecoder("utf-8", { fatal: true });

/**
 * Ripristina un archivio (gia' decifrato) in un ambiente VUOTO: database con lo stesso schema e storage.
 * Verifica tutto prima di fidarsi: formato, schema, impronte di ogni tabella e di ogni file, catena dell'audit.
 * Con `dryRun` fa solo le verifiche (utile per controllare un backup senza toccare nulla).
 */
export async function restoreArchive(
  deps: { target: RestoreTarget; storage: StoragePort },
  source: AsyncIterable<Uint8Array>,
  options: { dryRun?: boolean } = {},
): Promise<RestoreReport> {
  const dryRun = options.dryRun === true;
  let manifest: Manifest | null = null;
  const tables = new Map<string, SnapshotTable>();
  const filesSeen = new Set<string>();
  const written: string[] = [];

  try {
    for await (const entry of unzipStream(source)) {
      if (entry.name === manifestPath) {
        const parsed = manifestSchema.safeParse(JSON.parse(decoder.decode(entry.data)));
        if (!parsed.success) throw new Error("Il manifest dell'archivio non e' valido");
        manifest = parsed.data;
        if (manifest.formatVersion > ARCHIVE_FORMAT_VERSION) throw new Error("L'archivio e' di una versione piu' recente dell'applicazione");
        if (!dryRun) await checkTarget(deps.target, manifest);
        continue;
      }
      if (!manifest) throw new Error("Il manifest deve essere la prima voce dell'archivio");

      const table = /^data\/([a-z_]+)\.ndjson$/.exec(entry.name)?.[1];
      if (table) {
        const expected = manifest.tables[table];
        if (!expected) throw new Error(`La tabella ${table} non e' nel manifest`);
        const text = decoder.decode(entry.data);
        if (sha256(text) !== expected.sha256) throw new Error(`La tabella ${table} non corrisponde alla sua impronta`);
        const rows = text === "" ? 0 : text.split("\n").filter(Boolean).length;
        if (rows !== expected.rows) throw new Error(`La tabella ${table} ha ${rows} righe invece di ${expected.rows}`);
        tables.set(table, { name: table, ndjson: text, rows });
        continue;
      }

      if (entry.name.startsWith("files/")) {
        const key = entry.name.slice("files/".length);
        const expected = manifest.files[key];
        if (!expected) throw new Error(`Il file ${key} non e' nel manifest`);
        if (entry.data.length !== expected.sizeBytes || sha256(entry.data) !== expected.sha256) {
          throw new Error(`Il file ${key} non corrisponde alla sua impronta`);
        }
        filesSeen.add(key);
        if (!dryRun) {
          await deps.storage.put(key, entry.data);
          written.push(key);
        }
      }
    }

    if (!manifest) throw new Error("L'archivio non contiene il manifest");
    for (const name of Object.keys(manifest.tables)) if (!tables.has(name)) throw new Error(`Manca la tabella ${name}`);
    for (const key of Object.keys(manifest.files)) if (!filesSeen.has(key)) throw new Error(`Manca il file ${key}`);

    const ordered = tablesFor(manifest.includesAuth).map((name) => tables.get(name)!);
    if (!dryRun) await deps.target.restore(ordered, manifest.auditHead);

    return {
      manifest,
      tables: Object.fromEntries(ordered.map((t) => [t.name, t.rows])),
      files: filesSeen.size,
      dryRun,
    };
  } catch (error) {
    // Il database e' tornato indietro da solo (transazione): si tolgono anche i file gia' scritti.
    await Promise.all(written.map((key) => deps.storage.delete(key).catch(() => undefined)));
    throw error;
  }
}

async function checkTarget(target: RestoreTarget, manifest: Manifest): Promise<void> {
  const current = await target.migrations();
  if (JSON.stringify(current) !== JSON.stringify(manifest.schema.migrations)) {
    throw new Error("Lo schema del database non corrisponde a quello dell'archivio: applica le stesse migrazioni (pnpm db:migrate) prima di ripristinare");
  }
  const busy = await target.nonEmptyTables(tablesFor(manifest.includesAuth));
  if (busy.length > 0) throw new Error(`Il database non e' vuoto (${busy.join(", ")}): il ripristino funziona solo su un ambiente nuovo`);
}
