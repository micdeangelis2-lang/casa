import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { auditLog, deadline, deadlineOccurrence, documentCategory, managementMandate, territory } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { LocalFileStorage } from "@/platform/storage";
import { createAsset } from "@/modules/assets";
import { addEngagement, addListingEvent, listEngagements, updateEngagement, updateListingEvent } from "@/modules/agent";
import { addCompetence, createParty, listCompetences, updateCompetence } from "@/modules/directory";
import {
  SUGGESTED_CATEGORY_NAME,
  addDocumentCategory,
  createDocument,
  listDocumentCategories,
  listDocumentCategoryUsage,
  moveDocumentCategory,
  removeDocumentCategory,
  renameDocumentCategory,
} from "@/modules/documents";
import { createRule } from "@/modules/rules";
import { createMandate, listMandates, updateMandate } from "@/modules/management";
import { addEncumbrance, addProvenance, listEncumbrances, listProvenances, updateEncumbrance, updateProvenance } from "@/modules/notary";
import { importIstat } from "@/modules/territory";
import { createTestDb, type TestDb } from "./helpers/test-db";
import { makePdf } from "./helpers/sample-pdf";

const actor = { type: "owner", id: "o1" } as const;
const owner = { displayName: "Proprietario Prova", email: "prova@example.test" };
const TODAY = "2026-10-06";
const MISSING = "00000000-0000-4000-8000-000000000000";

describe("interfacce di modifica: casi d'uso", () => {
  let t: TestDb;
  let dir: string;
  let storage: LocalFileStorage;
  let assetId: string;
  let otherAssetId: string;
  let partyA: string;
  let partyB: string;
  let docId: string;
  let categoryId: string;
  const run = <T>(work: Parameters<typeof runInUnitOfWork<T>>[2]) => runInUnitOfWork(t.db, actor, work);
  const okValue = <V>(r: { ok: boolean; value?: V }): V => {
    if (!r.ok) throw new Error(`atteso successo: ${JSON.stringify(r)}`);
    return r.value as V;
  };
  const auditFor = async (action: string) => (await t.db.select().from(auditLog)).filter((a) => a.action === action);

  beforeAll(async () => {
    t = await createTestDb();
    dir = await mkdtemp(join(tmpdir(), "edit-ui-test-"));
    storage = new LocalFileStorage(dir);
    await run((uow) => importIstat(uow, [{ regionCode: "90", regionName: "Regione di prova", provinceCode: "900", provinceName: "Provincia di prova", provinceSigla: "PP", municipalityCode: "900001", municipalityName: "Comune Uno", cadastralCode: "Z101" }]));
    const municipalityId = (await t.db.select().from(territory).where(eq(territory.kind, "municipality")))[0]!.id;
    assetId = okValue(await run((uow) => createAsset(uow, owner, { kind: "dwelling", name: "Casa Modificata", territoryId: municipalityId }))).id;
    otherAssetId = okValue(await run((uow) => createAsset(uow, owner, { kind: "dwelling", name: "Altra Casa", territoryId: municipalityId }))).id;
    partyA = okValue(await run((uow) => createParty(uow, { displayName: "Contatto Alfa" }))).id;
    partyB = okValue(await run((uow) => createParty(uow, { displayName: "Contatto Beta" }))).id;
    categoryId = (await listDocumentCategories(t.db))[0]!.id;
    docId = okValue(await run((uow) => createDocument(uow, { title: "Atto collegato", categoryId }, { name: "atto.pdf", bytes: makePdf("atto") }, storage))).id;
  }, 60_000);
  afterAll(async () => {
    await t.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("modifica la provenienza con le stesse regole della registrazione; l'audit riporta solo i nomi dei campi", async () => {
    okValue(await run((uow) => addProvenance(uow, { assetId, kind: "purchase", occurredOn: "2010-05-01", fromPartyId: partyA, deedReference: "REP-SEGRETO-1", note: "Nota riservata" })));
    const [row] = await listProvenances(t.db, assetId);

    expect(await run((uow) => updateProvenance(uow, MISSING, { assetId, kind: "purchase" }))).toMatchObject({ ok: false });
    expect(await run((uow) => updateProvenance(uow, row!.id, { assetId, kind: "boh" }))).toMatchObject({ ok: false, errors: { kind: expect.any(Array) } });
    expect(await run((uow) => updateProvenance(uow, row!.id, { assetId, kind: "purchase", fromPartyId: MISSING }))).toMatchObject({ ok: false, errors: { partyId: expect.any(Array) } });
    expect(await run((uow) => updateProvenance(uow, row!.id, { assetId, kind: "purchase", documentId: MISSING }))).toMatchObject({ ok: false, errors: { documentId: expect.any(Array) } });
    // Un titolo non si sposta su un altro immobile con una modifica.
    expect(await run((uow) => updateProvenance(uow, row!.id, { assetId: otherAssetId, kind: "purchase" }))).toMatchObject({ ok: false });
    expect(await listProvenances(t.db, otherAssetId)).toEqual([]);

    expect(okValue(await run((uow) => updateProvenance(uow, row!.id, { assetId, kind: "donation", occurredOn: "2011-06-02", fromPartyId: partyB, notaryPartyId: partyA, deedReference: "REP-SEGRETO-2", documentId: docId, note: "" })))).toEqual({ id: assetId });
    const [after] = await listProvenances(t.db, assetId);
    expect(after).toMatchObject({ id: row!.id, kind: "donation", occurredOn: "2011-06-02", fromName: "Contatto Beta", notaryName: "Contatto Alfa", documentTitle: "Atto collegato", deedReference: "REP-SEGRETO-2", note: null });

    const audits = await auditFor("notary.provenance.update");
    expect(audits).toHaveLength(1);
    expect(audits[0]!.diff).toMatchObject({ changed: expect.arrayContaining(["kind", "occurredOn", "fromPartyId", "notaryPartyId", "deedReference", "documentId", "note"]) });
    expect(JSON.stringify(audits.map((a) => a.diff))).not.toMatch(/SEGRETO|riservata/);
  });

  it("modifica un gravame: date coerenti, importo non negativo, beneficiario e documento esistenti", async () => {
    okValue(await run((uow) => addEncumbrance(uow, { assetId, kind: "mortgage", title: "Ipoteca prova", registeredOn: "2015-01-01", beneficiaryPartyId: partyA, amount: "100.000,00", reference: "NOTA-SEGRETA" })));
    const [row] = await listEncumbrances(t.db, assetId);

    expect(await run((uow) => updateEncumbrance(uow, row!.id, { assetId, kind: "mortgage", title: " " }))).toMatchObject({ ok: false, errors: { title: expect.any(Array) } });
    expect(await run((uow) => updateEncumbrance(uow, row!.id, { assetId, kind: "mortgage", title: "X", registeredOn: "2020-01-01", endedOn: "2019-01-01" }))).toMatchObject({ ok: false, errors: { endedOn: expect.any(Array) } });
    expect(await run((uow) => updateEncumbrance(uow, row!.id, { assetId, kind: "mortgage", title: "X", amount: "-5" }))).toMatchObject({ ok: false, errors: { amount: expect.any(Array) } });
    expect(await run((uow) => updateEncumbrance(uow, row!.id, { assetId, kind: "mortgage", title: "X", beneficiaryPartyId: MISSING }))).toMatchObject({ ok: false });
    expect(await run((uow) => updateEncumbrance(uow, MISSING, { assetId, kind: "mortgage", title: "X" }))).toMatchObject({ ok: false });
    expect(await run((uow) => updateEncumbrance(uow, row!.id, { assetId: otherAssetId, kind: "mortgage", title: "X" }))).toMatchObject({ ok: false });

    okValue(await run((uow) => updateEncumbrance(uow, row!.id, { assetId, kind: "easement", title: "Servitù di prova", registeredOn: "2015-01-01", endedOn: "2022-03-04", beneficiaryPartyId: partyB, amount: "", reference: "NOTA-SEGRETA-2", documentId: docId })));
    const [after] = await listEncumbrances(t.db, assetId);
    expect(after).toMatchObject({ id: row!.id, kind: "easement", title: "Servitù di prova", endedOn: "2022-03-04", beneficiaryName: "Contatto Beta", amountCents: null, documentTitle: "Atto collegato" });

    const audits = await auditFor("notary.encumbrance.update");
    expect(audits).toHaveLength(1);
    expect(audits[0]!.diff).toMatchObject({ changed: expect.arrayContaining(["kind", "title", "amountCents"]) });
    expect(JSON.stringify(audits.map((a) => a.diff))).not.toMatch(/SEGRETA|Servitù/);
  });

  it("modifica un mandato di vendita o affitto e le sue visite e proposte; lo stato resta", async () => {
    const engagementId = okValue(await run((uow) => addEngagement(uow, { assetId, kind: "sale", agentPartyId: partyA, startsOn: "2026-01-01", endsOn: "2026-12-31", asking: "250.000", commission: "COMMISSIONE-SEGRETA 3%" })));
    const [created] = await listEngagements(t.db, assetId);
    expect(engagementId).toEqual({ id: assetId });

    expect(await run((uow) => updateEngagement(uow, MISSING, { assetId, kind: "sale" }))).toMatchObject({ ok: false });
    expect(await run((uow) => updateEngagement(uow, created!.id, { assetId, kind: "boh" }))).toMatchObject({ ok: false, errors: { kind: expect.any(Array) } });
    expect(await run((uow) => updateEngagement(uow, created!.id, { assetId, kind: "sale", startsOn: "2026-05-01", endsOn: "2026-04-01" }))).toMatchObject({ ok: false, errors: { endsOn: expect.any(Array) } });
    expect(await run((uow) => updateEngagement(uow, created!.id, { assetId, kind: "sale", agentPartyId: MISSING }))).toMatchObject({ ok: false });
    expect(await run((uow) => updateEngagement(uow, created!.id, { assetId, kind: "sale", asking: "-1" }))).toMatchObject({ ok: false, errors: { asking: expect.any(Array) } });
    expect(await run((uow) => updateEngagement(uow, created!.id, { assetId: otherAssetId, kind: "sale" }))).toMatchObject({ ok: false });

    okValue(await run((uow) => updateEngagement(uow, created!.id, { assetId, kind: "rent", agentPartyId: partyB, startsOn: "2026-02-01", endsOn: "2027-01-31", exclusive: true, asking: "900,00", commission: "COMMISSIONE-SEGRETA 4%", documentId: docId, note: "" })));
    const [after] = await listEngagements(t.db, assetId);
    expect(after).toMatchObject({ id: created!.id, kind: "rent", status: "active", exclusive: true, askingCents: 90_000, agentName: "Contatto Beta", documentTitle: "Atto collegato", startsOn: "2026-02-01", endsOn: "2027-01-31", note: null });
    const audits = await auditFor("agent.engagement.update");
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits.map((a) => a.diff))).not.toMatch(/SEGRETA/);

    okValue(await run((uow) => addListingEvent(uow, created!.id, { kind: "visit", occurredOn: "2026-03-01", contactPartyId: partyA, note: "NOTA-VISITA-SEGRETA" })));
    okValue(await run((uow) => addListingEvent(uow, created!.id, { kind: "proposal", occurredOn: "2026-03-10", amount: "240.000" })));
    const events = (await listEngagements(t.db, assetId))[0]!.events;
    const visit = events.find((e) => e.kind === "visit")!;
    const proposal = events.find((e) => e.kind === "proposal")!;

    expect(await run((uow) => updateListingEvent(uow, MISSING, { kind: "visit", occurredOn: "2026-03-01" }))).toMatchObject({ ok: false });
    expect(await run((uow) => updateListingEvent(uow, visit.id, { kind: "boh", occurredOn: "2026-03-01" }))).toMatchObject({ ok: false, errors: { kind: expect.any(Array) } });
    expect(await run((uow) => updateListingEvent(uow, visit.id, { kind: "visit", occurredOn: "" }))).toMatchObject({ ok: false, errors: { occurredOn: expect.any(Array) } });
    expect(await run((uow) => updateListingEvent(uow, visit.id, { kind: "visit", occurredOn: "2026-03-01", amount: "10" }))).toMatchObject({ ok: false, errors: { amount: expect.any(Array) } });
    expect(await run((uow) => updateListingEvent(uow, visit.id, { kind: "note", occurredOn: "2026-03-01", outcome: "accepted" }))).toMatchObject({ ok: false, errors: { outcome: expect.any(Array) } });
    expect(await run((uow) => updateListingEvent(uow, visit.id, { kind: "visit", occurredOn: "2026-03-01", contactPartyId: MISSING }))).toMatchObject({ ok: false });

    expect(okValue(await run((uow) => updateListingEvent(uow, proposal.id, { kind: "counterproposal", occurredOn: "2026-03-12", amount: "245.000,50", outcome: "open", contactPartyId: partyB, note: "NOTA-NUOVA-SEGRETA" })))).toEqual({ id: assetId });
    const after2 = (await listEngagements(t.db, assetId))[0]!;
    expect(after2.events.find((e) => e.id === proposal.id)).toMatchObject({ kind: "counterproposal", occurredOn: "2026-03-12", amountCents: 24_500_050, outcome: "open", contactName: "Contatto Beta" });
    expect(after2.counts).toEqual({ visits: 1, proposals: 1 });
    const evAudits = await auditFor("agent.engagement.event.update");
    expect(evAudits).toHaveLength(1);
    expect(JSON.stringify(evAudits.map((a) => a.diff))).not.toMatch(/SEGRETA/);
  });

  it("modifica un mandato di gestione e sposta la data aperta della scadenza collegata", async () => {
    const id = okValue(await run((uow) => createMandate(uow, { managerPartyId: partyA, assetId, startsOn: "2026-01-01", endsOn: "2026-11-15", compensation: "COMPENSO-SEGRETO 8%", note: "Nota" }))).id;
    const [row] = await t.db.select().from(managementMandate).where(eq(managementMandate.id, id));
    const deadlineId = row!.deadlineId!;

    expect(await run((uow) => updateMandate(uow, MISSING, { managerPartyId: partyA, endsOn: "2026-11-15" }))).toMatchObject({ ok: false });
    expect(await run((uow) => updateMandate(uow, id, { managerPartyId: MISSING, endsOn: "2026-11-15" }))).toMatchObject({ ok: false, errors: { managerPartyId: expect.any(Array) } });
    expect(await run((uow) => updateMandate(uow, id, { managerPartyId: partyA, endsOn: "2026-11-15", documentId: MISSING }))).toMatchObject({ ok: false, errors: { documentId: expect.any(Array) } });
    expect(await run((uow) => updateMandate(uow, id, { managerPartyId: partyA, assetId: MISSING, endsOn: "2026-11-15" }))).toMatchObject({ ok: false, errors: { assetId: expect.any(Array) } });
    expect(await run((uow) => updateMandate(uow, id, { managerPartyId: partyA, startsOn: "2026-12-01", endsOn: "2026-11-15" }))).toMatchObject({ ok: false, errors: { endsOn: expect.any(Array) } });
    expect(await run((uow) => updateMandate(uow, id, { managerPartyId: partyA }))).toMatchObject({ ok: false, errors: { endsOn: expect.any(Array) } });

    okValue(await run((uow) => updateMandate(uow, id, { managerPartyId: partyB, assetId: otherAssetId, startsOn: "2026-02-01", endsOn: "2026-12-20", compensation: "COMPENSO-SEGRETO 9%", documentId: docId, note: "" })));
    const [m] = await listMandates(t.db, TODAY);
    expect(m).toMatchObject({ id, managerPartyId: partyB, managerName: "Contatto Beta", assetId: otherAssetId, assetName: "Altra Casa", endsOn: "2026-12-20", compensation: "COMPENSO-SEGRETO 9%", documentId: docId, note: null, deadlineId });

    const [linked] = await t.db.select().from(deadline).where(eq(deadline.id, deadlineId));
    expect(linked).toMatchObject({ title: "Mandato di gestione: Contatto Beta (Altra Casa)", assetId: otherAssetId, professionalPartyId: partyB });
    expect(linked!.description).toContain("COMPENSO-SEGRETO 9%");
    const occurrences = await t.db.select().from(deadlineOccurrence).where(eq(deadlineOccurrence.deadlineId, deadlineId));
    expect(occurrences.filter((o) => o.status === "open").map((o) => o.dueOn)).toEqual(["2026-12-20"]);
    expect(occurrences.filter((o) => o.status === "cancelled").map((o) => o.dueOn)).toEqual(["2026-11-15"]);

    // Senza cambiare la data di fine non si toccano le date del promemoria.
    okValue(await run((uow) => updateMandate(uow, id, { managerPartyId: partyB, assetId: otherAssetId, endsOn: "2026-12-20", compensation: "" })));
    expect((await t.db.select().from(deadlineOccurrence).where(and(eq(deadlineOccurrence.deadlineId, deadlineId), eq(deadlineOccurrence.status, "open")))).map((o) => o.dueOn)).toEqual(["2026-12-20"]);

    const audits = await auditFor("management.mandate.update");
    expect(audits).toHaveLength(2);
    expect(JSON.stringify(audits.map((a) => a.diff))).not.toMatch(/SEGRETO/);
  });

  it("modifica una competenza di un contatto", async () => {
    const partyId = partyA;
    okValue(await run((uow) => addCompetence(uow, partyId, { kind: "registration", label: "Albo prova", reference: "N-SEGRETO-1", validUntil: "2026-12-31" })));
    const [row] = await listCompetences(t.db, partyId, TODAY);

    expect(await run((uow) => updateCompetence(uow, MISSING, { kind: "registration", label: "x" }))).toMatchObject({ ok: false });
    expect(await run((uow) => updateCompetence(uow, row!.id, { kind: "titolo", label: "x" }))).toMatchObject({ ok: false, errors: { kind: expect.any(Array) } });
    expect(await run((uow) => updateCompetence(uow, row!.id, { kind: "registration", label: " " }))).toMatchObject({ ok: false, errors: { label: expect.any(Array) } });
    expect(await run((uow) => updateCompetence(uow, row!.id, { kind: "insurance", label: "x", validFrom: "2026-05-01", validUntil: "2026-04-01" }))).toMatchObject({ ok: false, errors: { validUntil: expect.any(Array) } });
    expect(await run((uow) => updateCompetence(uow, row!.id, { kind: "insurance", label: "x", documentId: MISSING }))).toMatchObject({ ok: false, errors: { documentId: expect.any(Array) } });

    expect(okValue(await run((uow) => updateCompetence(uow, row!.id, { kind: "insurance", label: "Polizza prova", reference: "N-SEGRETO-2", issuer: "Compagnia", validFrom: "2026-01-01", validUntil: "2026-10-20", documentId: docId, note: "" })))).toEqual({ id: partyId });
    const [after] = await listCompetences(t.db, partyId, TODAY);
    expect(after).toMatchObject({ id: row!.id, kind: "insurance", label: "Polizza prova", issuer: "Compagnia", documentId: docId, note: null, state: "expiring" });
    const audits = await auditFor("directory.competence.update");
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits.map((a) => a.diff))).not.toMatch(/SEGRETO/);
  });

  it("categorie documentali: aggiunge (anche «Fotografie»), rinomina senza cambiare il codice, riordina, rimuove solo se libera", async () => {
    const before = await listDocumentCategoryUsage(t.db);
    const seeded = before.find((c) => c.protected && c.documents > 0) ?? before.find((c) => c.id === categoryId)!;
    expect(before.every((c) => typeof c.name === "string")).toBe(true);

    expect(await run((uow) => addDocumentCategory(uow, { name: "  " }))).toMatchObject({ ok: false, errors: { name: expect.any(Array) } });
    expect(await run((uow) => addDocumentCategory(uow, { name: seeded.name.toUpperCase() }))).toMatchObject({ ok: false, errors: { name: expect.any(Array) } });

    const photosId = okValue(await run((uow) => addDocumentCategory(uow, { name: SUGGESTED_CATEGORY_NAME }))).id;
    const [photos] = await t.db.select().from(documentCategory).where(eq(documentCategory.id, photosId));
    expect(photos).toMatchObject({ code: "fotografie", name: "Fotografie" });
    expect(await run((uow) => addDocumentCategory(uow, { name: "fotografie" }))).toMatchObject({ ok: false, errors: { name: expect.any(Array) } });
    // Stesso codice ricavato da un altro nome: si distingue con un suffisso.
    const second = okValue(await run((uow) => addDocumentCategory(uow, { name: "Fotografie!" }))).id;
    expect((await t.db.select().from(documentCategory).where(eq(documentCategory.id, second)))[0]!.code).toBe("fotografie_2");

    // Rinomina: cambia il nome, il codice resta (anche per le categorie seminate).
    const seededCode = (await t.db.select().from(documentCategory).where(eq(documentCategory.id, seeded.id)))[0]!.code;
    okValue(await run((uow) => renameDocumentCategory(uow, seeded.id, { name: "Nome cambiato" })));
    expect((await t.db.select().from(documentCategory).where(eq(documentCategory.id, seeded.id)))[0]).toMatchObject({ code: seededCode, name: "Nome cambiato" });
    okValue(await run((uow) => renameDocumentCategory(uow, seeded.id, { name: seeded.name })));
    expect(await run((uow) => renameDocumentCategory(uow, photosId, { name: seeded.name }))).toMatchObject({ ok: false, errors: { name: expect.any(Array) } });
    expect(await run((uow) => renameDocumentCategory(uow, MISSING, { name: "Altro" }))).toMatchObject({ ok: false });
    okValue(await run((uow) => renameDocumentCategory(uow, photosId, { name: "Fotografie" })));

    // Riordino: si scambia con la precedente; sul bordo non cambia nulla.
    const names = async () => (await listDocumentCategories(t.db)).map((c) => c.id);
    const order = await names();
    const last = order.at(-1)!;
    okValue(await run((uow) => moveDocumentCategory(uow, last, "up")));
    const moved = await names();
    expect(moved.at(-2)).toBe(last);
    expect(moved.at(-1)).toBe(order.at(-2));
    okValue(await run((uow) => moveDocumentCategory(uow, moved[0]!, "up")));
    expect(await names()).toEqual(moved);
    expect(await run((uow) => moveDocumentCategory(uow, last, "sideways"))).toMatchObject({ ok: false });
    expect(await run((uow) => moveDocumentCategory(uow, MISSING, "up"))).toMatchObject({ ok: false });

    // Rimozione: non per le seminate, non per quelle con documenti, sì per una libera.
    expect(await run((uow) => removeDocumentCategory(uow, seeded.id))).toMatchObject({ ok: false });
    expect((await listDocumentCategoryUsage(t.db)).find((c) => c.id === photosId)).toMatchObject({ documents: 0, protected: false, removable: true });
    await run((uow) => createDocument(uow, { title: "Foto del bagno", categoryId: photosId }, { name: "foto.pdf", bytes: makePdf("foto") }, storage));
    expect((await listDocumentCategoryUsage(t.db)).find((c) => c.id === photosId)).toMatchObject({ documents: 1, removable: false });
    expect(await run((uow) => removeDocumentCategory(uow, photosId))).toMatchObject({ ok: false, errors: { _: [expect.stringContaining("documenti")] } });
    // Una regola che richiama la categoria per codice ne impedisce la rimozione (le versioni delle regole non si cambiano).
    const ruled = okValue(await run((uow) => addDocumentCategory(uow, { name: "Per regola" }))).id;
    okValue(await run((uow) => createRule(uow, { title: "Regola con foto", level: "national", sourceText: "Esempio", outcomes: [{ type: "checklist", key: "foto", title: "Foto", dossierCategory: "cadastre", expectedDocumentCategory: "per_regola" }] })));
    expect((await listDocumentCategoryUsage(t.db)).find((c) => c.id === ruled)).toMatchObject({ references: 1, removable: false });
    expect(await run((uow) => removeDocumentCategory(uow, ruled))).toMatchObject({ ok: false, errors: { _: [expect.stringContaining("regole")] } });
    okValue(await run((uow) => removeDocumentCategory(uow, second)));
    expect(await run((uow) => removeDocumentCategory(uow, second))).toMatchObject({ ok: false });
    expect((await t.db.select().from(documentCategory)).some((c) => c.id === second)).toBe(false);

    const audits = (await t.db.select().from(auditLog)).filter((a) => a.action.startsWith("documents.category."));
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["documents.category.add", "documents.category.rename", "documents.category.move", "documents.category.remove"]));
    expect(JSON.stringify(audits.map((a) => a.diff))).not.toMatch(/Fotografie|Nome cambiato/);
  });
});
