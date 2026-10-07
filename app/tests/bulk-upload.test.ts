import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { LocalFileStorage } from "@/platform/storage";
import { createDocument, findDocumentsWithSameFile, listDocumentCategories } from "@/modules/documents";
import { MAX_TITLE_LENGTH, titleFromFilename } from "@/app/(app)/documenti/carica-piu/title-from-filename";
import { createTestDb, type TestDb } from "./helpers/test-db";
import { makePdf } from "./helpers/sample-pdf";

describe("titolo proposto dal nome del file", () => {
  it.each([
    ["contratto affitto.pdf", "contratto affitto"],
    ["Contratto_di__affitto--2024.PDF", "Contratto di affitto 2024"],
    ["  spazi   in   mezzo .pdf", "spazi in mezzo"],
    ["senza-estensione", "senza estensione"],
    ["archivio.tar.gz", "archivio.tar"],
    ["C:\\Users\\x\\scansione_01.jpg", "scansione 01"],
    ["cartella/sotto/visura.pdf", "visura"],
    ["tab\tinterno\nnome.pdf", "tab interno nome"],
    [".pdf", "pdf"],
    ["___---.pdf", "Documento"],
    ["", "Documento"],
    ["perché è così.pdf", "perché è così"],
  ])("%j -> %j", (name, expected) => {
    expect(titleFromFilename(name)).toBe(expected);
  });

  it("non supera la lunghezza massima, nemmeno con caratteri fuori dal piano base", () => {
    const long = titleFromFilename(`${"a".repeat(500)}.pdf`);
    expect(long).toHaveLength(MAX_TITLE_LENGTH);
    const emoji = titleFromFilename(`${"😀".repeat(300)}.pdf`);
    expect(Array.from(emoji)).toHaveLength(MAX_TITLE_LENGTH);
  });

  it("con nomi ostili restituisce comunque testo semplice", () => {
    expect(titleFromFilename("<img src=x onerror=alert(1)>.pdf")).toBe("<img src=x onerror=alert(1)>");
    expect(titleFromFilename("../../etc/passwd")).toBe("passwd");
    expect(titleFromFilename("..")).toBe("Documento");
  });
});

describe("file gia' presente (stesso criterio dell'avviso sui duplicati)", () => {
  let t: TestDb;
  let dir: string;
  let storage: LocalFileStorage;
  let categoryId: string;
  const actor = { type: "owner", id: "o1" } as const;

  beforeAll(async () => {
    t = await createTestDb();
    dir = await mkdtemp(join(tmpdir(), "bulk-test-"));
    storage = new LocalFileStorage(dir);
    categoryId = (await listDocumentCategories(t.db))[0]!.id;
  });
  afterAll(async () => {
    await t.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("trova il documento con gli stessi byte e non uno con byte diversi", async () => {
    const bytes = makePdf("Documento uguale");
    const created = await runInUnitOfWork(t.db, actor, (uow) =>
      createDocument(uow, { title: "Originale", categoryId }, { name: "a.pdf", bytes }, storage),
    );
    expect(created.ok).toBe(true);
    const same = await findDocumentsWithSameFile(t.db, new Uint8Array(bytes));
    expect(same.map((m) => m.title)).toEqual(["Originale"]);
    expect(await findDocumentsWithSameFile(t.db, makePdf("Altro testo"))).toEqual([]);
  });

  it("dopo un secondo caricamento forzato restituisce il documento una volta sola per ciascuno", async () => {
    const bytes = makePdf("Documento ripetuto");
    for (const title of ["Primo", "Secondo"]) {
      const r = await runInUnitOfWork(t.db, actor, (uow) => createDocument(uow, { title, categoryId }, { name: "r.pdf", bytes }, storage));
      expect(r.ok).toBe(true);
    }
    const found = await findDocumentsWithSameFile(t.db, bytes);
    expect(found.map((m) => m.title).sort()).toEqual(["Primo", "Secondo"]);
  });
});
