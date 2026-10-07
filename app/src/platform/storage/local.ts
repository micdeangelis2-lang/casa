import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { assertSafeKey, type StoragePort } from "./port";

/** Adattatore su disco: per sviluppo e test. Scrive su file temporaneo e rinomina, cosi' non restano file a meta'. */
export class LocalFileStorage implements StoragePort {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private pathFor(key: string): string {
    assertSafeKey(key);
    const path = resolve(join(this.root, key));
    if (!path.startsWith(this.root + sep)) throw new Error("Chiave di storage non valida");
    return path;
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.part`;
    await writeFile(tmp, bytes);
    await rename(tmp, path);
  }

  async get(key: string): Promise<ReadableStream<Uint8Array> | null> {
    const path = this.pathFor(key);
    try {
      await stat(path);
    } catch {
      return null;
    }
    return Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>;
  }

  async exists(key: string): Promise<boolean> {
    try {
      return (await stat(this.pathFor(key))).isFile();
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}
