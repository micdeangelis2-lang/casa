/**
 * Porta per i byte dei file. Il dominio non sa dove stanno: oggi il disco locale (sviluppo e test),
 * in produzione un adattatore per Vercel Blob privato o S3-compatibile (D3, da verificare con l'account).
 */
export interface StoragePort {
  put(key: string, bytes: Uint8Array): Promise<void>;
  /** Flusso dei byte, o null se la chiave non esiste. */
  get(key: string): Promise<ReadableStream<Uint8Array> | null>;
  exists(key: string): Promise<boolean>;
  /** Idempotente: cancellare una chiave inesistente non e' un errore. */
  delete(key: string): Promise<void>;
}

/** Chiavi generate dall'app (percorsi relativi, niente `..`): una chiave diversa e' un errore di programmazione. */
export function assertSafeKey(key: string): void {
  if (!/^[a-z0-9][a-z0-9/_.-]{0,200}$/.test(key) || key.includes("..") || key.includes("//")) {
    throw new Error("Chiave di storage non valida");
  }
}
