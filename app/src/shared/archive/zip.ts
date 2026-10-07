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

/**
 * Legge un file ZIP a pezzi. Ogni voce completa viene restituita non appena e' pronta, nell'ordine in cui
 * sta nell'archivio. Le voci con nome sospetto (percorsi assoluti o con `..`) sono rifiutate.
 */
export async function* unzipStream(source: AsyncIterable<Uint8Array>): AsyncGenerator<UnzippedEntry> {
  const ready: UnzippedEntry[] = [];
  let failure: Error | null = null;
  const unzip = new Unzip((file) => {
    if (file.name.endsWith("/")) return;
    if (file.name.startsWith("/") || file.name.split("/").includes("..") || file.name.includes("\\")) {
      failure = new Error("L'archivio contiene un percorso non valido");
      return;
    }
    const parts: Uint8Array[] = [];
    file.ondata = (error, chunk, final) => {
      if (error) {
        failure = error;
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
