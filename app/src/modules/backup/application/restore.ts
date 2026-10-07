import { createHash } from "node:crypto";
import type { StoragePort } from "@/platform/storage";
import { unzipStream, type ZipLimits } from "@/shared/archive/zip";
import { ARCHIVE_FORMAT_VERSION, manifestPath, manifestSchema, tablesFor, type Manifest } from "../domain/archive";
import { SIGNATURE_PATH, verifyManifestSignature } from "./signature";
import type { RestoreTarget, SnapshotTable } from "./ports";

export type RestoreReport = {
  manifest: Manifest;
  tables: Record<string, number>;
  files: number;
  /** Vero se si e' solo verificato l'archivio, senza scrivere nulla. */
  dryRun: boolean;
  /**
   * `valid`: firma del manifest verificata col segreto. `unsigned`: archivio senza firma, accettato perche' il segreto manca o
   * perche' si e' chiesto di ammetterlo. `unchecked`: l'archivio e' firmato ma non c'e' il segreto per verificarlo.
   */
  signature: "valid" | "unsigned" | "unchecked";
};

export type RestoreOptions = {
  dryRun?: boolean;
  /** BACKUP_SIGNING_SECRET: se presente la firma e' obbligatoria e viene verificata. */
  signingSecret?: string | undefined;
  /** Ammette un archivio senza firma (backup vecchi) anche se il segreto e' impostato. Una firma ERRATA si rifiuta sempre. */
  allowUnsigned?: boolean;
  limits?: Partial<ZipLimits>;
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
  options: RestoreOptions = {},
): Promise<RestoreReport> {
  const dryRun = options.dryRun === true;
  let manifest: Manifest | null = null;
  let manifestBytes: Uint8Array | null = null;
  let signature: RestoreReport["signature"] | null = null;
  const tables = new Map<string, SnapshotTable>();
  const filesSeen = new Set<string>();
  const written: string[] = [];

  try {
    // Archivio senza firma: ammesso solo se non c'e' il segreto o se l'utente lo ha chiesto in modo esplicito.
    const settleUnsigned = (): RestoreReport["signature"] => {
      if (options.signingSecret && options.allowUnsigned !== true) {
        throw new Error(
          "L'archivio non e' firmato ma BACKUP_SIGNING_SECRET e' impostato: potrebbe non essere un tuo backup. Se e' un backup vecchio, ripeti con --allow-unsigned",
        );
      }
      return "unsigned";
    };

    for await (const entry of unzipStream(source, options.limits)) {
      if (entry.name === manifestPath) {
        if (manifest) throw new Error("L'archivio contiene due manifest");
        manifestBytes = entry.data;
        const parsed = manifestSchema.safeParse(JSON.parse(decoder.decode(entry.data)));
        if (!parsed.success) throw new Error("Il manifest dell'archivio non e' valido");
        manifest = parsed.data;
        if (manifest.formatVersion > ARCHIVE_FORMAT_VERSION) throw new Error("L'archivio e' di una versione piu' recente dell'applicazione");
        if (!dryRun) await checkTarget(deps.target, manifest);
        continue;
      }
      if (!manifest || !manifestBytes) throw new Error("Il manifest deve essere la prima voce dell'archivio");

      if (entry.name === SIGNATURE_PATH) {
        if (signature) throw new Error("L'archivio contiene due firme");
        if (!options.signingSecret) signature = "unchecked";
        else if (verifyManifestSignature(manifestBytes, entry.data, options.signingSecret)) signature = "valid";
        else throw new Error("La firma dell'archivio non e' valida: il backup e' stato manomesso o e' firmato con un altro segreto");
        continue;
      }
      // La firma deve precedere ogni altra voce: alla prima voce di dati senza firma l'archivio e' "non firmato".
      signature ??= settleUnsigned();

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
    signature ??= settleUnsigned();
    for (const name of Object.keys(manifest.tables)) if (!tables.has(name)) throw new Error(`Manca la tabella ${name}`);
    for (const key of Object.keys(manifest.files)) if (!filesSeen.has(key)) throw new Error(`Manca il file ${key}`);

    const ordered = tablesFor(manifest.includesAuth).map((name) => tables.get(name)!);
    if (!dryRun) await deps.target.restore(ordered, manifest.auditHead);

    return {
      manifest,
      tables: Object.fromEntries(ordered.map((t) => [t.name, t.rows])),
      files: filesSeen.size,
      dryRun,
      signature,
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
