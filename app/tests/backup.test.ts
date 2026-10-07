import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { auditLog, backupRun, territory, user } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { LocalFileStorage } from "@/platform/storage";
import { createAsset } from "@/modules/assets";
import {
  createExport,
  decryptStream,
  encryptStream,
  generateBackupKeyPair,
  getBackupRun,
  listBackupRuns,
  restoreFromArchive,
  runBackup,
  type BackupSettings,
} from "@/modules/backup";
import { AUTH_TABLES, BUSINESS_TABLES, EXCLUDED_TABLES, SEEDED_TABLES, manifestSchema } from "@/modules/backup/domain/archive";
import { LocalBackupDestination } from "@/modules/backup/infrastructure/local-destination";
import { postgresSnapshotReader, rowsOf } from "@/modules/backup/infrastructure/postgres-snapshot";
import { createDocument, listDocuments, updateDocument } from "@/modules/documents";
import { createParty } from "@/modules/directory";
import { evaluateDossier, linkDocument, getDossier } from "@/modules/dossier";
import { addRuleVersion, listRules, seedExampleRules } from "@/modules/rules";
import { importIstat } from "@/modules/territory";
import { fromWebStream } from "@/shared/archive/stream";
import { unzipStream, zipStream } from "@/shared/archive/zip";
import { createTestDb, type TestDb } from "./helpers/test-db";
import { makePdf } from "./helpers/sample-pdf";

const actor = { type: "owner", id: "o1" } as const;
const owner = { displayName: "Proprietario Prova", email: "prova@example.test" };

async function* chunks(data: Uint8Array, size = 100_000): AsyncGenerator<Uint8Array> {
  for (let i = 0; i < data.length; i += size) yield data.subarray(i, i + size);
}
const collect = async (source: AsyncIterable<Uint8Array>) => Buffer.concat(await Array.fromAsync(source));
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

describe("cifratura e ZIP", () => {
  const keys = generateBackupKeyPair();

  it("cifra e decifra, anche su piu' blocchi, e restituisce gli stessi byte", async () => {
    for (const size of [0, 1, 1024 * 1024, 1024 * 1024 + 1, 3.5 * 1024 * 1024]) {
      const plain = randomBytes(size);
      const encrypted = await collect(encryptStream(chunks(plain), keys.publicKey));
      expect(encrypted.length).toBeGreaterThan(plain.length);
      expect((await collect(decryptStream(chunks(encrypted, 7777), keys.privateKey))).equals(plain)).toBe(true);
    }
  }, 60_000);

  it("non si apre con un'altra chiave, e un byte cambiato o un file troncato si scoprono", async () => {
    const plain = randomBytes(2.5 * 1024 * 1024);
    const encrypted = await collect(encryptStream(chunks(plain), keys.publicKey));

    const other = generateBackupKeyPair();
    await expect(collect(decryptStream(chunks(encrypted), other.privateKey))).rejects.toThrow("chiave privata");

    const flipped = Buffer.from(encrypted);
    flipped[flipped.length - 1000] ^= 0xff;
    await expect(collect(decryptStream(chunks(flipped), keys.privateKey))).rejects.toThrow("manomesso");

    await expect(collect(decryptStream(chunks(encrypted.subarray(0, encrypted.length - 100)), keys.privateKey))).rejects.toThrow();
    // Tolto l'ultimo blocco intero: manca il segno "ultimo", quindi non e' un archivio completo.
    const lastFrame = 4 + (plain.length % (1024 * 1024)) + 16;
    await expect(collect(decryptStream(chunks(encrypted.subarray(0, encrypted.length - lastFrame)), keys.privateKey))).rejects.toThrow();
  }, 60_000);

  it("il ZIP fa il giro e rifiuta i percorsi pericolosi", async () => {
    const entries = [
      { name: "a.txt", data: new TextEncoder().encode("ciao"), compress: true },
      { name: "files/b.bin", data: chunks(randomBytes(300_000)), compress: false },
    ];
    const zip = await collect(zipStream((async function* () { yield* entries; })()));
    const read = await Array.fromAsync(unzipStream(chunks(zip, 5000)));
    expect(read.map((e) => e.name)).toEqual(["a.txt", "files/b.bin"]);
    expect(new TextDecoder().decode(read[0]!.data)).toBe("ciao");
    expect(read[1]!.data.length).toBe(300_000);

    const evil = await collect(zipStream((async function* () { yield { name: "../fuori.txt", data: new TextEncoder().encode("x"), compress: true }; })()));
    await expect(Array.fromAsync(unzipStream(chunks(evil)))).rejects.toThrow("percorso non valido");
  });
});

describe("backup, esportazione e ripristino", () => {
  let a: TestDb;
  let b: TestDb;
  let dir: string;
  let storageA: LocalFileStorage;
  let destination: LocalBackupDestination;
  let settings: BackupSettings;
  const keys = generateBackupKeyPair();

  const runA = <T>(work: Parameters<typeof runInUnitOfWork<T>>[2]) => runInUnitOfWork(a.db, actor, work);
  const backupFiles = async () => (await readdir(join(dir, "backups"))).filter((f) => f.endsWith(".gibk"));
  const snapshot = async (db: TestDb) => new Map((await postgresSnapshotReader(db.db).read(true)).tables.map((t) => [t.name, t.ndjson]));

  beforeAll(async () => {
    a = await createTestDb();
    dir = await mkdtemp(join(tmpdir(), "backup-test-"));
    storageA = new LocalFileStorage(join(dir, "a"));
    destination = new LocalBackupDestination(join(dir, "backups"));
    settings = { destination, publicKey: keys.publicKey, keep: 3 };

    await runA((uow) =>
      importIstat(uow, [
        { regionCode: "90", regionName: "Regione di prova", provinceCode: "900", provinceName: "Provincia di prova", provinceSigla: "PP", municipalityCode: "900001", municipalityName: "Comune Uno", cadastralCode: "Z101" },
      ]),
    );
    const municipalityId = (await a.db.select().from(territory).where(eq(territory.kind, "municipality")))[0]!.id;
    const asset = await runA((uow) => createAsset(uow, owner, { kind: "dwelling", name: "Bene da salvare", territoryId: municipalityId, rights: [{ holder: { type: "self" }, rightType: "full", quotaNumerator: 1, quotaDenominator: 1 }] }));
    const party = await runA((uow) => createParty(uow, { displayName: "Emittente", roles: ["other"] }));
    const categoryId = rowsOf<{ id: string }>(await a.db.execute(sql`select id from document_category where code = 'title_deed'`))[0]!.id;
    const doc = await runA((uow) =>
      createDocument(uow, { title: "Atto di prova", categoryId, assetIds: [asset.ok ? asset.value.id : ""], issuerPartyId: party.ok ? party.value.id : "", issuedOn: "2020-01-02" }, { name: "atto.pdf", bytes: makePdf("Canone mensile concordato") }, storageA),
    );
    await runA((uow) => updateDocument(uow, doc.ok ? doc.value.id : "", { title: "Atto di prova", categoryId, confidentiality: "reserved", assetIds: [], verificationStatus: "verified_by_owner" }));
    // Regole (con una seconda versione, cioe' una catena) e voci del dossier con un documento collegato.
    await runA((uow) => seedExampleRules(uow, municipalityId));
    const titolo = (await listRules(a.db)).find((r) => r.key === "esempio_titolo")!;
    await runA((uow) =>
      addRuleVersion(uow, titolo.id, { title: titolo.current.title, level: "national", sourceText: "Seconda versione", outcomes: titolo.current.outcomes }),
    );
    const assetIdForDossier = asset.ok ? asset.value.id : "";
    await runA((uow) => evaluateDossier(uow, assetIdForDossier, "2026-06-15"));
    const voce = (await getDossier(a.db, assetIdForDossier, "2026-06-15"))!.categories.flatMap((c) => c.items)[0]!;
    await runA((uow) => linkDocument(uow, voce.id, doc.ok ? doc.value.id : ""));
    await a.db.insert(user).values({ id: "u1", name: "Proprietario", email: "prova@example.test" });

    b = await createTestDb({ inMemory: true });
  }, 60_000);

  afterAll(async () => {
    await a.close();
    await b.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("ogni tabella del database e' nell'archivio o esclusa con un motivo", async () => {
    const result = await a.db.execute(sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`);
    const real = rowsOf<{ table_name: string }>(result).map((r) => r.table_name).sort();
    const known = [...BUSINESS_TABLES, ...AUTH_TABLES, ...Object.keys(EXCLUDED_TABLES)].sort();
    expect(real).toEqual(known);
  });

  it("un database appena migrato ha piene solo le tabelle dei dati di partenza", async () => {
    const fresh = await createTestDb({ inMemory: true });
    try {
      const filled: string[] = [];
      for (const table of [...AUTH_TABLES, ...BUSINESS_TABLES]) {
        if (rowsOf(await fresh.db.execute(sql.raw(`select 1 from "${table}" limit 1`))).length > 0) filled.push(table);
      }
      expect(filled).toEqual([...SEEDED_TABLES]);
    } finally {
      await fresh.close();
    }
  });

  it("senza chiave pubblica non parte e lo registra come fallito", async () => {
    const outcome = await runBackup(a.db, actor, "manual", { storage: storageA, settings: { ...settings, publicKey: undefined } });
    expect(outcome).toMatchObject({ ok: false, message: expect.stringContaining("BACKUP_PUBLIC_KEY") });
    expect((await listBackupRuns(a.db))[0]).toMatchObject({ status: "failed" });
    expect(await readdir(join(dir, "backups")).catch(() => [])).toEqual([]);
  });

  it("fa un backup cifrato: il contenuto non e' leggibile senza la chiave privata", async () => {
    const outcome = await runBackup(a.db, actor, "manual", { storage: storageA, settings });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.run).toMatchObject({ status: "completed", fileCount: 1, trigger: "manual" });
    expect(outcome.run.auditSeq).toBeGreaterThan(0);

    const files = await backupFiles();
    expect(files).toEqual([outcome.run.destinationKey]);
    const bytes = await readFile(join(dir, "backups", files[0]!));
    expect(bytes.subarray(0, 4).toString()).toBe("GIBK");
    expect(bytes.length).toBe(outcome.run.sizeBytes);
    expect(sha(bytes)).toBe(outcome.run.archiveSha256);
    const text = bytes.toString("latin1");
    expect(text).not.toContain("Atto di prova");
    expect(text).not.toContain("prova@example.test");
  });

  it("il ripristino in un ambiente vuoto ricostruisce dati, file, audit e ricerca", async () => {
    const run = (await listBackupRuns(a.db)).find((r) => r.status === "completed")!;
    const encrypted = await destination.get(run.destinationKey!);
    const storageB = new LocalFileStorage(join(dir, "b"));

    const report = await restoreFromArchive(b.db, storageB, decryptStream(fromWebStream(encrypted!), keys.privateKey));
    expect(report).toMatchObject({ dryRun: false, files: 1 });
    expect(report.manifest.includesAuth).toBe(true);
    expect(report.manifest.auditHead).toEqual({ seq: run.auditSeq, hash: run.auditHash });

    const [before, after] = [await snapshot(a), await snapshot(b)];
    for (const table of [...BUSINESS_TABLES, ...AUTH_TABLES].filter((t) => t !== "audit_log")) {
      expect(after.get(table), table).toEqual(before.get(table));
    }
    // L'audit ripristinato e' identico fino alla riga del backup (A ha poi aggiunto le sue righe), con la catena integra.
    const auditA = before.get("audit_log")!.split("\n");
    const auditB = after.get("audit_log")!.split("\n");
    expect(auditB).toEqual(auditA.slice(0, auditB.length));
    expect(auditB.length).toBe(run.auditSeq);
    expect(rowsOf<{ v: string | null }>(await b.db.execute(sql`select audit_log_verify() as v`))[0]!.v).toBeNull();

    // Il file originale e' identico e il testo si cerca anche nell'ambiente ripristinato.
    const [{ storage_key, sha256 }] = rowsOf<{ storage_key: string; sha256: string }>(await b.db.execute(sql`select storage_key, sha256 from file_object`));
    expect(sha(Buffer.from(await new Response((await storageB.get(storage_key!))!).arrayBuffer()))).toBe(sha256);
    expect((await listDocuments(b.db, { query: "canoni" })).map((d) => d.title)).toEqual(["Atto di prova"]);
    // Le versioni delle regole ripristinate restano immutabili e la catena delle versioni e' intatta.
    expect(rowsOf<{ n: string }>(await b.db.execute(sql`select count(*)::text as n from rule_version where supersedes_version_id is not null`))[0]!.n).toBe("1");
    await expect(b.db.execute(sql`update rule_version set title = 'x'`)).rejects.toThrow();
    // Il nuovo ambiente continua la catena senza buchi.
    await runInUnitOfWork(b.db, actor, (uow) => uow.audit.record({ action: "test.after_restore", entityType: "test", entityId: "x", diff: {} }));
    expect(rowsOf<{ v: string | null }>(await b.db.execute(sql`select audit_log_verify() as v`))[0]!.v).toBeNull();
  }, 60_000);

  it("rifiuta di ripristinare su un database che ha gia' dati o uno schema diverso", async () => {
    const run = (await listBackupRuns(a.db)).find((r) => r.status === "completed")!;
    const open = async () => decryptStream(fromWebStream((await destination.get(run.destinationKey!))!), keys.privateKey);
    await expect(restoreFromArchive(b.db, new LocalFileStorage(join(dir, "b2")), await open())).rejects.toThrow("non e' vuoto");

    const c = await createTestDb({ inMemory: true });
    try {
      await c.db.execute(sql`insert into drizzle.__drizzle_migrations (hash, created_at) values ('inventata', 1)`);
      await expect(restoreFromArchive(c.db, new LocalFileStorage(join(dir, "c")), await open())).rejects.toThrow("schema");
    } finally {
      await c.close();
    }
  });

  it("con dryRun verifica l'archivio senza scrivere nulla, anche su un database con dati", async () => {
    const run = (await listBackupRuns(a.db)).find((r) => r.status === "completed")!;
    const storage = new LocalFileStorage(join(dir, "dry"));
    const report = await restoreFromArchive(a.db, storage, decryptStream(fromWebStream((await destination.get(run.destinationKey!))!), keys.privateKey), { dryRun: true });
    expect(report).toMatchObject({ dryRun: true, files: 1 });
    expect(await readdir(join(dir, "dry")).catch(() => [])).toEqual([]);
  });

  it("scopre un archivio alterato (tabella o file) anche se e' ben formato", async () => {
    const run = (await listBackupRuns(a.db)).find((r) => r.status === "completed")!;
    const entries = await Array.fromAsync(unzipStream(decryptStream(fromWebStream((await destination.get(run.destinationKey!))!), keys.privateKey)));
    const rezip = (change: (e: { name: string; data: Uint8Array }) => Uint8Array) =>
      zipStream((async function* () { for (const e of entries) yield { name: e.name, data: change(e), compress: true }; })());
    const dry = (source: AsyncIterable<Uint8Array>) => restoreFromArchive(a.db, new LocalFileStorage(join(dir, "x")), source, { dryRun: true });

    await expect(dry(rezip((e) => (e.name === "data/party.ndjson" ? new TextEncoder().encode('{"id":"x"}') : e.data)))).rejects.toThrow("impronta");
    await expect(dry(rezip((e) => (e.name.startsWith("files/") ? new Uint8Array([1, 2, 3]) : e.data)))).rejects.toThrow("impronta");
    await expect(dry(rezip((e) => e.data))).resolves.toMatchObject({ dryRun: true });
  });

  it("l'esportazione completa e' in chiaro, senza credenziali, con manifest, dati e file", async () => {
    const { manifest, stream } = await createExport(a.db, actor, storageA);
    const zip = await collect(stream);
    expect(zip.subarray(0, 2).toString()).toBe("PK");
    const entries = new Map((await Array.fromAsync(unzipStream(chunks(zip)))).map((e) => [e.name, e.data]));

    expect(manifestSchema.parse(JSON.parse(new TextDecoder().decode(entries.get("manifest.json")!)))).toMatchObject({ includesAuth: false });
    expect(manifest.includesAuth).toBe(false);
    expect(entries.has("LEGGIMI.txt")).toBe(true);
    for (const table of BUSINESS_TABLES) expect(entries.has(`data/${table}.ndjson`), table).toBe(true);
    for (const table of AUTH_TABLES) expect(entries.has(`data/${table}.ndjson`), table).toBe(false);
    expect([...entries.keys()].filter((k) => k.startsWith("files/"))).toHaveLength(1);
    expect(new TextDecoder().decode(entries.get("data/document.ndjson")!)).toContain("Atto di prova");
    expect(JSON.stringify([...entries.keys()])).not.toContain("user");

    const exported = await a.db.select().from(auditLog).where(eq(auditLog.action, "backup.export"));
    expect(exported).toHaveLength(1);
  });

  it("tiene solo gli ultimi N backup e non tocca quelli buoni se uno fallisce", async () => {
    for (let i = 0; i < 4; i += 1) await runBackup(a.db, actor, "scheduled", { storage: storageA, settings });
    expect(await backupFiles()).toHaveLength(3);
    const runs = await listBackupRuns(a.db);
    const newest = runs.find((r) => r.status === "completed")!;
    expect(await backupFiles()).toContain(newest.destinationKey);

    const before = await backupFiles();
    await runBackup(a.db, actor, "scheduled", { storage: storageA, settings: { ...settings, publicKey: undefined } });
    expect(await backupFiles()).toEqual(before);
  }, 60_000);

  it("segnala un file mancante come avviso e blocca il backup se un file e' stato alterato", async () => {
    const key = rowsOf<{ storage_key: string }>(await a.db.execute(sql`select storage_key from file_object`))[0]!.storage_key;
    const path = join(dir, "a", key);
    const original = await readFile(path);

    await writeFile(path, Buffer.from("alterato"));
    const corrupted = await runBackup(a.db, actor, "manual", { storage: storageA, settings });
    expect(corrupted).toMatchObject({ ok: false, message: expect.stringContaining("impronta") });

    await rm(path);
    const missing = await runBackup(a.db, actor, "manual", { storage: storageA, settings });
    expect(missing.ok && missing.run).toMatchObject({ status: "warning", message: expect.stringContaining("mancano") });
    expect(await getBackupRun(a.db, missing.ok ? missing.run.id : "")).toMatchObject({ fileCount: 0 });

    await writeFile(path, original);
  });

  it("registra gli eventi nell'audit senza dati personali e senza mai nominare la chiave", async () => {
    const rows = await a.db.select().from(auditLog).where(sql`${auditLog.action} like 'backup.%'`);
    expect(rows.length).toBeGreaterThan(5);
    const text = JSON.stringify(rows);
    expect(text).not.toContain("PRIVATE KEY");
    expect(text).not.toContain("prova@example.test");
    expect((await a.db.select().from(backupRun)).length).toBeGreaterThan(5);
  });
});
