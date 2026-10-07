import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { auditLog, territory } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { LocalFileStorage } from "@/platform/storage";
import { createAsset } from "@/modules/assets";
import { createDocument, listDocumentCategories } from "@/modules/documents";
import { createPackage, getPackageDetail, packageStream, preparePackageDownload, SHEET_KINDS, type IndexLabels } from "@/modules/sharing";
import { buildCsv, buildIndexHtml, buildManifest, packageInputSchema } from "@/modules/sharing/domain/sharing";
import { parseCsv, renderSheetHtml } from "@/modules/sharing/domain/sheet";
import { importIstat } from "@/modules/territory";
import { csvDocument } from "@/shared/csv";
import { unzipStream } from "@/shared/archive/zip";
import { createTestDb, type TestDb } from "./helpers/test-db";
import { makePdf } from "./helpers/sample-pdf";

const actor = { type: "owner", id: "o1" } as const;
const owner = { displayName: "Proprietario Prova", email: "prova@example.test" };

const labels: IndexLabels = {
  recipient: { administrator: "Amministratore", technician: "Tecnico", lawyer: "Avvocato", notary: "Notaio", accountant: "Commercialista", insurer: "Assicuratore", tenant: "Inquilino", manager: "Gestore", agent: "Agente immobiliare", other: "Altro" },
  confidentiality: { ordinary: "Ordinario", reserved: "Riservato", highly_reserved: "Altamente riservato" },
  verification: { draft: "Bozza", to_verify: "Da verificare", verified_by_owner: "Verificato da me", validated_by_professional: "Validato da un professionista" },
};

/** Una scheda di prova nel formato dei CSV dell'app, con testi pericolosi (formula, HTML) e date ISO. */
const sheetCsv = csvDocument([
  ["Scheda per il notaio: Bene A"],
  ["Preparata con i dati registrati. Non attesta la conformità."],
  [],
  ["Titolarità registrata"],
  ["Titolare", "Quota", "Dal", "Note"],
  ["Mario <b>Rossi</b>", "1/2", "2020-05-01", '=HYPERLINK("http://esempio.test")'],
  ["Anna; Bianchi", "1/2", "", "riga\ncon a capo"],
  [],
  ["Documenti per categoria"],
  ["Categoria", "Titolo"],
  ["Titoli", "Atto ordinario"],
]);

describe("scheda in HTML: dal CSV alla pagina", () => {
  it("legge il CSV dell'app (BOM, virgolette, a capo, punto e virgola dentro il testo)", () => {
    const rows = parseCsv(sheetCsv);
    expect(rows[0]).toEqual(["Scheda per il notaio: Bene A"]);
    expect(rows[5]).toEqual(["Mario <b>Rossi</b>", "1/2", "2020-05-01", `'=HYPERLINK("http://esempio.test")`]);
    expect(rows[6]).toEqual(["Anna; Bianchi", "1/2", "", "riga\ncon a capo"]);
    expect(parseCsv(csvDocument([["a;b", 'c"d', "e\r\nf", 3.5]]))).toEqual([["a;b", 'c"d', "e\r\nf", "3,5"]]);
  });

  it("la pagina e' autonoma: niente script, niente risorse o collegamenti esterni, testo protetto, date gg/mm/aaaa, formule senza apice", () => {
    const html = renderSheetHtml({ title: "Scheda <script>alert(1)</script>", csv: sheetCsv }, { createdAt: "2026-06-15T10:00:00.000Z", recipientName: "Studio <i>Notarile</i>", recipientLabel: "Notaio", capLabel: "Ordinario" });
    expect(html).not.toMatch(/<script|<img|<iframe|<link|<i>|<b>/i);
    expect(html).not.toMatch(/\bsrc\s*=|@import|url\(/i);
    expect(html).not.toMatch(/href\s*=\s*["']?(https?:)?\/\//i);
    expect(html).toContain("Mario &lt;b&gt;Rossi&lt;/b&gt;");
    expect(html).toContain("01/05/2020");
    expect(html).toContain("=HYPERLINK(");
    expect(html).not.toContain("'=HYPERLINK");
    expect(html).toContain("<h2>Titolarità registrata</h2>");
    expect(html).toContain("<th>Titolare</th>");
    expect(html).toContain("Livello massimo di riservatezza scelto:</strong> Ordinario");
    expect(html).toContain("Non attesta la conformità");
    expect(html).toContain("15/06/2026");
  });

  it("i CSV senza titolo (la cronologia) diventano comunque una tabella", () => {
    const html = renderSheetHtml({ title: "Cronologia", csv: csvDocument([["Data", "Fonte"], ["2026-01-02", "Pratica"]]) }, { createdAt: "2026-06-15T10:00:00.000Z", recipientName: "Avv.", recipientLabel: "Avvocato", capLabel: "Ordinario" });
    expect(html).toContain("<th>Data</th>");
    expect(html).toContain("<td>02/01/2026</td>");
  });

  it("i tipi di scheda sono quelli dei destinatari previsti", () => {
    expect([...SHEET_KINDS].sort()).toEqual(["accountant", "agent", "insurer", "lawyer", "manager", "notary", "technical"]);
  });
});

describe("pacchetto con scheda", () => {
  let t: TestDb;
  let dir: string;
  let storage: LocalFileStorage;
  let ordinaryId: string;
  let reservedId: string;
  const run = <T>(work: Parameters<typeof runInUnitOfWork<T>>[2]) => runInUnitOfWork(t.db, actor, work);
  const okValue = <V>(r: { ok: boolean; value?: V }): V => {
    if (!r.ok) throw new Error(`atteso successo: ${JSON.stringify(r)}`);
    return r.value as V;
  };
  const unzip = async (stream: AsyncIterable<Uint8Array>) => new Map((await Array.fromAsync(unzipStream(stream))).map((e) => [e.name, Buffer.from(e.data)]));
  const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

  beforeAll(async () => {
    t = await createTestDb();
    dir = await mkdtemp(join(tmpdir(), "sheet-sharing-test-"));
    storage = new LocalFileStorage(dir);
    await run((uow) => importIstat(uow, [{ regionCode: "90", regionName: "Regione di prova", provinceCode: "900", provinceName: "Provincia di prova", provinceSigla: "PP", municipalityCode: "900001", municipalityName: "Comune Uno", cadastralCode: "Z101" }]));
    const municipalityId = (await t.db.select().from(territory).where(eq(territory.kind, "municipality")))[0]!.id;
    const assetId = okValue(await run((uow) => createAsset(uow, owner, { kind: "dwelling", name: "Bene A", territoryId: municipalityId }))).id;
    const categories = await listDocumentCategories(t.db);
    const doc = async (title: string, filename: string, extra: Record<string, unknown>) =>
      okValue(await run((uow) => createDocument(uow, { title, categoryId: categories[0]!.id, assetIds: [assetId], ...extra }, { name: filename, bytes: makePdf(title) }, storage))).id;
    ordinaryId = await doc("Atto ordinario", "atto.pdf", {});
    reservedId = await doc("Perizia riservata", "perizia.pdf", { confidentiality: "reserved" });
    await doc("Cartella sanitaria", "sanitaria.pdf", { confidentiality: "highly_reserved" });
  }, 60_000);
  afterAll(async () => {
    await t.close();
    await rm(dir, { recursive: true, force: true });
  });

  const base = { recipientType: "notary", recipientName: "Studio Notarile Prova", confidentialityCap: "ordinary" };
  const sheet = { kind: "notary" as const, title: "Scheda per il notaio: Bene A", csv: sheetCsv };

  it("lo ZIP contiene la scheda accanto a indice, manifest ed elenco; i documenti sopra il tetto non ci sono", async () => {
    const id = okValue(await run((uow) => createPackage(uow, { ...base, documents: [{ documentId: ordinaryId }] }, new Date("2026-06-15T10:00:00Z"), sheet))).id;
    const download = okValue(await run((uow) => preparePackageDownload(uow, id)));
    const files = await unzip(await packageStream(t.db, download, labels, storage));

    expect([...files.keys()]).toEqual(["INDEX.html", "manifest.json", "elenco.csv", "SCHEDA.html", "files/001-atto.pdf"]);
    const html = files.get("SCHEDA.html")!.toString("utf8");
    expect(html).toContain("Mario &lt;b&gt;Rossi&lt;/b&gt;");
    expect(html).toContain("Studio Notarile Prova");
    expect(html).toContain("Livello massimo di riservatezza scelto:</strong> Ordinario");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/\bsrc\s*=|@import|url\(/i);
    expect(html).not.toMatch(/href\s*=\s*["']?(https?:)?\/\//i);

    // Nessun documento sopra il tetto, ne' come file ne' per titolo in nessuna parte del pacchetto (fuori dai file veri e propri).
    const everything = [...files.entries()].filter(([name]) => !name.startsWith("files/")).map(([, data]) => data.toString("utf8")).join("\n");
    for (const hidden of ["Perizia riservata", "Cartella sanitaria", "perizia.pdf", "sanitaria.pdf"]) expect(everything, hidden).not.toContain(hidden);
    expect([...files.keys()].some((n) => /perizia|sanitaria/.test(n))).toBe(false);

    // Il registro del pacchetto elenca la scheda: manifest, elenco CSV, indice, dettaglio.
    const manifest = JSON.parse(files.get("manifest.json")!.toString("utf8")) as { sheet: { path: string; kind: string; title: string; contentSha256: string }; files: unknown[] };
    expect(manifest.sheet).toEqual({ path: "SCHEDA.html", kind: "notary", title: "Scheda per il notaio: Bene A", contentSha256: sha(sheetCsv) });
    expect(manifest.files).toHaveLength(1);
    expect(files.get("elenco.csv")!.toString("utf8").split("\r\n")[1]).toContain('"SCHEDA.html"');
    expect(files.get("INDEX.html")!.toString("utf8")).toContain('href="SCHEDA.html"');
    expect(sha(files.get("manifest.json")!)).toBe(download.package.manifestSha256);
    const detail = (await getPackageDetail(t.db, id))!;
    expect(detail.package.snapshot.sheet).toMatchObject({ kind: "notary", title: "Scheda per il notaio: Bene A", sha256: sha(sheetCsv) });
    expect(detail.package.fileCount).toBe(1);
  });

  it("un documento oltre il tetto resta escluso anche con la scheda, salvo scelta esplicita", async () => {
    const attempt = await run((uow) => createPackage(uow, { ...base, documents: [{ documentId: ordinaryId }, { documentId: reservedId }] }, new Date(), sheet));
    expect(attempt).toMatchObject({ ok: false, errors: { documents: [expect.stringContaining("supera il livello di riservatezza")] } });
  });

  it("un pacchetto puo' avere la sola scheda; senza documenti e senza scheda no", async () => {
    expect(await run((uow) => createPackage(uow, { ...base, documents: [] }, new Date()))).toMatchObject({ ok: false, errors: { documents: ["Scegli almeno un documento"] } });
    const insurerSheet = { kind: "insurer" as const, title: "Polizze per immobile", csv: csvDocument([["Polizze per immobile"], [], ["Immobili"], ["Immobile", "Situazione"], ["Bene A", "Nessuna polizza registrata"]]) };
    const id = okValue(await run((uow) => createPackage(uow, { ...base, recipientType: "insurer", documents: [] }, new Date(), insurerSheet))).id;
    const files = await unzip(await packageStream(t.db, okValue(await run((uow) => preparePackageDownload(uow, id))), labels, storage));
    expect([...files.keys()]).toEqual(["INDEX.html", "manifest.json", "elenco.csv", "SCHEDA.html"]);
    expect(files.get("SCHEDA.html")!.toString("utf8")).toContain("Nessuna polizza registrata");
  });

  it("senza scheda lo ZIP e il manifest restano come prima", async () => {
    const id = okValue(await run((uow) => createPackage(uow, { ...base, documents: [{ documentId: ordinaryId }] }))).id;
    const files = await unzip(await packageStream(t.db, okValue(await run((uow) => preparePackageDownload(uow, id))), labels, storage));
    expect([...files.keys()]).toEqual(["INDEX.html", "manifest.json", "elenco.csv", "files/001-atto.pdf"]);
    expect(JSON.parse(files.get("manifest.json")!.toString("utf8")).sheet).toBeNull();
    expect(files.get("INDEX.html")!.toString("utf8")).not.toContain("SCHEDA.html");
  });

  it("l'audit registra solo il tipo di scheda, mai il suo contenuto", async () => {
    const rows = await t.db.select().from(auditLog).where(sql`${auditLog.action} = 'share.create'`);
    expect(rows.some((r) => (r.diff as { sheet?: string }).sheet === "notary")).toBe(true);
    const text = JSON.stringify(rows);
    for (const secret of ["Mario", "Rossi", "HYPERLINK", "Studio Notarile", "Titolarità"]) expect(text, secret).not.toContain(secret);
  });

  it("funzioni pure: manifest, elenco e indice con la scheda", () => {
    const manifestInput = { createdAt: "2026-06-15T00:00:00.000Z", recipientType: "agent" as const, recipientName: "Agenzia", confidentialityCap: "ordinary" as const, note: null, items: [], sheet: { ...sheet, kind: "agent" as const, sha256: sha(sheetCsv) } };
    expect(JSON.parse(buildManifest(manifestInput)).sheet).toMatchObject({ path: "SCHEDA.html", kind: "agent" });
    expect(buildCsv([], manifestInput.sheet).split("\r\n")).toHaveLength(3);
    expect(buildIndexHtml(manifestInput, labels)).toContain("SCHEDA.html");
    expect(packageInputSchema.safeParse({ recipientType: "agent", recipientName: "A", confidentialityCap: "ordinary", documents: [] }).success).toBe(true);
  });
});
