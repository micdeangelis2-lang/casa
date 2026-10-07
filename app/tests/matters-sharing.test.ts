import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { auditLog, fileObject, territory } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { LocalFileStorage } from "@/platform/storage";
import { createAsset } from "@/modules/assets";
import { createDocument, listDocumentCategories, updateDocument } from "@/modules/documents";
import { createParty } from "@/modules/directory";
import { addOpinion, addRequest, assignParty, createMatter, getMatterDetail, linkMatterDocument, listMatters, resolveRequest, unassignParty, unlinkMatterDocument, updateMatter } from "@/modules/matters";
import { candidateDocuments, createPackage, documentSharingHistory, getPackageDetail, listPackages, packageStream, preparePackageDownload, revokePackage, type IndexLabels } from "@/modules/sharing";
import { buildCsv, buildIndexHtml, exceedsCap, safeFileName } from "@/modules/sharing/domain/sharing";
import { importIstat } from "@/modules/territory";
import { unzipStream } from "@/shared/archive/zip";
import { createTestDb, type TestDb } from "./helpers/test-db";
import { makePdf } from "./helpers/sample-pdf";

const actor = { type: "owner", id: "o1" } as const;
const owner = { displayName: "Proprietario Prova", email: "prova@example.test" };
const TODAY = "2026-06-15";

const labels: IndexLabels = {
  recipient: { administrator: "Amministratore", technician: "Tecnico", lawyer: "Avvocato", notary: "Notaio", accountant: "Commercialista", insurer: "Assicuratore", tenant: "Inquilino", manager: "Gestore", agent: "Agente immobiliare", other: "Altro" },
  confidentiality: { ordinary: "Ordinario", reserved: "Riservato", highly_reserved: "Altamente riservato" },
  verification: { draft: "Bozza", to_verify: "Da verificare", verified_by_owner: "Verificato da me", validated_by_professional: "Validato da un professionista" },
};

describe("pratiche", () => {
  let t: TestDb;
  let dir: string;
  let storage: LocalFileStorage;
  let assetId: string;
  let lawyerId: string;
  let surveyorId: string;
  let documentId: string;
  const run = <T>(work: Parameters<typeof runInUnitOfWork<T>>[2]) => runInUnitOfWork(t.db, actor, work);
  const okValue = <V>(r: { ok: boolean; value?: V }): V => {
    if (!r.ok) throw new Error(`atteso successo: ${JSON.stringify(r)}`);
    return r.value as V;
  };

  beforeAll(async () => {
    t = await createTestDb();
    dir = await mkdtemp(join(tmpdir(), "matters-test-"));
    storage = new LocalFileStorage(dir);
    await run((uow) => importIstat(uow, [{ regionCode: "90", regionName: "Regione di prova", provinceCode: "900", provinceName: "Provincia di prova", provinceSigla: "PP", municipalityCode: "900001", municipalityName: "Comune Uno", cadastralCode: "Z101" }]));
    const municipalityId = (await t.db.select().from(territory).where(eq(territory.kind, "municipality")))[0]!.id;
    assetId = okValue(await run((uow) => createAsset(uow, owner, { kind: "dwelling", name: "Bene della pratica", territoryId: municipalityId }))).id;
    lawyerId = okValue(await run((uow) => createParty(uow, { displayName: "Avvocato Esempio", roles: ["lawyer"] }))).id;
    surveyorId = okValue(await run((uow) => createParty(uow, { displayName: "Geometra Esempio", roles: ["surveyor"] }))).id;
    const categoryId = (await listDocumentCategories(t.db))[0]!.id;
    documentId = okValue(await run((uow) => createDocument(uow, { title: "Relazione tecnica", categoryId }, { name: "relazione.pdf", bytes: makePdf("relazione") }, storage))).id;
  }, 60_000);
  afterAll(async () => {
    await t.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("apre una pratica, la collega a un bene e la chiude con la data di chiusura", async () => {
    const id = okValue(await run((uow) => createMatter(uow, { title: "Verifica difformità", description: "Da controllare", assetId }, TODAY))).id;
    expect(await getMatterDetail(t.db, id)).toMatchObject({ title: "Verifica difformità", status: "open", openedOn: TODAY, closedOn: null, assetName: "Bene della pratica" });

    await run((uow) => updateMatter(uow, id, { title: "Verifica difformità", status: "in_progress", assetId }, "2026-06-20"));
    expect(await getMatterDetail(t.db, id)).toMatchObject({ status: "in_progress", closedOn: null });
    await run((uow) => updateMatter(uow, id, { title: "Verifica difformità", status: "closed", assetId }, "2026-07-01"));
    expect(await getMatterDetail(t.db, id)).toMatchObject({ status: "closed", closedOn: "2026-07-01" });
    expect((await listMatters(t.db)).map((m) => m.id)).not.toContain(id);
    expect((await listMatters(t.db, { includeClosed: true })).map((m) => m.id)).toContain(id);
    await run((uow) => updateMatter(uow, id, { title: "Verifica difformità", status: "waiting", assetId }, "2026-07-02"));
    expect(await getMatterDetail(t.db, id)).toMatchObject({ status: "waiting", closedOn: null });

    expect(await run((uow) => createMatter(uow, { title: " " }, TODAY))).toMatchObject({ ok: false, errors: { title: expect.any(Array) } });
    expect(await run((uow) => createMatter(uow, { title: "X", assetId: "00000000-0000-4000-8000-000000000000" }, TODAY))).toMatchObject({ ok: false, errors: { assetId: expect.any(Array) } });
  });

  it("assegna uno o piu' contatti e li toglie", async () => {
    const id = okValue(await run((uow) => createMatter(uow, { title: "Con incarichi" }, TODAY))).id;
    await run((uow) => assignParty(uow, id, { partyId: lawyerId, role: "legale" }));
    await run((uow) => assignParty(uow, id, { partyId: surveyorId }));
    expect((await getMatterDetail(t.db, id))!.assignments.map((a) => [a.name, a.role])).toEqual([["Avvocato Esempio", "legale"], ["Geometra Esempio", null]]);
    expect((await listMatters(t.db)).find((m) => m.id === id)!.assignees).toEqual(["Avvocato Esempio", "Geometra Esempio"]);
    await run((uow) => assignParty(uow, id, { partyId: lawyerId, role: "difensore" })); // aggiorna il ruolo
    expect((await getMatterDetail(t.db, id))!.assignments).toHaveLength(2);
    await run((uow) => unassignParty(uow, id, surveyorId));
    expect((await getMatterDetail(t.db, id))!.assignments.map((a) => a.name)).toEqual(["Avvocato Esempio"]);
    expect(await run((uow) => assignParty(uow, id, { partyId: "00000000-0000-4000-8000-000000000000" }))).toMatchObject({ ok: false, errors: { partyId: expect.any(Array) } });
  });

  it("richiede documenti: ricevuto con il documento lo collega alla pratica, non disponibile no", async () => {
    const id = okValue(await run((uow) => createMatter(uow, { title: "Richieste" }, TODAY))).id;
    await run((uow) => addRequest(uow, id, { title: "Planimetria aggiornata", requestedFromPartyId: surveyorId, dueOn: "2026-07-10" }, TODAY));
    await run((uow) => addRequest(uow, id, { title: "Titolo edilizio" }, TODAY));
    const [first, second] = (await getMatterDetail(t.db, id))!.requests;
    expect(first).toMatchObject({ title: "Planimetria aggiornata", status: "requested", requestedFromName: "Geometra Esempio", dueOn: "2026-07-10", requestedOn: TODAY });

    expect(await run((uow) => resolveRequest(uow, first!.id, { status: "received", documentId: "00000000-0000-4000-8000-000000000000" }))).toMatchObject({ ok: false, errors: { documentId: expect.any(Array) } });
    await run((uow) => resolveRequest(uow, first!.id, { status: "received", documentId }));
    await run((uow) => resolveRequest(uow, second!.id, { status: "not_available", documentId }));
    const detail = (await getMatterDetail(t.db, id))!;
    expect(detail.requests.map((r) => [r.status, r.documentTitle])).toEqual([["received", "Relazione tecnica"], ["not_available", null]]);
    expect(detail.documents).toEqual([{ id: documentId, title: "Relazione tecnica" }]);
    await run((uow) => resolveRequest(uow, first!.id, { status: "requested" })); // si riapre
    expect((await getMatterDetail(t.db, id))!.requests[0]).toMatchObject({ status: "requested", documentId: null });
  });

  it("registra pareri distinguendo informativi e validati formalmente, e li lega a un documento", async () => {
    const id = okValue(await run((uow) => createMatter(uow, { title: "Pareri" }, TODAY))).id;
    await run((uow) => addOpinion(uow, id, { partyId: lawyerId, nature: "informational", summary: "Parere di massima, non vincolante", issuedOn: "2026-06-10" }));
    await run((uow) => addOpinion(uow, id, { partyId: surveyorId, nature: "formally_validated", summary: "Relazione asseverata", documentId }));
    const opinions = (await getMatterDetail(t.db, id))!.opinions;
    expect(opinions.map((o) => [o.partyName, o.nature]).sort()).toEqual([["Avvocato Esempio", "informational"], ["Geometra Esempio", "formally_validated"]]);
    expect(opinions.find((o) => o.nature === "formally_validated")).toMatchObject({ documentTitle: "Relazione tecnica", summary: "Relazione asseverata" });
    expect(await run((uow) => addOpinion(uow, id, { partyId: lawyerId, summary: "Senza natura" }))).toMatchObject({ ok: false, errors: { nature: expect.any(Array) } });
    expect(await run((uow) => addOpinion(uow, id, { partyId: lawyerId, nature: "informational", summary: " " }))).toMatchObject({ ok: false, errors: { summary: expect.any(Array) } });
  });

  it("collega e scollega documenti, e l'audit non contiene testi ne' nomi", async () => {
    const id = okValue(await run((uow) => createMatter(uow, { title: "Documenti" }, TODAY))).id;
    await run((uow) => linkMatterDocument(uow, id, documentId));
    expect((await getMatterDetail(t.db, id))!.documents).toHaveLength(1);
    await run((uow) => unlinkMatterDocument(uow, id, documentId));
    expect((await getMatterDetail(t.db, id))!.documents).toHaveLength(0);
    const rows = await t.db.select().from(auditLog).where(sql`${auditLog.action} like 'matter.%'`);
    const actions = new Set(rows.map((r) => r.action));
    for (const a of ["matter.create", "matter.update", "matter.assign", "matter.unassign", "matter.request.add", "matter.request.resolve", "matter.opinion.add", "matter.document.link", "matter.document.unlink"]) expect(actions, a).toContain(a);
    const text = JSON.stringify(rows);
    for (const secret of ["Parere di massima", "Relazione asseverata", "Planimetria aggiornata", "Verifica difformità", "Avvocato Esempio"]) expect(text, secret).not.toContain(secret);
  });
});

describe("pacchetti documentali", () => {
  let t: TestDb;
  let dir: string;
  let storage: LocalFileStorage;
  let assetId: string;
  let otherAssetId: string;
  let ordinaryId: string;
  let reservedId: string;
  let secretId: string;
  let archivedId: string;
  const run = <T>(work: Parameters<typeof runInUnitOfWork<T>>[2]) => runInUnitOfWork(t.db, actor, work);
  const okValue = <V>(r: { ok: boolean; value?: V }): V => {
    if (!r.ok) throw new Error(`atteso successo: ${JSON.stringify(r)}`);
    return r.value as V;
  };
  const collect = async (stream: AsyncIterable<Uint8Array>) => Buffer.concat(await Array.fromAsync(stream));
  const unzip = async (stream: AsyncIterable<Uint8Array>) => new Map((await Array.fromAsync(unzipStream(stream))).map((e) => [e.name, Buffer.from(e.data)]));

  beforeAll(async () => {
    t = await createTestDb();
    dir = await mkdtemp(join(tmpdir(), "sharing-test-"));
    storage = new LocalFileStorage(dir);
    await run((uow) => importIstat(uow, [{ regionCode: "90", regionName: "Regione di prova", provinceCode: "900", provinceName: "Provincia di prova", provinceSigla: "PP", municipalityCode: "900001", municipalityName: "Comune Uno", cadastralCode: "Z101" }]));
    const municipalityId = (await t.db.select().from(territory).where(eq(territory.kind, "municipality")))[0]!.id;
    assetId = okValue(await run((uow) => createAsset(uow, owner, { kind: "dwelling", name: "Bene A", territoryId: municipalityId }))).id;
    otherAssetId = okValue(await run((uow) => createAsset(uow, owner, { kind: "dwelling", name: "Bene B", territoryId: municipalityId }))).id;
    const categories = await listDocumentCategories(t.db);
    const doc = async (title: string, filename: string, text: string, extra: Record<string, unknown>, categoryId = categories[0]!.id) =>
      okValue(await run((uow) => createDocument(uow, { title, categoryId, ...extra }, { name: filename, bytes: makePdf(text) }, storage))).id;
    ordinaryId = await doc("Atto ordinario", "atto.pdf", "atto", { assetIds: [assetId], issuedOn: "2020-05-01" });
    reservedId = await doc("Perizia riservata", "../../etc/perizia segreta.pdf", "perizia", { assetIds: [assetId, otherAssetId], confidentiality: "reserved" }, categories[1]!.id);
    secretId = await doc("Documento sanitario", "sanitario.pdf", "sanitario", { assetIds: [otherAssetId], confidentiality: "highly_reserved" });
    archivedId = await doc("Documento archiviato", "archiviato.pdf", "archiviato", { assetIds: [assetId] });
    await run((uow) => updateDocument(uow, ordinaryId, { title: "Atto ordinario", categoryId: categories[0]!.id, confidentiality: "ordinary", assetIds: [assetId], verificationStatus: "verified_by_owner", issuedOn: "2020-05-01" }));
    const { setDocumentArchived } = await import("@/modules/documents");
    await run((uow) => setDocumentArchived(uow, archivedId, true));
  }, 60_000);
  afterAll(async () => {
    await t.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("l'ordine dei livelli di riservatezza e i nomi di file sicuri", () => {
    expect(exceedsCap("reserved", "ordinary")).toBe(true);
    expect(exceedsCap("ordinary", "reserved")).toBe(false);
    expect(exceedsCap("reserved", "reserved")).toBe(false);
    expect(exceedsCap("highly_reserved", "reserved")).toBe(true);
    expect(safeFileName("../../etc/passwd")).toBe("etc_passwd");
    expect(safeFileName("perizia segreta è nuova.pdf")).toBe("perizia_segreta_e_nuova.pdf");
    expect(safeFileName("...")).toBe("documento");
    expect(safeFileName("x".repeat(300)).length).toBeLessThanOrEqual(80);
  });

  it("propone i documenti per bene e categoria e segnala quelli oltre il livello scelto", async () => {
    const all = await candidateDocuments(t.db, {}, "ordinary");
    expect(all.map((d) => d.title).sort()).toEqual(["Atto ordinario", "Documento sanitario", "Perizia riservata"]);
    expect(all.find((d) => d.title === "Perizia riservata")).toMatchObject({ exceedsCap: true, assetNames: expect.arrayContaining(["Bene A", "Bene B"]) });
    expect(all.find((d) => d.title === "Atto ordinario")!.exceedsCap).toBe(false);
    expect((await candidateDocuments(t.db, { assetIds: [otherAssetId] }, "reserved")).map((d) => [d.title, d.exceedsCap]).sort()).toEqual([["Documento sanitario", true], ["Perizia riservata", false]]);
    const categoryId = all.find((d) => d.title === "Perizia riservata")!.categoryId;
    expect((await candidateDocuments(t.db, { categoryIds: [categoryId] }, "reserved")).map((d) => d.title)).toEqual(["Perizia riservata"]);
  });

  it("un documento oltre il tetto non entra senza una scelta esplicita; archiviati e inesistenti mai", async () => {
    const make = (documents: unknown[], cap = "ordinary") => run((uow) => createPackage(uow, { recipientType: "accountant", recipientName: "Studio Prova", confidentialityCap: cap, documents }));
    expect(await make([{ documentId: ordinaryId }, { documentId: reservedId }])).toMatchObject({ ok: false, errors: { documents: [expect.stringContaining("supera il livello di riservatezza")] } });
    expect(await make([{ documentId: archivedId }])).toMatchObject({ ok: false, errors: { documents: [expect.stringContaining("archiviato")] } });
    expect(await make([{ documentId: "00000000-0000-4000-8000-000000000000" }])).toMatchObject({ ok: false, errors: { documents: expect.any(Array) } });
    expect(await make([])).toMatchObject({ ok: false, errors: { documents: expect.any(Array) } });
    expect(await run((uow) => createPackage(uow, { recipientType: "boh", recipientName: " ", confidentialityCap: "x", documents: [{ documentId: ordinaryId }] }))).toMatchObject({ ok: false, errors: { recipientType: expect.any(Array), recipientName: expect.any(Array), confidentialityCap: expect.any(Array) } });
  });

  it("crea un pacchetto registrando destinatario, contenuto, impronte e documenti inclusi oltre il livello", async () => {
    const id = okValue(
      await run((uow) =>
        createPackage(uow, { recipientType: "accountant", recipientName: "Studio <b>Prova</b>", confidentialityCap: "ordinary", note: "Per la dichiarazione", documents: [{ documentId: ordinaryId }, { documentId: reservedId, overrideAboveCap: true }] }, new Date("2026-06-15T10:00:00Z")),
      ),
    ).id;
    const detail = (await getPackageDetail(t.db, id))!;
    expect(detail.package).toMatchObject({ recipientType: "accountant", confidentialityCap: "ordinary", fileCount: 2, revoked: false });
    expect(detail.package.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(detail.items.map((i) => [i.title, i.overrideAboveCap, i.confidentiality])).toEqual([["Atto ordinario", false, "ordinary"], ["Perizia riservata", true, "reserved"]]);
    expect(detail.items[0]!.path).toBe("files/001-atto.pdf");
    expect(detail.items[1]!.path).toBe("files/002-etc_perizia_segreta.pdf");
    const [{ sha256 }] = await t.db.select({ sha256: fileObject.sha256 }).from(fileObject).limit(1);
    expect(detail.items.every((i) => /^[0-9a-f]{64}$/.test(i.sha256)) && sha256).toBeTruthy();
    expect(detail.log.map((l) => l.event)).toEqual(["created"]);
    expect((await listPackages(t.db))[0]).toMatchObject({ id, downloads: 0 });
  });

  it("il file ZIP contiene indice, manifest, elenco e i file identici agli originali, e si registra lo scarico", async () => {
    const packages = await listPackages(t.db);
    const id = packages[0]!.id;
    const download = okValue(await run((uow) => preparePackageDownload(uow, id)));
    expect(download.filename).toMatch(/^pacchetto-\d{4}-\d{2}-\d{2}-studio_b_prova_b_\.zip$/);

    const files = await unzip(await packageStream(t.db, download, labels, storage));
    expect([...files.keys()]).toEqual(["INDEX.html", "manifest.json", "elenco.csv", "files/001-atto.pdf", "files/002-etc_perizia_segreta.pdf"]);

    const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
    const manifest = JSON.parse(files.get("manifest.json")!.toString("utf8")) as { format: string; recipient: { name: string }; confidentialityCap: string; files: { path: string; sha256: string; includedAboveCap: boolean; verificationStatus: string }[] };
    expect(manifest).toMatchObject({ format: "gestione-immobili-package", recipient: { name: "Studio <b>Prova</b>" }, confidentialityCap: "ordinary" });
    for (const entry of manifest.files) expect(sha(files.get(entry.path)!), entry.path).toBe(entry.sha256);
    expect(manifest.files.map((f) => [f.includedAboveCap, f.verificationStatus])).toEqual([[false, "verified_by_owner"], [true, "to_verify"]]);
    expect(createHash("sha256").update(files.get("manifest.json")!).digest("hex")).toBe(download.package.manifestSha256);

    const html = files.get("INDEX.html")!.toString("utf8");
    expect(html).toContain("Studio &lt;b&gt;Prova&lt;/b&gt;");
    expect(html).not.toContain("<b>Prova</b>");
    expect(html).not.toContain("<script");
    expect(html).toContain("incluso oltre il livello scelto");
    expect(html).toContain("Non attesta la conformità");
    expect(html).toContain("Da verificare");
    const csv = files.get("elenco.csv")!.toString("utf8");
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"Atto ordinario"');
    expect(csv.split("\r\n")[0]).toContain("SHA-256");

    expect((await getPackageDetail(t.db, id))!.log.map((l) => l.event).sort()).toEqual(["created", "downloaded"]);
    expect((await listPackages(t.db)).find((p) => p.id === id)!.downloads).toBe(1);
  });

  it("l'indice HTML e il CSV si proteggono da testo malevolo", () => {
    const item = { path: "files/001-x.pdf", title: '"><script>alert(1)</script>', categoryName: "<img src=x>", confidentiality: "ordinary" as const, issuerName: "A & B", issuedOn: null, validFrom: null, validTo: null, verificationStatus: "to_verify", mimeType: "application/pdf", sizeBytes: 1, sha256: "a".repeat(64), overrideAboveCap: false, assetNames: [] };
    const manifest = { createdAt: "2026-06-15T00:00:00.000Z", recipientType: "lawyer" as const, recipientName: "<script>x</script>", confidentialityCap: "ordinary" as const, note: "<i>n</i>", items: [item] };
    const html = buildIndexHtml(manifest, labels);
    expect(html).not.toMatch(/<script|<img|<i>/);
    expect(html).toContain("&lt;script&gt;");
    expect(buildCsv([{ ...item, title: 'a "b";c' }])).toContain('"a ""b"";c"');
  });

  it("un pacchetto revocato non si scarica piu' e la revoca resta nel registro", async () => {
    const id = (await listPackages(t.db))[0]!.id;
    await run((uow) => revokePackage(uow, id));
    expect(await run((uow) => preparePackageDownload(uow, id))).toMatchObject({ ok: false, errors: { _: ["Il pacchetto è stato revocato"] } });
    expect((await getPackageDetail(t.db, id))!.package.revoked).toBe(true);
    expect((await getPackageDetail(t.db, id))!.log.map((l) => l.event)).toContain("revoked");
    expect(await run((uow) => revokePackage(uow, "00000000-0000-4000-8000-000000000000"))).toMatchObject({ ok: false });
  });

  it("se un file e' stato alterato dopo la creazione, lo scarico fallisce invece di consegnare altro", async () => {
    const id = okValue(await run((uow) => createPackage(uow, { recipientType: "lawyer", recipientName: "Legale", confidentialityCap: "reserved", documents: [{ documentId: ordinaryId }] }))).id;
    const download = okValue(await run((uow) => preparePackageDownload(uow, id)));
    const rows = (await t.db.execute(sql`select storage_key from file_object fo join document_version dv on dv.file_object_id = fo.id where dv.document_id = ${ordinaryId}`)) as unknown as { rows: { storage_key: string }[] };
    await writeFile(join(dir, rows.rows[0]!.storage_key), Buffer.from("alterato"));
    await expect(collect(await packageStream(t.db, download, labels, storage))).rejects.toThrow("impronta");
  });

  it("la storia di un documento dice in quali pacchetti e' stato incluso, quando e per chi", async () => {
    const history = await documentSharingHistory(t.db, reservedId);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ override: true, package: { recipientType: "accountant", recipientName: "Studio <b>Prova</b>", confidentialityCap: "ordinary" } });
    expect((await documentSharingHistory(t.db, ordinaryId)).length).toBe(2);
    expect(await documentSharingHistory(t.db, secretId)).toEqual([]);
  });

  it("l'audit registra destinatario (tipo), conteggi e livello, non nomi ne' titoli", async () => {
    const rows = await t.db.select().from(auditLog).where(sql`${auditLog.action} like 'share.%'`);
    expect(new Set(rows.map((r) => r.action))).toEqual(new Set(["share.create", "share.download", "share.revoke"]));
    const text = JSON.stringify(rows);
    for (const secret of ["Studio", "Legale", "Atto ordinario", "Perizia", "dichiarazione"]) expect(text, secret).not.toContain(secret);
    expect(rows.find((r) => r.action === "share.create" && (r.diff as { aboveCap: number }).aboveCap === 1)!.diff).toMatchObject({ recipientType: "accountant", files: 2, cap: "ordinary", aboveCap: 1 });
  });
});
