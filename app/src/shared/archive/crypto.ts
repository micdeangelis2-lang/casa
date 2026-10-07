import { createCipheriv, createDecipheriv, generateKeyPairSync, privateDecrypt, publicEncrypt, randomBytes, constants } from "node:crypto";

/**
 * Cifratura dei backup con chiave pubblica: il server conosce solo la chiave PUBBLICA, quindi non puo' aprire
 * i propri backup. Chi ha la chiave privata (il proprietario, fuori dal server) puo' farlo.
 *
 * Formato (tutti i numeri in big endian):
 *   "GIBK" | versione (1 byte) | lunghezza chiave avvolta (2 byte) | chiave dati avvolta con RSA-OAEP-SHA256 | nonce base (8 byte)
 *   poi una sequenza di blocchi: [lunghezza cifrato (4 byte, bit alto = ultimo blocco)] [cifrato] [tag GCM (16 byte)]
 * Ogni blocco e' cifrato con AES-256-GCM; il nonce e' (nonce base, contatore del blocco). L'intestazione, il contatore e
 * il segno "ultimo" entrano nei dati autenticati: un blocco tolto, spostato o un file troncato fanno fallire la lettura.
 */
const MAGIC = Buffer.from("GIBK");
const VERSION = 1;
const FRAME_BYTES = 1024 * 1024;
const TAG_BYTES = 16;
const LAST_FLAG = 0x80000000;

export function generateBackupKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 3072,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKey, privateKey };
}

const nonceFor = (base: Buffer, counter: number) => {
  const nonce = Buffer.alloc(12);
  base.copy(nonce, 0);
  nonce.writeUInt32BE(counter, 8);
  return nonce;
};

const aadFor = (header: Buffer, counter: number, last: boolean) => {
  const tail = Buffer.alloc(5);
  tail.writeUInt32BE(counter, 0);
  tail.writeUInt8(last ? 1 : 0, 4);
  return Buffer.concat([header, tail]);
};

/** Riunisce pezzi di dimensione qualsiasi in blocchi esatti di `size` byte (l'ultimo puo' essere piu' corto). */
async function* rechunk(source: AsyncIterable<Uint8Array>, size: number): AsyncGenerator<Buffer> {
  let pending: Buffer[] = [];
  let length = 0;
  for await (const part of source) {
    pending.push(Buffer.from(part.buffer, part.byteOffset, part.byteLength));
    length += part.length;
    while (length >= size) {
      const all = Buffer.concat(pending);
      yield all.subarray(0, size);
      const rest = all.subarray(size);
      pending = rest.length > 0 ? [rest] : [];
      length = rest.length;
    }
  }
  yield Buffer.concat(pending);
}

export async function* encryptStream(source: AsyncIterable<Uint8Array>, publicKeyPem: string): AsyncGenerator<Uint8Array> {
  const dataKey = randomBytes(32);
  const baseNonce = randomBytes(8);
  const wrapped = publicEncrypt({ key: publicKeyPem, oaepHash: "sha256", padding: constants.RSA_PKCS1_OAEP_PADDING }, dataKey);
  const lengthField = Buffer.alloc(2);
  lengthField.writeUInt16BE(wrapped.length);
  const header = Buffer.concat([MAGIC, Buffer.from([VERSION]), lengthField, wrapped, baseNonce]);
  yield header;

  // Si tiene un blocco "in attesa" per sapere quale e' l'ultimo prima di cifrarlo.
  let held: Buffer | null = null;
  let counter = 0;
  const seal = (plain: Buffer, last: boolean): Buffer => {
    const cipher = createCipheriv("aes-256-gcm", dataKey, nonceFor(baseNonce, counter), { authTagLength: TAG_BYTES });
    cipher.setAAD(aadFor(header, counter, last));
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE((body.length | (last ? LAST_FLAG : 0)) >>> 0);
    counter += 1;
    return Buffer.concat([length, body, cipher.getAuthTag()]);
  };
  for await (const block of rechunk(source, FRAME_BYTES)) {
    if (held) yield seal(held, false);
    held = block;
  }
  yield seal(held ?? Buffer.alloc(0), true);
}

/** Legge esattamente N byte da un flusso a pezzi. */
class ByteReader {
  private readonly iterator: AsyncIterator<Uint8Array>;
  private buffer: Buffer = Buffer.alloc(0);
  constructor(source: AsyncIterable<Uint8Array>) {
    this.iterator = source[Symbol.asyncIterator]();
  }
  async read(n: number): Promise<Buffer> {
    while (this.buffer.length < n) {
      const next = await this.iterator.next();
      if (next.done) throw new Error("Archivio cifrato troncato o danneggiato");
      this.buffer = Buffer.concat([this.buffer, next.value]);
    }
    const out = this.buffer.subarray(0, n);
    this.buffer = this.buffer.subarray(n);
    return out;
  }
}

export async function* decryptStream(source: AsyncIterable<Uint8Array>, privateKeyPem: string): AsyncGenerator<Uint8Array> {
  const reader = new ByteReader(source);
  const fixed = await reader.read(MAGIC.length + 1 + 2);
  if (!fixed.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Non e' un archivio cifrato di Gestione Immobili");
  if (fixed[MAGIC.length] !== VERSION) throw new Error("Versione dell'archivio cifrato non supportata");
  const wrapped = await reader.read(fixed.readUInt16BE(MAGIC.length + 1));
  const baseNonce = await reader.read(8);
  const header = Buffer.concat([fixed, wrapped, baseNonce]);

  let dataKey: Buffer;
  try {
    dataKey = privateDecrypt({ key: privateKeyPem, oaepHash: "sha256", padding: constants.RSA_PKCS1_OAEP_PADDING }, wrapped);
  } catch {
    throw new Error("La chiave privata non corrisponde a questo archivio");
  }

  for (let counter = 0; ; counter += 1) {
    const lengthField = (await reader.read(4)).readUInt32BE();
    const last = (lengthField & LAST_FLAG) !== 0;
    const length = lengthField & ~LAST_FLAG;
    if (length > FRAME_BYTES) throw new Error("Archivio cifrato danneggiato");
    const body = await reader.read(length);
    const tag = await reader.read(TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", dataKey, nonceFor(baseNonce, counter), { authTagLength: TAG_BYTES });
    decipher.setAAD(aadFor(header, counter, last));
    decipher.setAuthTag(tag);
    try {
      yield Buffer.concat([decipher.update(body), decipher.final()]);
    } catch {
      throw new Error("Archivio cifrato danneggiato o manomesso");
    }
    if (last) return;
  }
}
