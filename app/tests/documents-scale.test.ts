import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { countDocuments, documentTitles, listDocumentCategories, listDocumentOptions, listDocuments, PICKER_LIMIT } from "@/modules/documents";
import { createTestDb, type TestDb } from "./helpers/test-db";

/**
 * Prestazioni su molti documenti (requisito: veloce su elenchi grandi). Si inseriscono 5.000 documenti con una versione e un
 * testo ciascuno, direttamente nel database, e si misurano le letture usate dalle pagine. I limiti sono volutamente larghi
 * (PGlite in memoria, macchine diverse): servono a prendere una regressione grossolana, non a misurare al millisecondo.
 */

const TOTAL = 5000;

describe("molti documenti", () => {
  let t: TestDb;
  const timed = async <T>(work: () => Promise<T>): Promise<{ value: T; ms: number }> => {
    const start = performance.now();
    const value = await work();
    return { value, ms: performance.now() - start };
  };

  beforeAll(async () => {
    t = await createTestDb();
    const categoryId = (await listDocumentCategories(t.db))[0]!.id;
    await t.db.execute(sql`insert into file_object (storage_key, sha256, size_bytes, mime_type) select 'chiave-' || g, md5(g::text), 1000 + g, 'application/pdf' from generate_series(1, ${TOTAL}) g`);
    await t.db.execute(sql`insert into document (title, category_id, updated_at) select 'Documento ' || lpad(g::text, 5, '0'), ${categoryId}, now() - (g || ' minutes')::interval from generate_series(1, ${TOTAL}) g`);
    await t.db.execute(sql`
      insert into document_version (document_id, version_no, file_object_id, original_filename, extracted_text)
      select d.id, 1, f.id, 'file-' || d.title || '.pdf', case when d.title = 'Documento 04321' then 'contratto di locazione con clausola particolare' else 'testo generico del documento numero ' || d.title end
      from (select id, title from document) d
      join file_object f on f.storage_key = 'chiave-' || ltrim(substr(d.title, 11), '0')`);
  }, 120_000);
  afterAll(async () => {
    await t.close();
  });

  it("l'elenco paginato e il conteggio sono rapidi e coerenti, dal piu' recente", async () => {
    const count = await timed(() => countDocuments(t.db));
    expect(count.value).toBe(TOTAL);
    expect(count.ms).toBeLessThan(3000);

    const firstPage = await timed(() => listDocuments(t.db, { limit: 50, offset: 0 }));
    expect(firstPage.value).toHaveLength(50);
    expect(firstPage.value[0]!.title).toBe("Documento 00001");
    expect(firstPage.ms).toBeLessThan(3000);
    console.info(`[prestazioni] ${TOTAL} documenti: conteggio ${count.ms.toFixed(0)} ms, prima pagina ${firstPage.ms.toFixed(0)} ms`);

    const lastPage = await listDocuments(t.db, { limit: 50, offset: TOTAL - 20 });
    expect(lastPage).toHaveLength(20);
    expect(lastPage.at(-1)!.title).toBe(`Documento ${String(TOTAL).padStart(5, "0")}`);
    // Pagine consecutive non si sovrappongono.
    const second = await listDocuments(t.db, { limit: 50, offset: 50 });
    expect(new Set([...firstPage.value, ...second].map((d) => d.id)).size).toBe(100);
  });

  it("la ricerca per titolo e per testo trova il documento e il conteggio segue i filtri", async () => {
    const byTitle = await timed(() => listDocuments(t.db, { query: "04999", limit: 50 }));
    expect(byTitle.value.map((d) => d.title)).toEqual(["Documento 04999"]);
    expect(byTitle.ms).toBeLessThan(5000);

    const byText = await timed(() => listDocuments(t.db, { query: "clausola particolare", limit: 50 }));
    expect(byText.value.map((d) => d.title)).toEqual(["Documento 04321"]);
    expect(byText.ms).toBeLessThan(5000);
    expect(await countDocuments(t.db, { query: "clausola particolare" })).toBe(1);
    expect(await countDocuments(t.db, { query: "documento" })).toBe(TOTAL);
  });

  it("i titoli per identificativo e le opzioni dei menu non leggono l'intero archivio con tutte le versioni", async () => {
    const some = (await listDocuments(t.db, { limit: 3 })).map((d) => d.id);
    const titles = await timed(() => documentTitles(t.db, some));
    expect([...titles.value.values()]).toHaveLength(3);
    expect(titles.ms).toBeLessThan(1000);
    expect((await documentTitles(t.db, [])).size).toBe(0);
    expect((await listDocuments(t.db, { ids: some })).map((d) => d.id).sort()).toEqual([...some].sort());
    expect(await listDocuments(t.db, { ids: [] })).toEqual([]);

    const options = await timed(() => listDocumentOptions(t.db));
    expect(options.value).toHaveLength(PICKER_LIMIT);
    expect(options.value[0]).toEqual({ value: expect.any(String), label: "Documento 00001" });
    expect(options.ms).toBeLessThan(2000);
    expect(await listDocumentOptions(t.db, 5)).toHaveLength(5);
  });
});
