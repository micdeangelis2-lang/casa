import { BlobStorage, vercelBlobClient } from "./blob";
import { LocalFileStorage } from "./local";
import type { StoragePort } from "./port";

export { type StoragePort } from "./port";
export { LocalFileStorage } from "./local";

const globalForStorage = globalThis as unknown as { __storage?: StoragePort };

/**
 * Singleton lazy su globalThis (come db e auth). Con `BLOB_READ_WRITE_TOKEN` (store Vercel Blob collegato al progetto) i file
 * vanno su Blob privato; altrimenti sul disco locale (`STORAGE_DIR`): sviluppo e test.
 */
export function getStorage(): StoragePort {
  return (globalForStorage.__storage ??= process.env.BLOB_READ_WRITE_TOKEN
    ? new BlobStorage(vercelBlobClient(process.env.BLOB_READ_WRITE_TOKEN))
    : new LocalFileStorage(process.env.STORAGE_DIR || ".storage"));
}
