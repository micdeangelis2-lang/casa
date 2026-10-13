import { BlobNotFoundError, del, get, head, put } from "@vercel/blob";
import { assertSafeKey, type StoragePort } from "./port";

/** Le sole operazioni di Vercel Blob che servono all'adattatore (iniettabili nei test, senza rete). */
export type BlobClient = {
  put(pathname: string, bytes: Uint8Array): Promise<void>;
  get(pathname: string): Promise<ReadableStream<Uint8Array> | null>;
  exists(pathname: string): Promise<boolean>;
  del(pathname: string): Promise<void>;
};

/** Client reale: store PRIVATO (nessun URL pubblico), nome del file esatto, sovrascrittura ammessa (stessa chiave = stessi byte). */
export function vercelBlobClient(token?: string): BlobClient {
  const auth = token ? { token } : {};
  return {
    async put(pathname, bytes) {
      await put(pathname, Buffer.from(bytes), { access: "private", addRandomSuffix: false, allowOverwrite: true, ...auth });
    },
    async get(pathname) {
      // Sempre dall'origine: una lettura fatta prima della scrittura (chiave assente) non deve restare in cache.
      const result = await get(pathname, { access: "private", useCache: false, ...auth });
      return result && result.statusCode === 200 ? result.stream : null;
    },
    async exists(pathname) {
      try {
        await head(pathname, auth);
        return true;
      } catch (error) {
        if (error instanceof BlobNotFoundError) return false;
        throw error;
      }
    },
    async del(pathname) {
      await del(pathname, auth);
    },
  };
}

/**
 * Adattatore su Vercel Blob privato: i byte dei documenti stanno fuori dal disco della funzione (che su Vercel non persiste).
 * Le chiavi sono quelle dell'app (percorsi relativi sicuri), mai URL: il file si legge solo passando dall'app e dalla sessione.
 */
export class BlobStorage implements StoragePort {
  constructor(private readonly client: BlobClient) {}

  async put(key: string, bytes: Uint8Array): Promise<void> {
    assertSafeKey(key);
    await this.client.put(key, bytes);
  }

  async get(key: string): Promise<ReadableStream<Uint8Array> | null> {
    assertSafeKey(key);
    return this.client.get(key);
  }

  async exists(key: string): Promise<boolean> {
    assertSafeKey(key);
    return this.client.exists(key);
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.del(key);
  }
}
