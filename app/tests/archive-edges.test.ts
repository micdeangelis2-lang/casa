import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decryptStream, encryptStream, generateBackupKeyPair } from "@/shared/archive/crypto";
import { fromWebStream, toWebStream, verifiedStream } from "@/shared/archive/stream";
import { concat, unzipStream, zipStream, type UnzippedEntry, type ZipEntry } from "@/shared/archive/zip";
import { LocalFileStorage } from "@/platform/storage";
import { assertSafeKey } from "@/platform/storage/port";

const text = (s: string) => new TextEncoder().encode(s);
async function* from<T>(items: T[]): AsyncGenerator<T> {
  for (const i of items) yield i;
}
async function collect(source: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const p of source) parts.push(p);
  return parts.length === 0 ? new Uint8Array(0) : concat(parts);
}
const zipOf = (entries: ZipEntry[]) => collect(zipStream(from(entries)));
async function unzipAll(bytes: Uint8Array, limits = {}): Promise<UnzippedEntry[]> {
  const out: UnzippedEntry[] = [];
  for await (const e of unzipStream(from([bytes]), limits)) out.push(e);
  return out;
}

describe("zip: casi limite", () => {
  it("archivio senza voci e voce vuota si rileggono", async () => {
    expect(await unzipAll(await zipOf([]))).toEqual([]);
    const [entry] = await unzipAll(await zipOf([{ name: "vuoto.txt", data: new Uint8Array(0), compress: true }]));
    expect(entry!.name).toBe("vuoto.txt");
    expect(entry!.data.length).toBe(0);
  });

  it("voci a pezzi (flusso) e in memoria, compresse e no, tornano identiche e nello stesso ordine", async () => {
    const big = new Uint8Array(300_000).map((_, i) => (i * 7) % 251);
    const bytes = await zipOf([
      { name: "a/b.txt", data: text("ciao"), compress: true },
      { name: "pezzi.bin", data: from([big.subarray(0, 100_000), big.subarray(100_000)]), compress: false },
      { name: "pezzi-compressi.bin", data: from([text("uno "), text("due "), text("tre")]), compress: true },
    ]);
    const out = await unzipAll(bytes);
    expect(out.map((e) => e.name)).toEqual(["a/b.txt", "pezzi.bin", "pezzi-compressi.bin"]);
    expect(new TextDecoder().decode(out[0]!.data)).toBe("ciao");
    expect(createHash("sha256").update(out[1]!.data).digest("hex")).toBe(createHash("sha256").update(big).digest("hex"));
    expect(new TextDecoder().decode(out[2]!.data)).toBe("uno due tre");
  });

  it("percorsi ostili (assoluto, .., barra rovesciata) sono rifiutati; le cartelle vuote si ignorano", async () => {
    for (const name of ["/etc/passwd", "../fuori.txt", "a/../../fuori.txt", "a\\b.txt"]) {
      await expect(unzipAll(await zipOf([{ name, data: text("x"), compress: false }])), name).rejects.toThrow("percorso non valido");
    }
    expect(await unzipAll(await zipOf([{ name: "cartella/", data: new Uint8Array(0), compress: false }]))).toEqual([]);
  });

  it("tetti di lettura: voce troppo grande, totale troppo grande, rapporto di compressione anomalo", async () => {
    const zeros = await zipOf([{ name: "z.bin", data: new Uint8Array(200_000), compress: true }]);
    await expect(unzipAll(zeros, { maxEntryBytes: 1000 })).rejects.toThrow("dimensione massima");
    await expect(unzipAll(zeros, { maxTotalBytes: 1000 })).rejects.toThrow("dimensione massima");
    await expect(unzipAll(zeros, { ratioFloorBytes: 1000, maxExpansionRatio: 10 })).rejects.toThrow("bomba di compressione");
    expect((await unzipAll(zeros, { ratioFloorBytes: 10_000_000 }))[0]!.data.length).toBe(200_000);
  });

  it("un archivio spazzatura o vuoto non produce voci e non resta appeso", async () => {
    const out: UnzippedEntry[] = [];
    await unzipStream(from([text("questo non e' uno zip")])).next().catch(() => undefined);
    for await (const e of unzipStream(from([]))) out.push(e);
    expect(out).toEqual([]);
  });

  it("concat: un solo pezzo e' restituito cosi' com'e', piu' pezzi in ordine", () => {
    const one = text("x");
    expect(concat([one])).toBe(one);
    expect(new TextDecoder().decode(concat([text("a"), text("bc"), new Uint8Array(0), text("d")]))).toBe("abcd");
  });
});

describe("flussi: casi limite", () => {
  it("toWebStream/fromWebStream: giro completo, errore del generatore propagato, chiusura anticipata ferma il generatore", async () => {
    expect(new TextDecoder().decode(await collect(fromWebStream(toWebStream(from([text("a"), text("b")]))))) ).toBe("ab");

    async function* failing(): AsyncGenerator<Uint8Array> {
      yield text("ok");
      throw new Error("sorgente rotta");
    }
    await expect(collect(fromWebStream(toWebStream(failing())))).rejects.toThrow("sorgente rotta");

    let closed = false;
    async function* endless(): AsyncGenerator<Uint8Array> {
      try {
        for (;;) yield text("x");
      } finally {
        closed = true;
      }
    }
    const stream = toWebStream(endless());
    const reader = stream.getReader();
    await reader.read();
    await reader.cancel();
    expect(closed).toBe(true);
  });

  it("verifiedStream: impronta giusta passa, sbagliata fa fallire alla fine, flusso vuoto ha l'impronta del vuoto", async () => {
    const data = text("contenuto");
    const sha = createHash("sha256").update(data).digest("hex");
    const web = (parts: Uint8Array[]) => toWebStream(from(parts));
    expect(new TextDecoder().decode(await collect(verifiedStream(web([data.subarray(0, 4), data.subarray(4)]), "f", sha)))).toBe("contenuto");
    await expect(collect(verifiedStream(web([data]), "f.pdf", "0".repeat(64)))).rejects.toThrow("f.pdf");
    expect((await collect(verifiedStream(web([]), "v", createHash("sha256").update("").digest("hex")))).length).toBe(0);
  });
});

describe("cifratura dei backup: casi limite", () => {
  let keys: { publicKey: string; privateKey: string };
  let other: { publicKey: string; privateKey: string };
  beforeAll(() => {
    keys = generateBackupKeyPair();
    other = generateBackupKeyPair();
  });
  const seal = async (data: Uint8Array) => collect(encryptStream(from([data]), keys.publicKey));
  const open = (bytes: Uint8Array, key = keys.privateKey) => collect(decryptStream(from([bytes]), key));

  it("giro completo di dati vuoti, piccoli e piu' grandi di un blocco (1 MiB)", async () => {
    for (const size of [0, 1, 1024 * 1024, 1024 * 1024 + 1, 2 * 1024 * 1024 + 5]) {
      const data = new Uint8Array(size).map((_, i) => i % 253);
      const back = await open(await seal(data));
      expect(back.length, `size ${size}`).toBe(size);
      expect(Buffer.from(back).equals(Buffer.from(data)), `size ${size}`).toBe(true);
    }
  }, 60_000);

  it("chiave privata sbagliata, non archivio, versione ignota, troncamento e manomissione sono rifiutati con messaggi precisi", async () => {
    const sealed = await seal(text("segreto"));
    await expect(open(sealed, other.privateKey)).rejects.toThrow("chiave privata non corrisponde");
    await expect(open(text("GIBX\u0001\u0000\u0000"))).rejects.toThrow("Non e' un archivio cifrato");
    await expect(open(text("zz"))).rejects.toThrow("troncato");
    const wrongVersion = Buffer.from(sealed);
    wrongVersion[4] = 9;
    await expect(open(wrongVersion)).rejects.toThrow("Versione");
    await expect(open(sealed.subarray(0, sealed.length - 3))).rejects.toThrow("troncato");
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 20] ^= 0xff;
    await expect(open(tampered)).rejects.toThrow("manomesso");
    const header = Buffer.from(sealed);
    header[header.length - 4 - 16 - 7 - 8] ^= 0x01; // un byte dell'intestazione autenticata o della chiave avvolta
    await expect(open(header)).rejects.toThrow();
  });

  it("una lunghezza di blocco dichiarata oltre il massimo e' un archivio danneggiato", async () => {
    const sealed = Buffer.from(await seal(text("x")));
    const wrappedLength = sealed.readUInt16BE(5);
    const offset = 4 + 1 + 2 + wrappedLength + 8;
    sealed.writeUInt32BE(0x00ffffff, offset);
    await expect(open(sealed)).rejects.toThrow("danneggiato");
  });

  it("due cifrature dello stesso contenuto sono diverse (nonce e chiave nuovi a ogni volta)", async () => {
    const a = await seal(text("uguale"));
    const b = await seal(text("uguale"));
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });
});

describe("storage su disco: chiavi ostili e file mancanti", () => {
  let dir: string;
  let storage: LocalFileStorage;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "storage-edges-"));
    storage = new LocalFileStorage(dir);
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("chiavi con .., doppia barra, maiuscole, assolute, vuote o troppo lunghe sono rifiutate prima di toccare il disco", async () => {
    for (const key of ["../fuori", "a/../b", "a//b", "A/b", "/assoluta", "", "a b", "a\\b", `a${"x".repeat(201)}`, ".nascosto"]) {
      expect(() => assertSafeKey(key), key).toThrow("Chiave di storage non valida");
      await expect(storage.put(key, text("x")), key).rejects.toThrow("Chiave di storage non valida");
      await expect(storage.get(key), key).rejects.toThrow();
      expect(await storage.exists(key), key).toBe(false);
    }
  });

  it("chiave mancante: get null, exists falso, delete idempotente; una cartella non e' un file", async () => {
    expect(await storage.get("manca/file.bin")).toBeNull();
    expect(await storage.exists("manca/file.bin")).toBe(false);
    await expect(storage.delete("manca/file.bin")).resolves.toBeUndefined();
    await storage.put("cartella/file.bin", text("ciao"));
    expect(await storage.exists("cartella")).toBe(false);
    expect(await storage.exists("cartella/file.bin")).toBe(true);
    expect(new TextDecoder().decode(await collect(fromWebStream((await storage.get("cartella/file.bin"))!)))).toBe("ciao");
    await storage.put("cartella/file.bin", text("nuovo"));
    expect(new TextDecoder().decode(await collect(fromWebStream((await storage.get("cartella/file.bin"))!)))).toBe("nuovo");
    await storage.delete("cartella/file.bin");
    expect(await storage.exists("cartella/file.bin")).toBe(false);
  });
});
