import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { auditLog, territory } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { LocalFileStorage } from "@/platform/storage";
import { createAsset } from "@/modules/assets";
import {
  addAgendaItem,
  addMember,
  addProxy,
  addResolution,
  addWorkEntry,
  createBudget,
  createClaim,
  createCondominium,
  createContract,
  createFiscalYear,
  createMeeting,
  createResolutionDeadline,
  createTable,
  createWork,
  generateInstallments,
  getCondominiumDetail,
  getMeetingDetail,
  linkCondoDocument,
  linkResolutionBudget,
  listAssetsWithoutCondominium,
  listCondominiums,
  recordPayment,
  removeAgendaItem,
  removeMember,
  removeProxy,
  saveShares,
  setAgendaDocument,
  setCondominiumArchived,
  unlinkCondoDocument,
  updateAgendaItem,
  updateClaim,
  updateCondominium,
  updateMeeting,
  updateResolution,
  updateWork,
} from "@/modules/condominium";
import { getDeadlineDetail, listDeadlines } from "@/modules/deadlines";
import { createDocument, listDocumentCategories } from "@/modules/documents";
import { createParty } from "@/modules/directory";
import { createMatter } from "@/modules/matters";
import { importIstat } from "@/modules/territory";
import { createTestDb, type TestDb } from "./helpers/test-db";
import { makePdf } from "./helpers/sample-pdf";

const actor = { type: "owner", id: "o1" } as const;
const owner = { displayName: "Proprietario Prova", email: "prova@example.test" };
const TODAY = "2026-06-15";

describe("condominio", () => {
  let t: TestDb;
  let dir: string;
  let storage: LocalFileStorage;
  let assets: string[];
  let outsider: string;
  let adminId: string;
  let documentId: string;
  let condoId: string;
  let tableId: string;

  const run = <T>(work: Parameters<typeof runInUnitOfWork<T>>[2]) => runInUnitOfWork(t.db, actor, work);
  const okValue = <V>(r: { ok: boolean; value?: V }): V => {
    if (!r.ok) throw new Error(`atteso successo: ${JSON.stringify(r)}`);
    return r.value as V;
  };
  const detail = async () => (await getCondominiumDetail(t.db, condoId))!;
  const budget = async (title: string) => (await detail()).years.flatMap((y) => y.budgets).find((b) => b.title === title)!;

  beforeAll(async () => {
    t = await createTestDb();
    dir = await mkdtemp(join(tmpdir(), "condo-test-"));
    storage = new LocalFileStorage(dir);
    await run((uow) => importIstat(uow, [{ regionCode: "90", regionName: "Regione di prova", provinceCode: "900", provinceName: "Provincia di prova", provinceSigla: "PP", municipalityCode: "900001", municipalityName: "Comune Uno", cadastralCode: "Z101" }]));
    const municipalityId = (await t.db.select().from(territory).where(eq(territory.kind, "municipality")))[0]!.id;
    assets = [];
    for (const name of ["Unità A", "Unità B", "Unità C"]) assets.push(okValue(await run((uow) => createAsset(uow, owner, { kind: "dwelling", name, territoryId: municipalityId, inCondominium: true }))).id);
    outsider = okValue(await run((uow) => createAsset(uow, owner, { kind: "garage", name: "Fuori dal condominio", territoryId: municipalityId }))).id;
    adminId = okValue(await run((uow) => createParty(uow, { displayName: "Amministratore Esempio", roles: ["administrator"] }))).id;
    const categoryId = (await listDocumentCategories(t.db))[0]!.id;
    documentId = okValue(await run((uow) => createDocument(uow, { title: "Regolamento di prova", categoryId }, { name: "regolamento.pdf", bytes: makePdf("regolamento") }, storage))).id;
  }, 60_000);
  afterAll(async () => {
    await t.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("registra il condominio con l'amministratore e gli immobili che ne fanno parte, uno solo per immobile", async () => {
    condoId = okValue(await run((uow) => createCondominium(uow, { name: "Condominio Esempio", address: "Via Prova 1", administratorPartyId: adminId }))).id;
    expect(await run((uow) => createCondominium(uow, { name: " " }))).toMatchObject({ ok: false, errors: { name: expect.any(Array) } });
    expect(await run((uow) => createCondominium(uow, { name: "X", administratorPartyId: "00000000-0000-4000-8000-000000000000" }))).toMatchObject({ ok: false, errors: { administratorPartyId: expect.any(Array) } });

    for (const [i, id] of assets.entries()) expect(await run((uow) => addMember(uow, condoId, { assetId: id, unitLabel: `Interno ${i + 1}` }))).toMatchObject({ ok: true });
    expect(await run((uow) => addMember(uow, condoId, { assetId: assets[0] }))).toMatchObject({ ok: false, errors: { assetId: ["Questo immobile fa già parte del condominio"] } });
    const second = okValue(await run((uow) => createCondominium(uow, { name: "Altro condominio" }))).id;
    expect(await run((uow) => addMember(uow, second, { assetId: assets[0] }))).toMatchObject({ ok: false, errors: { assetId: ["Questo immobile fa già parte di un altro condominio"] } });

    expect((await listAssetsWithoutCondominium(t.db)).map((a) => a.name)).toEqual(["Fuori dal condominio"]);
    const d = await detail();
    expect(d).toMatchObject({ name: "Condominio Esempio", administratorName: "Amministratore Esempio" });
    expect(d.members.map((m) => [m.assetName, m.unitLabel])).toEqual([["Unità A", "Interno 1"], ["Unità B", "Interno 2"], ["Unità C", "Interno 3"]]);
    expect((await listCondominiums(t.db)).find((c) => c.id === condoId)).toMatchObject({ memberCount: 3, administratorName: "Amministratore Esempio" });

    await run((uow) => updateCondominium(uow, condoId, { name: "Condominio Esempio", address: "Via Prova 2", administratorPartyId: adminId }));
    expect((await detail()).address).toBe("Via Prova 2");
    await run((uow) => setCondominiumArchived(uow, second, true));
    expect((await listCondominiums(t.db)).map((c) => c.id)).not.toContain(second);
    expect((await listCondominiums(t.db, true)).map((c) => c.id)).toContain(second);
  });

  it("una tabella millesimale accetta valori con decimali, rifiuta quelli sbagliati e mostra la somma senza imporla", async () => {
    await run((uow) => createTable(uow, condoId, { name: "Proprietà generale" }));
    tableId = (await detail()).tables[0]!.id;
    const bad = await run((uow) => saveShares(uow, tableId, [{ assetId: assets[0], value: "abc" }, { assetId: outsider, value: "10" }]));
    expect(bad).toMatchObject({ ok: false, errors: { "shares.0": ["Millesimi non validi (es. 48,25)"], "shares.1": ["L'immobile non fa parte del condominio"] } });

    expect(await run((uow) => saveShares(uow, tableId, [{ assetId: assets[0], value: "333,3333" }, { assetId: assets[1], value: "333,3333" }, { assetId: assets[2], value: "333,3334" }]))).toMatchObject({ ok: true, value: { total: 10_000_000, differsFromThousand: false } });
    expect((await detail()).tables[0]).toMatchObject({ differsFromThousand: false, total: 10_000_000 });
    expect(await run((uow) => saveShares(uow, tableId, [{ assetId: assets[0], value: "500" }, { assetId: assets[1], value: "300" }, { assetId: assets[2], value: "" }]))).toMatchObject({ ok: true, value: { total: 8_000_000, differsFromThousand: true } });
    expect((await detail()).tables[0]!.shares.map((s) => s.assetName)).toEqual(expect.arrayContaining(["Unità A", "Unità B"]));
    // Valori finali per i test successivi: 500 / 300 / 200.
    await run((uow) => saveShares(uow, tableId, [{ assetId: assets[0], value: "500" }, { assetId: assets[1], value: "300" }, { assetId: assets[2], value: "200" }]));
  });

  it("il preventivo si ripartisce per millesimi senza perdere un centesimo e si divide in rate", async () => {
    okValue(await run((uow) => createFiscalYear(uow, condoId, { label: "2026", startsOn: "2026-01-01", endsOn: "2026-12-31" })));
    const yearRow = (await detail()).years[0]!;
    expect(await run((uow) => createFiscalYear(uow, condoId, { label: "x", startsOn: "2026-12-31", endsOn: "2026-01-01" }))).toMatchObject({ ok: false, errors: { endsOn: expect.any(Array) } });

    await run((uow) => createBudget(uow, yearRow.id, { kind: "ordinary", title: "Preventivo 2026", total: "10.000,01", millesimalTableId: tableId }));
    await run((uow) => createBudget(uow, yearRow.id, { kind: "extraordinary", title: "Senza tabella", total: "100" }));
    expect(await run((uow) => createBudget(uow, yearRow.id, { kind: "ordinary", title: "x", total: "abc" }))).toMatchObject({ ok: false, errors: { total: expect.any(Array) } });
    expect(await run((uow) => createBudget(uow, yearRow.id, { kind: "ordinary", title: "x", total: "1", millesimalTableId: "00000000-0000-4000-8000-000000000000" }))).toMatchObject({ ok: false, errors: { millesimalTableId: expect.any(Array) } });

    const b = await budget("Preventivo 2026");
    expect(await run((uow) => generateInstallments(uow, "00000000-0000-4000-8000-000000000000", { count: 1, firstDueOn: "2026-01-01", everyMonths: 1 }))).toMatchObject({ ok: false, errors: { _: ["Preventivo non trovato"] } });
    expect(await run((uow) => generateInstallments(uow, b.id, { count: 4, firstDueOn: "2026-01-31", everyMonths: 3 }))).toMatchObject({ ok: true, value: { created: 12, shareTotalCents: 1000001 } });
    const view = await budget("Preventivo 2026");
    expect(view.installments).toHaveLength(12);
    expect(view.installments.reduce((n, i) => n + i.amountCents, 0)).toBe(1000001); // esattamente il totale del preventivo
    const perAsset = (name: string) => view.installments.filter((i) => i.assetName === name).reduce((n, i) => n + i.amountCents, 0);
    expect([perAsset("Unità A"), perAsset("Unità B"), perAsset("Unità C")]).toEqual([500001, 300000, 200000]); // il centesimo avanzato va a chi ha il resto maggiore
    expect([...new Set(view.installments.map((i) => i.dueOn))].sort()).toEqual(["2026-01-31", "2026-04-30", "2026-07-31", "2026-10-31"]);
    expect(view.dueCents).toBe(1000001);

    const without = await budget("Senza tabella");
    expect(await run((uow) => generateInstallments(uow, without.id, { count: 2, firstDueOn: "2026-02-01", everyMonths: 1 }))).toMatchObject({ ok: false, errors: { _: [expect.stringContaining("tabella millesimale")] } });
    expect(await run((uow) => generateInstallments(uow, b.id, { count: 0, firstDueOn: "2026-01-31", everyMonths: 3 }))).toMatchObject({ ok: false, errors: { count: expect.any(Array) } });
  });

  it("rigenerare il piano sostituisce le rate; con le scadenze collegate un pagamento completo chiude la scadenza", async () => {
    const b = await budget("Preventivo 2026");
    expect(await run((uow) => generateInstallments(uow, b.id, { count: 2, firstDueOn: "2026-07-01", everyMonths: 1, createDeadlines: true }))).toMatchObject({ ok: true, value: { created: 6 } });
    const view = await budget("Preventivo 2026");
    expect(view.installments).toHaveLength(6);
    expect(view.installments.every((i) => i.deadlineId !== null)).toBe(true);
    const deadlines = await listDeadlines(t.db);
    expect(deadlines.filter((d) => d.category === "condominium" && d.title.startsWith("Rata"))).toHaveLength(6);
    expect(deadlines.find((d) => d.title.includes("Rata 1/2") && d.title.includes("Unità A"))).toMatchObject({ level: "condominium", assetId: assets[0] });

    const first = view.installments.find((i) => i.assetName === "Unità A" && i.number === 1)!;
    // Pagamento parziale: la rata non e' pagata e la scadenza resta aperta.
    await run((uow) => recordPayment(uow, first.id, { paid: "100", paidOn: "2026-07-02" }, TODAY));
    let after = (await budget("Preventivo 2026")).installments.find((i) => i.id === first.id)!;
    expect(after).toMatchObject({ paidCents: 10000, paid: false });
    expect((await getDeadlineDetail(t.db, first.deadlineId!, TODAY))!.occurrences[0]!.status).toBe("open");
    // Pagamento completo: la scadenza si chiude con un riferimento.
    await run((uow) => recordPayment(uow, first.id, { paid: (first.amountCents / 100).toFixed(2).replace(".", ","), paidOn: "2026-07-03" }, TODAY));
    after = (await budget("Preventivo 2026")).installments.find((i) => i.id === first.id)!;
    expect(after).toMatchObject({ paid: true, paidOn: "2026-07-03" });
    expect((await getDeadlineDetail(t.db, first.deadlineId!, TODAY))!.occurrences[0]).toMatchObject({ status: "done", completedOn: "2026-07-03" });
    expect((await budget("Preventivo 2026")).paidCents).toBe(first.amountCents);

    // Con rate gia' pagate non si rigenera il piano.
    expect(await run((uow) => generateInstallments(uow, b.id, { count: 3, firstDueOn: "2026-08-01", everyMonths: 1 }))).toMatchObject({ ok: false, errors: { _: [expect.stringContaining("già pagate")] } });
    expect(await run((uow) => recordPayment(uow, first.id, { paid: "abc" }, TODAY))).toMatchObject({ ok: false, errors: { paid: expect.any(Array) } });
  });

  it("assemblea: ordine del giorno, documenti da leggere, domande, deleghe e preparazione", async () => {
    const meetingId = okValue(await run((uow) => createMeeting(uow, condoId, { kind: "ordinary", convenedOn: "2026-06-01", meetingOn: "2026-06-25", location: "Sala comune" }))).id;
    expect(await run((uow) => createMeeting(uow, condoId, { kind: "boh", meetingOn: "2026-06-25" }))).toMatchObject({ ok: false, errors: { kind: expect.any(Array) } });
    await run((uow) => addAgendaItem(uow, meetingId, { title: "Approvazione del preventivo", questions: "Perché la voce spese legali è aumentata?" }));
    await run((uow) => addAgendaItem(uow, meetingId, { title: "Varie ed eventuali" }));
    await run((uow) => addAgendaItem(uow, meetingId, { title: "Punto da togliere" }));
    let m = (await getMeetingDetail(t.db, meetingId))!;
    expect(m.agenda.map((a) => [a.position, a.title])).toEqual([[1, "Approvazione del preventivo"], [2, "Varie ed eventuali"], [3, "Punto da togliere"]]);

    await run((uow) => setAgendaDocument(uow, m.agenda[0]!.id, documentId, true));
    await run((uow) => updateAgendaItem(uow, m.agenda[1]!.id, { title: "Varie", description: "Segnalazioni", questions: "Chiedere dell'ascensore" }));
    await run((uow) => removeAgendaItem(uow, m.agenda[2]!.id));
    expect(await run((uow) => setAgendaDocument(uow, m.agenda[0]!.id, "00000000-0000-4000-8000-000000000000", true))).toMatchObject({ ok: false });
    m = (await getMeetingDetail(t.db, meetingId))!;
    expect(m.agenda).toHaveLength(2);
    expect(m.preparation).toEqual({
      documentsToRead: [{ id: documentId, title: "Regolamento di prova", agendaTitle: "Approvazione del preventivo" }],
      questions: [{ agendaTitle: "Approvazione del preventivo", text: "Perché la voce spese legali è aumentata?" }, { agendaTitle: "Varie", text: "Chiedere dell'ascensore" }],
      itemsWithoutDocuments: ["Varie"],
    });

    await run((uow) => addProxy(uow, meetingId, { delegatePartyId: adminId, note: "Delega per il voto" }));
    expect((await getMeetingDetail(t.db, meetingId))!.proxies).toMatchObject([{ delegateName: "Amministratore Esempio", note: "Delega per il voto" }]);
    const proxyId = (await getMeetingDetail(t.db, meetingId))!.proxies[0]!.id;
    await run((uow) => removeProxy(uow, meetingId, proxyId));
    expect((await getMeetingDetail(t.db, meetingId))!.proxies).toEqual([]);
    await run((uow) => updateMeeting(uow, meetingId, { kind: "ordinary", status: "held", meetingOn: "2026-06-25", minutesDocumentId: documentId }));
    expect(await getMeetingDetail(t.db, meetingId)).toMatchObject({ status: "held", minutesTitle: "Regolamento di prova", condominiumName: "Condominio Esempio" });
  });

  it("delibere: i voti si confrontano con la soglia scritta dall'utente, senza dire se e' valida, e hanno un seguito", async () => {
    const meetingId = (await detail()).meetings[0]!.id;
    const agendaId = (await getMeetingDetail(t.db, meetingId))!.agenda[0]!.id;
    await run((uow) => addResolution(uow, meetingId, { title: "Approvato il preventivo", agendaItemId: agendaId, outcome: "approved", votesFor: "600", votesAgainst: "200", votesAbstain: "50", threshold: "500", thresholdNote: "Soglia indicata dal verbale" }));
    await run((uow) => addResolution(uow, meetingId, { title: "Lavori straordinari", outcome: "approved", votesFor: "400", threshold: "500" }));
    expect(await run((uow) => addResolution(uow, meetingId, { title: "x", votesFor: "abc" }))).toMatchObject({ ok: false, errors: { votesFor: expect.any(Array) } });
    expect(await run((uow) => addResolution(uow, meetingId, { title: "x", agendaItemId: "00000000-0000-4000-8000-000000000000" }))).toMatchObject({ ok: false, errors: { agendaItemId: expect.any(Array) } });

    let resolutions = (await getMeetingDetail(t.db, meetingId))!.resolutions;
    const [ok1, doubtful] = resolutions;
    expect(ok1).toMatchObject({ title: "Approvato il preventivo", agendaTitle: "Approvazione del preventivo", votesFor: 6_000_000, threshold: 5_000_000, check: { forReachesThreshold: true, attention: null, recordedTotal: 8_500_000 } });
    expect(doubtful!.check.attention).toContain("inferiori alla soglia");
    expect(JSON.stringify(resolutions.map((r) => r.check))).not.toMatch(/valida|nulla|illegittim/i);

    // Si corregge l'esito: il richiamo scompare.
    await run((uow) => updateResolution(uow, doubtful!.id, { title: "Lavori straordinari", outcome: "postponed", votesFor: "400", threshold: "500" }));
    resolutions = (await getMeetingDetail(t.db, meetingId))!.resolutions;
    expect(resolutions[1]).toMatchObject({ outcome: "postponed", check: { attention: null } });

    // Seguito: una scadenza e la spesa (un preventivo di questo condominio).
    await run((uow) => createResolutionDeadline(uow, ok1!.id, { title: "Versare la prima rata straordinaria", dueOn: "2026-09-30" }));
    const b = await budget("Preventivo 2026");
    await run((uow) => linkResolutionBudget(uow, ok1!.id, b.id));
    expect(await run((uow) => linkResolutionBudget(uow, ok1!.id, "00000000-0000-4000-8000-000000000000"))).toMatchObject({ ok: false, errors: { budgetId: expect.any(Array) } });
    const linked = (await getMeetingDetail(t.db, meetingId))!.resolutions[0]!;
    expect(linked).toMatchObject({ deadlineLinked: true, budgetTitle: "Preventivo 2026" });
    expect((await listDeadlines(t.db)).find((d) => d.title === "Versare la prima rata straordinaria")).toMatchObject({ category: "condominium", level: "condominium" });
  });

  it("lavori con preventivi e fatture, sinistri collegati a una pratica, contratti con scadenza e documenti del condominio", async () => {
    const workId = okValue(await run((uow) => createWork(uow, condoId, { title: "Rifacimento facciata", budget: "50.000" }))).id;
    void workId;
    const w = (await detail()).works[0]!;
    await run((uow) => addWorkEntry(uow, w.id, { kind: "quote", title: "Preventivo ditta A", amount: "48.000", entryOn: "2026-03-01", documentId }));
    await run((uow) => addWorkEntry(uow, w.id, { kind: "invoice", title: "Acconto", amount: "15.000,50" }));
    await run((uow) => addWorkEntry(uow, w.id, { kind: "invoice", title: "Saldo", amount: "10.000,25" }));
    expect(await run((uow) => addWorkEntry(uow, w.id, { kind: "boh", title: "x" }))).toMatchObject({ ok: false, errors: { kind: expect.any(Array) } });
    await run((uow) => updateWork(uow, w.id, { title: "Rifacimento facciata", status: "in_progress", budget: "50.000" }));
    expect((await detail()).works[0]).toMatchObject({ status: "in_progress", budgetCents: 5_000_000, invoicedCents: 2_500_075, entries: expect.arrayContaining([expect.objectContaining({ title: "Preventivo ditta A", documentTitle: "Regolamento di prova" })]) });

    const matterId = okValue(await run((uow) => createMatter(uow, { title: "Pratica infiltrazioni" }, TODAY))).id;
    await run((uow) => createClaim(uow, condoId, { kind: "claim", title: "Infiltrazione dal lastrico", matterId }, TODAY));
    const claim = (await detail()).claims[0]!;
    expect(claim).toMatchObject({ status: "open", openedOn: TODAY, matterTitle: "Pratica infiltrazioni", closedOn: null });
    await run((uow) => updateClaim(uow, claim.id, { kind: "claim", title: "Infiltrazione dal lastrico", status: "closed" }, "2026-07-10"));
    expect((await detail()).claims[0]).toMatchObject({ status: "closed", closedOn: "2026-07-10" });
    expect(await run((uow) => createClaim(uow, condoId, { kind: "claim", title: "x", matterId: "00000000-0000-4000-8000-000000000000" }, TODAY))).toMatchObject({ ok: false, errors: { matterId: expect.any(Array) } });

    await run((uow) => createContract(uow, condoId, { kind: "certification", title: "Certificazione ascensore", counterpartyPartyId: adminId, validFrom: "2025-01-01", validTo: "2027-01-01", documentId }));
    expect(await run((uow) => createContract(uow, condoId, { kind: "contract", title: "x", validFrom: "2026-01-01", validTo: "2025-01-01" }))).toMatchObject({ ok: false, errors: { validTo: expect.any(Array) } });
    expect((await detail()).contracts[0]).toMatchObject({ title: "Certificazione ascensore", counterpartyName: "Amministratore Esempio", documentTitle: "Regolamento di prova", validTo: "2027-01-01" });

    await run((uow) => linkCondoDocument(uow, condoId, documentId, "regulation"));
    expect((await detail()).documents).toEqual([{ documentId, kind: "regulation", title: "Regolamento di prova" }]);
    expect(await run((uow) => linkCondoDocument(uow, condoId, documentId, "boh"))).toMatchObject({ ok: false });
    await run((uow) => unlinkCondoDocument(uow, condoId, documentId));
    expect((await detail()).documents).toEqual([]);
    await run((uow) => removeMember(uow, condoId, assets[2]!));
    expect((await detail()).members).toHaveLength(2);
  });

  it("l'audit registra azioni e identificativi, mai testi, importi o nomi", async () => {
    const rows = await t.db.select().from(auditLog).where(sql`${auditLog.action} like 'condominium.%'`);
    expect(new Set(rows.map((r) => r.action)).size).toBeGreaterThan(20);
    const text = JSON.stringify(rows);
    for (const secret of ["Condominio Esempio", "Via Prova", "Approvato il preventivo", "Perché la voce", "Delega per il voto", "Infiltrazione", "Rifacimento", "Soglia indicata", "Amministratore Esempio"]) expect(text, secret).not.toContain(secret);
    expect((await t.db.execute(sql`select audit_log_verify() as v`) as unknown as { rows: { v: unknown }[] }).rows[0]!.v).toBeNull();
  });
});
