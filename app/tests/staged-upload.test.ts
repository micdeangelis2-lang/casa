import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalFileStorage } from "@/platform/storage";
import { discardStagedFile, isStagingKey, readStagedFile } from "@/lib/staged-upload";

const KEY = "staging/0b9d4f2e-3c1a-4e7b-9a55-6f1c2d3e4a5b";

describe("caricamento diretto: chiave e lettura da staging", () => {
  let root: string;
  let storage: LocalFileStorage;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "staged-"));
    storage = new LocalFileStorage(root);
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("accetta solo staging/<uuid> minuscolo, senza nome ne' estensione", () => {
    expect(isStagingKey(KEY)).toBe(true);
    for (const bad of [
      "",
      "staging/",
      "staging/not-a-uuid",
      `${KEY}.pdf`,
      `${KEY}/x`,
      `/${KEY}`,
      `documents/${KEY.slice(8)}`,
      "staging/../documents/0b9d4f2e-3c1a-4e7b-9a55-6f1c2d3e4a5b",
      KEY.toUpperCase(),
      `${KEY}\n`,
    ]) {
      expect(isStagingKey(bad), bad).toBe(false);
    }
  });

  it("legge i byte e il nome originale (ripulito)", async () => {
    await storage.put(KEY, new Uint8Array([1, 2, 3]));
    const read = await readStagedFile(KEY, "  ../Contratto\u0001.pdf ", storage);
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(Array.from(read.file.bytes)).toEqual([1, 2, 3]);
      expect(read.file.name).toBe(".._Contratto_.pdf");
    }
  });

  it("usa un nome di ripiego se il nome e' vuoto", async () => {
    const read = await readStagedFile(KEY, "   ", storage);
    expect(read.ok && read.file.name).toBe("documento");
  });

  it("rifiuta una chiave non valida senza toccare lo storage", async () => {
    const read = await readStagedFile("documents/x", "a.pdf", storage);
    expect(read).toEqual({ ok: false, error: expect.stringContaining("non è valido") });
  });

  it("segnala la chiave assente", async () => {
    const read = await readStagedFile("staging/11111111-2222-4333-8444-555555555555", "a.pdf", storage);
    expect(read).toEqual({ ok: false, error: expect.stringContaining("non è stato trovato") });
  });

  it("rifiuta un file oltre il tetto in lettura", async () => {
    await storage.put(KEY, new Uint8Array(11));
    const read = await readStagedFile(KEY, "a.pdf", storage, 10);
    expect(read.ok).toBe(false);
    expect((await readStagedFile(KEY, "a.pdf", storage, 11)).ok).toBe(true);
  });

  it("rifiuta un file vuoto", async () => {
    await storage.put(KEY, new Uint8Array(0));
    expect(await readStagedFile(KEY, "a.pdf", storage)).toEqual({ ok: false, error: "Il file è vuoto" });
  });

  it("discardStagedFile cancella, e' idempotente e ignora le chiavi non di staging", async () => {
    await storage.put(KEY, new Uint8Array([9]));
    await storage.put("documents/keep.bin", new Uint8Array([9]));
    await discardStagedFile(KEY, storage);
    await discardStagedFile(KEY, storage);
    await discardStagedFile("documents/keep.bin", storage);
    expect(await storage.exists(KEY)).toBe(false);
    expect(await storage.exists("documents/keep.bin")).toBe(true);
  });
});
