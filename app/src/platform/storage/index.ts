import { LocalFileStorage } from "./local";
import type { StoragePort } from "./port";

export { type StoragePort } from "./port";
export { LocalFileStorage } from "./local";

const globalForStorage = globalThis as unknown as { __storage?: StoragePort };

/** Singleton lazy su globalThis (come db e auth). */
export function getStorage(): StoragePort {
  return (globalForStorage.__storage ??= new LocalFileStorage(process.env.STORAGE_DIR || ".storage"));
}
