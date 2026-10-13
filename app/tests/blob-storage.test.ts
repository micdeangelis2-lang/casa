import { describe, expect, it } from "vitest";
import { BlobStorage, type BlobClient } from "@/platform/storage/blob";

/** Client finto in memoria: prova il comportamento dell'adattatore (chiavi, assenze, idempotenza) senza rete. */
function fakeClient(): BlobClient & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    async put(path, bytes) {
      files.set(path, bytes);
    },
    async get(path) {
      const bytes = files.get(path);
      return bytes ? new Blob([bytes as BlobPart]).stream() : null;
    },
    async exists(path) {
      return files.has(path);
    },
    async del(path) {
      files.delete(path);
    },
  };
}

const read = async (stream: ReadableStream<Uint8Array> | null) => (stream ? new Uint8Array(await new Response(stream).arrayBuffer()) : null);

describe("BlobStorage", () => {
  it("scrive, legge, verifica ed elimina con la chiave dell'app", async () => {
    const client = fakeClient();
    const storage = new BlobStorage(client);
    const bytes = new Uint8Array([1, 2, 3, 250]);
    await storage.put("documents/ab/cd-v1.pdf", bytes);
    expect(await storage.exists("documents/ab/cd-v1.pdf")).toBe(true);
    expect(await read(await storage.get("documents/ab/cd-v1.pdf"))).toEqual(bytes);
    await storage.delete("documents/ab/cd-v1.pdf");
    expect(await storage.exists("documents/ab/cd-v1.pdf")).toBe(false);
  });

  it("una chiave assente da' null e cancellarla non e' un errore", async () => {
    const storage = new BlobStorage(fakeClient());
    expect(await storage.get("documents/none.pdf")).toBeNull();
    await expect(storage.delete("documents/none.pdf")).resolves.toBeUndefined();
  });

  it("rifiuta chiavi non sicure prima di toccare il servizio", async () => {
    const client = fakeClient();
    const storage = new BlobStorage(client);
    for (const key of ["../fuori", "a//b", "https://esempio.test/x", "/assoluta", "A/Maiuscola"]) {
      await expect(storage.put(key, new Uint8Array([1])), key).rejects.toThrow("Chiave di storage non valida");
      await expect(storage.get(key), key).rejects.toThrow();
      await expect(storage.exists(key), key).rejects.toThrow();
      await expect(storage.delete(key), key).rejects.toThrow();
    }
    expect(client.files.size).toBe(0);
  });
});
