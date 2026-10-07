import { createHash } from "node:crypto";
import { once } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import type { BackupDestination } from "../application/ports";

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

/**
 * Destinazione su disco. Serve per sviluppo e per una copia locale; per essere un vero secondo fornitore
 * la cartella deve stare su un altro disco o un servizio sincronizzato (o servira' un altro adattatore).
 */
export class LocalBackupDestination implements BackupDestination {
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }

  private pathFor(key: string): string {
    if (!SAFE_KEY.test(key) || key.includes("..")) throw new Error("Chiave di backup non valida");
    return join(this.root, key);
  }

  async put(key: string, source: AsyncIterable<Uint8Array>) {
    const path = this.pathFor(key);
    await mkdir(this.root, { recursive: true });
    const tmp = `${path}.part`;
    const hash = createHash("sha256");
    let sizeBytes = 0;
    const out = createWriteStream(tmp);
    // Un errore di scrittura arriva come evento, anche quando nessuno lo sta aspettando: lo si ricorda e lo si rilancia.
    let writeError: Error | null = null;
    out.on("error", (error) => {
      writeError = error;
    });
    try {
      for await (const chunk of source) {
        if (writeError) throw writeError;
        hash.update(chunk);
        sizeBytes += chunk.length;
        if (!out.write(chunk)) await once(out, "drain");
      }
      await new Promise<void>((done) => out.end(done));
      if (writeError) throw writeError;
    } catch (error) {
      out.destroy();
      await rm(tmp, { force: true });
      throw error;
    }
    await rename(tmp, path);
    return { sizeBytes, sha256: hash.digest("hex") };
  }

  async get(key: string) {
    const path = this.pathFor(key);
    try {
      await stat(path);
    } catch {
      return null;
    }
    return Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>;
  }

  async list() {
    const names = await readdir(this.root).catch(() => [] as string[]);
    return names.filter((n) => SAFE_KEY.test(n) && !n.endsWith(".part")).sort();
  }

  async delete(key: string) {
    await rm(this.pathFor(key), { force: true });
  }
}
