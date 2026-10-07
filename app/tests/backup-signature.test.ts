import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { decryptStream, encryptStream, generateBackupKeyPair } from "@/modules/backup";
import { assertArchiveSha256, signManifest, verifyManifestSignature, SIGNATURE_PATH } from "@/modules/backup/application/signature";
import { createArchive } from "@/modules/backup/application/archive";
import { restoreArchive } from "@/modules/backup/application/restore";
import type { RestoreTarget, SnapshotReader } from "@/modules/backup/application/ports";
import { getBackupEnv } from "@/platform/config/env";
import { checkBackupSigning } from "@/platform/doctor/checks";
import type { StoragePort } from "@/platform/storage";
import { unzipStream, zipStream } from "@/shared/archive/zip";

const secret = "segreto-di-firma-di-prova-con-almeno-32-caratteri";
const otherSecret = "un-ALTRO-segreto-di-firma-con-almeno-32-caratteri";

const reader: SnapshotReader = { read: async () => ({ tables: [], auditHead: null, migrations: ["m1"] }) };
const storage = { exists: async () => false } as unknown as StoragePort;
// Con dryRun il bersaglio non viene mai toccato.
const target = {} as RestoreTarget;

async function* chunks(data: Uint8Array, size = 50_000): AsyncGenerator<Uint8Array> {
  for (let i = 0; i < data.length; i += size) yield data.subarray(i, i + size);
}
const collect = async (source: AsyncIterable<Uint8Array>) => Buffer.concat(await Array.fromAsync(source));
const makeZip = async (signingSecret?: string) => collect((await createArchive({ reader, storage }, { includeAuth: true, signingSecret })).stream);
const entriesOf = async (zip: Uint8Array) => Array.fromAsync(unzipStream(chunks(zip)));
const rezip = (entries: { name: string; data: Uint8Array }[]) =>
  collect(
    zipStream(
      (async function* () {
        for (const e of entries) yield { ...e, compress: true };
      })(),
    ),
  );
const restore = (zip: Uint8Array, options: Parameters<typeof restoreArchive>[2] = {}) => restoreArchive({ target, storage }, chunks(zip), { dryRun: true, ...options });

describe("backup autenticati (F-06)", () => {
  it("un backup firmato si ripristina con il segreto giusto e riporta la firma come valida", async () => {
    const zip = await makeZip(secret);
    expect((await entriesOf(zip)).map((e) => e.name).slice(0, 2)).toEqual(["manifest.json", SIGNATURE_PATH]);
    await expect(restore(zip, { signingSecret: secret })).resolves.toMatchObject({ signature: "valid" });
  });

  it("rifiuta la firma di un altro segreto, anche con --allow-unsigned (quella vale solo per l'assenza)", async () => {
    const zip = await makeZip(otherSecret);
    await expect(restore(zip, { signingSecret: secret })).rejects.toThrow("firma dell'archivio non e' valida");
    await expect(restore(zip, { signingSecret: secret, allowUnsigned: true })).rejects.toThrow("firma dell'archivio non e' valida");
  });

  it("rifiuta un archivio manomesso: manifest cambiato, firma tolta, firma spostata dopo i dati, due manifest", async () => {
    const zip = await makeZip(secret);
    const entries = await entriesOf(zip);
    const text = (e: { data: Uint8Array }) => new TextDecoder().decode(e.data);

    const edited = entries.map((e) =>
      e.name === "manifest.json" ? { ...e, data: new TextEncoder().encode(text(e).replace(/"createdAt": "[^"]+"/, '"createdAt": "2000-01-01T00:00:00.000Z"')) } : e,
    );
    await expect(restore(await rezip(edited), { signingSecret: secret })).rejects.toThrow("firma dell'archivio non e' valida");

    const withoutSignature = entries.filter((e) => e.name !== SIGNATURE_PATH);
    await expect(restore(await rezip(withoutSignature), { signingSecret: secret })).rejects.toThrow("non e' firmato");

    const signature = entries.find((e) => e.name === SIGNATURE_PATH)!;
    const late = [...withoutSignature, signature];
    await expect(restore(await rezip(late), { signingSecret: secret })).rejects.toThrow("non e' firmato");

    const manifest = entries[0]!;
    await expect(restore(await rezip([...entries, manifest]), { signingSecret: secret })).rejects.toThrow("due manifest");
    await expect(restore(await rezip([...entries.slice(0, 2), signature, ...entries.slice(2)]), { signingSecret: secret })).rejects.toThrow("due firme");
  });

  it("archivio vecchio (senza firma): rifiutato se il segreto e' impostato, ammesso con allowUnsigned, letto senza segreto", async () => {
    const old = await makeZip(undefined);
    expect((await entriesOf(old)).some((e) => e.name === SIGNATURE_PATH)).toBe(false);
    await expect(restore(old, { signingSecret: secret })).rejects.toThrow("--allow-unsigned");
    await expect(restore(old, { signingSecret: secret, allowUnsigned: true })).resolves.toMatchObject({ signature: "unsigned" });
    await expect(restore(old)).resolves.toMatchObject({ signature: "unsigned" });
  });

  it("senza segreto un archivio firmato si legge ma la firma resta «non verificata»", async () => {
    await expect(restore(await makeZip(secret))).resolves.toMatchObject({ signature: "unchecked" });
  });

  it("il giro completo cifrato (come in produzione) resta valido", async () => {
    const keys = generateBackupKeyPair();
    const zip = await makeZip(secret);
    const encrypted = await collect(encryptStream(chunks(zip), keys.publicKey));
    await expect(
      restoreArchive({ target, storage }, decryptStream(chunks(encrypted), keys.privateKey), { dryRun: true, signingSecret: secret }),
    ).resolves.toMatchObject({ signature: "valid" });
  });

  it("la firma e' deterministica, ben formata e legata ai byte del manifest", () => {
    const bytes = new TextEncoder().encode('{"a":1}');
    const signature = signManifest(bytes, secret);
    expect(signature).toMatch(/^hmac-sha256:[0-9a-f]{64}$/);
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(verifyManifestSignature(bytes, enc(signature), secret)).toBe(true);
    expect(verifyManifestSignature(bytes, enc(`${signature}\n`), secret)).toBe(true);
    expect(verifyManifestSignature(enc('{"a":2}'), enc(signature), secret)).toBe(false);
    expect(verifyManifestSignature(bytes, enc(signature), otherSecret)).toBe(false);
    for (const bad of ["", "hmac-sha256:", "hmac-sha256:zz", signature.slice(0, -2), signature.replace("hmac-sha256", "hmac-sha1")]) {
      expect(verifyManifestSignature(bytes, enc(bad), secret), bad).toBe(false);
    }
  });

  it("--expect-sha256: l'impronta annotata deve coincidere con quella del file", async () => {
    const data = Buffer.from("contenuto cifrato finto");
    const sha = createHash("sha256").update(data).digest("hex");
    await expect(assertArchiveSha256(chunks(data, 5), sha)).resolves.toBeUndefined();
    await expect(assertArchiveSha256(chunks(data, 5), ` ${sha.toUpperCase()} `)).resolves.toBeUndefined();
    await expect(assertArchiveSha256(chunks(Buffer.from("altro"), 5), sha)).rejects.toThrow("non coincide");
    await expect(assertArchiveSha256(chunks(data), "1234")).rejects.toThrow("non e' una SHA-256");
  });

  it("BACKUP_SIGNING_SECRET: facoltativo, vuoto = assente, almeno 32 caratteri", () => {
    const parse = (value: string | undefined) => getBackupEnv({ ...(value === undefined ? {} : { BACKUP_SIGNING_SECRET: value }) } as NodeJS.ProcessEnv);
    expect(parse(undefined).BACKUP_SIGNING_SECRET).toBeUndefined();
    expect(parse("   ").BACKUP_SIGNING_SECRET).toBeUndefined();
    expect(parse(secret).BACKUP_SIGNING_SECRET).toBe(secret);
    expect(() => parse("corto")).toThrow("BACKUP_SIGNING_SECRET");
  });

  it("doctor: avviso se i backup sono configurati ma manca il segreto; ok negli altri casi", () => {
    expect(checkBackupSigning({ BACKUP_PUBLIC_KEY: "chiave" }).level).toBe("avviso");
    expect(checkBackupSigning({ BACKUP_PUBLIC_KEY: "chiave", BACKUP_SIGNING_SECRET: secret }).level).toBe("ok");
    expect(checkBackupSigning({}).level).toBe("ok");
    expect(JSON.stringify(checkBackupSigning({ BACKUP_PUBLIC_KEY: "chiave", BACKUP_SIGNING_SECRET: secret }))).not.toContain(secret);
  });
});

describe("tetti di lettura dello ZIP (F-10)", () => {
  const zipOf = (...sizes: number[]) =>
    collect(
      zipStream(
        (async function* () {
          for (const [i, n] of sizes.entries()) yield { name: `f${i}.bin`, data: new Uint8Array(n), compress: true };
        })(),
      ),
    );

  it("una voce legittima passa con i tetti predefiniti", async () => {
    const zip = await zipOf(2_000_000);
    expect((await Array.fromAsync(unzipStream(chunks(zip)))).map((e) => e.data.length)).toEqual([2_000_000]);
  });

  it("rifiuta una voce troppo grande e un totale troppo grande", async () => {
    const zip = await zipOf(300_000, 300_000);
    await expect(Array.fromAsync(unzipStream(chunks(zip), { maxEntryBytes: 100_000 }))).rejects.toThrow("dimensione massima");
    await expect(Array.fromAsync(unzipStream(chunks(zip), { maxTotalBytes: 400_000 }))).rejects.toThrow("dimensione massima");
    await expect(Array.fromAsync(unzipStream(chunks(zip), { maxTotalBytes: 600_000 }))).resolves.toHaveLength(2);
  });

  it("rifiuta un rapporto di espansione anomalo (bomba), ma non sotto la soglia minima", async () => {
    const zip = await zipOf(5_000_000);
    expect(zip.length).toBeLessThan(20_000);
    await expect(Array.fromAsync(unzipStream(chunks(zip), { maxExpansionRatio: 100, ratioFloorBytes: 1_000_000 }))).rejects.toThrow("anomalo");
    await expect(Array.fromAsync(unzipStream(chunks(zip), { maxExpansionRatio: 100, ratioFloorBytes: 10_000_000 }))).resolves.toHaveLength(1);
  });

  it("il ripristino passa i tetti a unzipStream", async () => {
    const zip = await makeZip(secret);
    await expect(restore(zip, { signingSecret: secret, limits: { maxTotalBytes: 10 } })).rejects.toThrow("dimensione massima");
  });
});
