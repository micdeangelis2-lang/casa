import { Unzip, UnzipInflate, Zip, ZipDeflate, ZipPassThrough } from "fflate";

export type ZipEntry = {
  name: string;
  /** Dati in memoria o a pezzi (i file grandi non si caricano interi). */
  data: Uint8Array | AsyncIterable<Uint8Array>;
  /** Testo e JSON si comprimono; PDF e immagini sono gia' compressi e si archiviano cosi' come sono. */
  compress: boolean;
};

/** Crea un file ZIP a pezzi, man mano che le voci arrivano: la memoria usata non dipende dalla dimensione totale. */
export async function* zipStream(entries: AsyncIterable<ZipEntry>): AsyncGenerator<Uint8Array> {
  const queue: Uint8Array[] = [];
  let failure: Error | null = null;
  const zip = new Zip((error, chunk) => {
    if (error) failure = error;
    else queue.push(chunk);
  });
  const drain = function* () {
    if (failure) throw failure;
    while (queue.length > 0) yield queue.shift()!;
  };

  for await (const entry of entries) {
    const file = entry.compress ? new ZipDeflate(entry.name, { level: 6 }) : new ZipPassThrough(entry.name);
    file.mtime = new Date();
    zip.add(file);
    if (entry.data instanceof Uint8Array) {
      file.push(entry.data, true);
      yield* drain();
    } else {
      for await (const part of entry.data) {
        file.push(part, false);
        yield* drain();
      }
      file.push(new Uint8Array(0), true);
      yield* drain();
    }
  }
  zip.end();
  yield* drain();
}

export type UnzippedEntry = { name: string; data: Uint8Array };

/** Tetti di lettura (F-10): proteggono dalle "bombe" di compressione. Tutti i valori sono in byte (il rapporto e' un numero). */
export type ZipLimits = {
  /** Dimensione massima di una voce decompressa. */
  maxEntryBytes: number;
  /** Dimensione massima di tutte le voci insieme. */
  maxTotalBytes: number;
  /** Rapporto massimo tra byte decompressi e byte letti dall'archivio; si controlla solo oltre `ratioFloorBytes`. */
  maxExpansionRatio: number;
  /** Sotto questa quantita' di byte decompressi il rapporto non conta (i testi ripetitivi comprimono molto, ed e' innocuo). */
  ratioFloorBytes: number;
};

const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntryBytes: 1024 ** 3,
  maxTotalBytes: 8 * 1024 ** 3,
  maxExpansionRatio: 1000,
  ratioFloorBytes: 64 * 1024 ** 2,
};

/**
 * Legge un file ZIP a pezzi. Ogni voce completa viene restituita non appena e' pronta, nell'ordine in cui
 * sta nell'archivio. Le voci con nome sospetto (percorsi assoluti o con `..`) sono rifiutate.
 */
export async function* unzipStream(source: AsyncIterable<Uint8Array>, overrides: Partial<ZipLimits> = {}): AsyncGenerator<UnzippedEntry> {
  const limits = { ...DEFAULT_ZIP_LIMITS, ...overrides };
  let inputBytes = 0;
  let outputBytes = 0;
  const ready: UnzippedEntry[] = [];
  let failure: Error | null = null;
  const unzip = new Unzip((file) => {
    if (file.name.endsWith("/")) return;
    if (file.name.startsWith("/") || file.name.split("/").includes("..") || file.name.includes("\\")) {
      failure = new Error("L'archivio contiene un percorso non valido");
      return;
    }
    const parts: Uint8Array[] = [];
    let entryBytes = 0;
    file.ondata = (error, chunk, final) => {
      if (error) {
        failure = error;
        return;
      }
      if (failure) return;
      entryBytes += chunk.length;
      outputBytes += chunk.length;
      const tooBig = entryBytes > limits.maxEntryBytes || outputBytes > limits.maxTotalBytes;
      const bomb = outputBytes > limits.ratioFloorBytes && outputBytes > Math.max(inputBytes, 1) * limits.maxExpansionRatio;
      if (tooBig || bomb) {
        failure = new Error(
          tooBig ? "L'archivio supera la dimensione massima consentita una volta decompresso" : "L'archivio si espande in modo anomalo (rapporto di compressione troppo alto): possibile bomba di compressione",
        );
        file.terminate();
        parts.length = 0;
        return;
      }
      parts.push(chunk);
      if (final) ready.push({ name: file.name, data: concat(parts) });
    };
    file.start();
  });
  unzip.register(UnzipInflate);

  const flush = function* () {
    if (failure) throw failure;
    while (ready.length > 0) yield ready.shift()!;
  };
  for await (const chunk of source) {
    inputBytes += chunk.length;
    unzip.push(chunk);
    yield* flush();
  }
  unzip.push(new Uint8Array(0), true);
  yield* flush();
}

export function concat(parts: Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0]!;
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
