import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { auditLog, territory } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { LocalFileStorage } from "@/platform/storage";
import { createAsset } from "@/modules/assets";
import {
  addDocumentVersion,
  createDocument,
  getDocumentDetail,
  listDocumentCategories,
  listDocuments,
  MAX_FILE_BYTES,
  openDocumentFile,
  setDocumentArchived,
  sniffFile,
  updateDocument,
} from "@/modules/documents";
import { createDocument as createDocumentUseCase } from "@/modules/documents/application/use-cases";
import { drizzleDocumentRepository } from "@/modules/documents/infrastructure/drizzle-document-repository";
import { createParty } from "@/modules/directory";
import { importIstat } from "@/modules/territory";
import { createTestDb, type TestDb } from "./helpers/test-db";
import { makePdf } from "./helpers/sample-pdf";

const actor = { type: "owner", id: "o1" } as const;
const owner = { displayName: "Proprietario Prova", email: "prova@example.test" };

describe("documenti", () => {
  let t: TestDb;
  let dir: string;
  let storage: LocalFileStorage;
  let categoryId: string;
  let assetId: string;
  let issuerId: string;

  const run = <T>(work: Parameters<typeof runInUnitOfWork<T>>[2]) => runInUnitOfWork(t.db, actor, work);
  const create = (input: Record<string, unknown>, file: { name: string; bytes: Uint8Array } | null) =>
    run((uow) => createDocument(uow, { categoryId, ...input }, file, storage));
  const idOf = (r: { ok: boolean; value?: { id: string } }) => {
    if (!r.ok || !r.value) throw new Error(`atteso successo: ${JSON.stringify(r)}`);
    return r.value.id;
  };
  const files = async () => (await readdir(join(dir, "documents")).catch(() => [])).filter((f) => !f.endsWith(".part"));

  beforeAll(async () => {
    t = await createTestDb();
    dir = await mkdtemp(join(tmpdir(), "docs-test-"));
    storage = new LocalFileStorage(dir);
    await run((uow) =>
      importIstat(uow, [
        { regionCode: "90", regionName: "Regione di prova", provinceCode: "900", provinceName: "Provincia di prova", provinceSigla: "PP", municipalityCode: "900001", municipalityName: "Comune Uno", cadastralCode: "Z101" },
      ]),
    );
    const municipalityId = (await t.db.select().from(territory).where(eq(territory.kind, "municipality")))[0]!.id;
    const a = await run((uow) => createAsset(uow, owner, { kind: "dwelling", name: "Bene per documenti", territoryId: municipalityId }));
    assetId = a.ok ? a.value.id : "";
    const p = await run((uow) => createParty(uow, { displayName: "Ufficio di prova", roles: ["other"] }));
    issuerId = p.ok ? p.value.id : "";
    categoryId = (await listDocumentCategories(t.db))[0]!.id;
  });
  afterAll(async () => {
    await t.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("parte con categorie di base come dati", async () => {
    const categories = await listDocumentCategories(t.db);
    expect(categories.length).toBeGreaterThanOrEqual(10);
    expect(categories.map((c) => c.code)).toContain("title_deed");
  });

  it("riconosce il tipo dai byte e non dall'estensione", () => {
    expect(sniffFile(makePdf("x"), "atto.pdf")?.mime).toBe("application/pdf");
    expect(sniffFile(makePdf("x"), "atto.jpg")?.mime).toBe("application/pdf");
    expect(sniffFile(new TextEncoder().encode("MZ\u0090\u0000eseguibile"), "atto.pdf")).toBeNull();
    expect(sniffFile(new TextEncoder().encode("PK\u0003\u0004zzzz"), "pratica.docx")?.extension).toBe("docx");
    expect(sniffFile(new TextEncoder().encode("PK\u0003\u0004zzzz"), "archivio.zip")).toBeNull();
    expect(sniffFile(new Uint8Array([0x30, 0x82, 0x01, 0x00]), "atto.pdf.p7m")?.mime).toBe("application/pkcs7-mime");
  });

  it("carica un PDF, ne estrae il testo e lo rende ricercabile", async () => {
    const id = idOf(
      await create(
        { title: "Contratto di locazione", assetIds: [assetId], issuerPartyId: issuerId, issuedOn: "2024-03-01", validFrom: "2024-03-01", validTo: "2028-02-29" },
        { name: "contratto.pdf", bytes: makePdf("Canone mensile concordato quattrocento euro") },
      ),
    );
    const detail = await getDocumentDetail(t.db, id);
    expect(detail).toMatchObject({ title: "Contratto di locazione", archived: false, assets: [{ id: assetId }] });
    expect(detail?.versions).toHaveLength(1);
    expect(detail?.versions[0]).toMatchObject({ versionNo: 1, mimeType: "application/pdf", hasText: true, issuerName: "Ufficio di prova", verificationStatus: "to_verify" });

    // Una parola che sta solo nel contenuto (con flessione italiana: "canoni" trova "canone").
    expect((await listDocuments(t.db, { query: "canoni" })).map((d) => d.id)).toContain(id);
    expect((await listDocuments(t.db, { query: "locazione" })).map((d) => d.id)).toContain(id);
    expect((await listDocuments(t.db, { query: "assicurazione" })).map((d) => d.id)).not.toContain(id);
    expect((await listDocuments(t.db, { assetId })).map((d) => d.id)).toContain(id);
  });

  it("rifiuta file non ammessi, vuoti o troppo grandi, senza lasciare byte nello storage", async () => {
    const before = (await files()).length;
    const bad = await create({ title: "Eseguibile" }, { name: "a.pdf", bytes: new TextEncoder().encode("MZ\u0090\u0000programma") });
    expect(bad).toMatchObject({ ok: false });
    const empty = await create({ title: "Vuoto" }, { name: "a.pdf", bytes: new Uint8Array() });
    expect(empty).toMatchObject({ ok: false, errors: { file: expect.any(Array) } });
    const none = await create({ title: "Senza file" }, null);
    expect(none).toMatchObject({ ok: false, errors: { file: expect.any(Array) } });
    const huge = new Uint8Array(MAX_FILE_BYTES + 1);
    huge.set(makePdf("x"));
    const tooBig = await create({ title: "Enorme" }, { name: "a.pdf", bytes: huge });
    expect(tooBig).toMatchObject({ ok: false, errors: { file: [expect.stringContaining("limite")] } });
    expect((await files()).length).toBe(before);
  });

  it("valida i metadati e i riferimenti", async () => {
    const pdf = { name: "a.pdf", bytes: makePdf("prova") };
    expect(await create({ title: "  " }, pdf)).toMatchObject({ ok: false, errors: { title: expect.any(Array) } });
    expect(await create({ title: "X", validFrom: "2025-01-01", validTo: "2024-01-01" }, pdf)).toMatchObject({ ok: false, errors: { validTo: expect.any(Array) } });
    expect(await create({ title: "X", categoryId: "00000000-0000-4000-8000-000000000000" }, pdf)).toMatchObject({ ok: false, errors: { categoryId: expect.any(Array) } });
    expect(await create({ title: "X", assetIds: ["00000000-0000-4000-8000-000000000000"] }, pdf)).toMatchObject({ ok: false, errors: { assetIds: expect.any(Array) } });
  });

  it("una nuova versione non cancella la precedente", async () => {
    const id = idOf(await create({ title: "Polizza" }, { name: "polizza-2024.pdf", bytes: makePdf("polizza 2024") }));
    const v2 = await run((uow) => addDocumentVersion(uow, id, { validFrom: "2025-01-01", validTo: "2025-12-31" }, { name: "polizza-2025.pdf", bytes: makePdf("polizza 2025") }, storage));
    expect(v2).toMatchObject({ ok: true, value: { versionNo: 2 } });
    const detail = await getDocumentDetail(t.db, id);
    expect(detail?.versions.map((v) => v.versionNo)).toEqual([2, 1]);
    expect((await listDocuments(t.db, { query: "polizza" })).find((d) => d.id === id)).toMatchObject({ versionCount: 2, validTo: "2025-12-31" });

    for (const v of detail!.versions) {
      const opened = await openDocumentFile(t.db, id, v.id, storage);
      expect(opened?.originalFilename).toBe(v.originalFilename);
      expect(Buffer.from(await new Response(opened!.stream).arrayBuffer()).toString("latin1")).toContain(`polizza ${v.versionNo === 1 ? 2024 : 2025}`);
    }
    // Una versione di un altro documento non si apre passando un id diverso.
    expect(await openDocumentFile(t.db, "00000000-0000-4000-8000-000000000000", detail!.versions[0]!.id, storage)).toBeNull();
  });

  it("avvisa dei duplicati (stesso file o stessi dati) senza bloccare", async () => {
    const same = makePdf("verbale assemblea identico");
    const a = idOf(await create({ title: "Verbale A" }, { name: "verbale.pdf", bytes: same }));
    const b = idOf(await create({ title: "Verbale B" }, { name: "copia.pdf", bytes: same }));
    expect((await getDocumentDetail(t.db, b))?.duplicates).toEqual([{ documentId: a, title: "Verbale A", reason: "same_file" }]);

    const data = { title: "Certificato", issuerPartyId: issuerId, issuedOn: "2023-06-15" };
    const c = idOf(await create(data, { name: "c1.pdf", bytes: makePdf("uno") }));
    const d = idOf(await create(data, { name: "c2.pdf", bytes: makePdf("due") }));
    expect((await getDocumentDetail(t.db, d))?.duplicates).toEqual([{ documentId: c, title: "Certificato", reason: "same_data" }]);
  });

  it("modifica i metadati, i beni collegati e registra nell'audit solo i nomi dei campi", async () => {
    const id = idOf(await create({ title: "Da modificare" }, { name: "m.pdf", bytes: makePdf("parola segretissima") }));
    const updated = await run((uow) =>
      updateDocument(uow, id, { title: "Modificato", categoryId, confidentiality: "reserved", assetIds: [assetId], verificationStatus: "verified_by_owner" }),
    );
    expect(updated.ok).toBe(true);
    const detail = await getDocumentDetail(t.db, id);
    expect(detail).toMatchObject({ title: "Modificato", confidentiality: "reserved", assets: [{ id: assetId }] });
    expect(detail?.versions[0]?.verificationStatus).toBe("verified_by_owner");
    expect((await listDocuments(t.db, { confidentiality: "reserved" })).map((d) => d.id)).toContain(id);
    expect((await listDocuments(t.db, { verificationStatus: "verified_by_owner" })).map((d) => d.id)).toContain(id);

    const rows = await t.db.select().from(auditLog).where(eq(auditLog.entityId, id));
    const serialized = JSON.stringify(rows);
    expect(serialized).toContain("document.update");
    expect(serialized).not.toContain("segretissima");
    expect(rows.find((r) => r.action === "document.update")?.diff).toMatchObject({ changed: expect.arrayContaining(["title", "confidentiality", "verificationStatus"]), assetsChanged: true });
  });

  it("archivia senza cancellare e si puo' ripristinare", async () => {
    const id = idOf(await create({ title: "Da archiviare" }, { name: "x.pdf", bytes: makePdf("x") }));
    await run((uow) => setDocumentArchived(uow, id, true));
    expect((await listDocuments(t.db, {})).map((d) => d.id)).not.toContain(id);
    expect((await listDocuments(t.db, { includeArchived: true })).map((d) => d.id)).toContain(id);
    expect(await openDocumentFile(t.db, id, (await getDocumentDetail(t.db, id))!.versions[0]!.id, storage)).not.toBeNull();
    await run((uow) => setDocumentArchived(uow, id, false));
    expect((await listDocuments(t.db, {})).map((d) => d.id)).toContain(id);
  });

  it("se la scrittura nel database fallisce, rimuove il file dallo storage", async () => {
    const before = (await files()).length;
    const failing = {
      ...drizzleDocumentRepository(t.db),
      insertDocument: async () => {
        throw new Error("guasto simulato");
      },
    };
    await expect(
      createDocumentUseCase(
        {
          repo: failing,
          others: { assets: async () => [], parties: async () => [] },
          storage,
          extractor: { extract: async () => null },
          audit: { record: async () => undefined },
        },
        { title: "Guasto", categoryId },
        { name: "g.pdf", bytes: makePdf("guasto") },
      ),
    ).rejects.toThrow("guasto simulato");
    expect((await files()).length).toBe(before);
  });
});
