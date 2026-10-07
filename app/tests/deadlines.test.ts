import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { auditLog, notification, territory, user } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { LocalFileStorage } from "@/platform/storage";
import { createAsset } from "@/modules/assets";
import {
  addOccurrence,
  addProof,
  cancelOccurrence,
  completeOccurrence,
  createDeadline,
  deadlineSummary,
  getDeadlineDetail,
  getNotificationSettings,
  listDeadlines,
  listNotifications,
  listOccurrences,
  markNotificationRead,
  reopenOccurrence,
  runDailyCycle,
  saveNotificationSettings,
  setDeadlineArchived,
  snoozeOccurrence,
  updateDeadline,
  updateOwnerFields,
  type MailPort,
} from "@/modules/deadlines";
import { createDocument, listDocumentCategories } from "@/modules/documents";
import { createParty } from "@/modules/directory";
import { evaluateDossier } from "@/modules/dossier";
import { addRuleVersion, listRules, seedExampleRules, setRuleActive } from "@/modules/rules";
import { importIstat } from "@/modules/territory";
import { createTestDb, type TestDb } from "./helpers/test-db";
import { makePdf } from "./helpers/sample-pdf";

const actor = { type: "owner", id: "o1" } as const;
const owner = { displayName: "Proprietario Prova", email: "prova@example.test" };
const TODAY = "2026-06-15"; // lunedi'

describe("scadenze", () => {
  let t: TestDb;
  let dir: string;
  let storage: LocalFileStorage;
  let municipalityId: string;
  let assetId: string;
  let professionalId: string;
  let documentId: string;

  const run = <T>(work: Parameters<typeof runInUnitOfWork<T>>[2]) => runInUnitOfWork(t.db, actor, work);
  const okValue = <V>(r: { ok: boolean; value?: V }): V => {
    if (!r.ok) throw new Error(`atteso successo: ${JSON.stringify(r)}`);
    return r.value as V;
  };
  const base = (over: Record<string, unknown> = {}) => ({ title: "Scadenza di prova", category: "fiscal", level: "national", calc: { type: "fixed_annual", month: 3, day: 1 }, ...over });
  const create = async (over: Record<string, unknown> = {}, today = TODAY) => okValue(await run((uow) => createDeadline(uow, base(over), today))).id;
  const dates = async (deadlineId: string) => (await getDeadlineDetail(t.db, deadlineId, TODAY))!.occurrences.map((o) => [o.dueOn, o.status]).sort();
  const occurrenceOf = async (deadlineId: string, dueOn?: string) => (await getDeadlineDetail(t.db, deadlineId, TODAY))!.occurrences.find((o) => !dueOn || o.dueOn === dueOn)!;

  beforeAll(async () => {
    t = await createTestDb();
    dir = await mkdtemp(join(tmpdir(), "deadlines-test-"));
    storage = new LocalFileStorage(dir);
    await run((uow) =>
      importIstat(uow, [
        { regionCode: "90", regionName: "Regione di prova", provinceCode: "900", provinceName: "Provincia di prova", provinceSigla: "PP", municipalityCode: "900001", municipalityName: "Comune Uno", cadastralCode: "Z101" },
      ]),
    );
    municipalityId = (await t.db.select().from(territory).where(eq(territory.kind, "municipality")))[0]!.id;
    assetId = okValue(await run((uow) => createAsset(uow, owner, { kind: "dwelling", name: "Bene delle scadenze", territoryId: municipalityId, attributes: [{ key: "data_contratto", type: "text", value: "2026-05-01" }] }))).id;
    professionalId = okValue(await run((uow) => createParty(uow, { displayName: "Commercialista", roles: ["accountant"] }))).id;
    const categoryId = (await listDocumentCategories(t.db))[0]!.id;
    documentId = okValue(await run((uow) => createDocument(uow, { title: "Ricevuta", categoryId }, { name: "ricevuta.pdf", bytes: makePdf("ricevuta") }, storage))).id;
    await t.db.insert(user).values({ id: "u1", name: "Proprietario", email: "proprietario@example.test" });
  }, 60_000);
  afterAll(async () => {
    await t.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("i festivi sono dati di partenza (nazionali) e la Pasqua si calcola", async () => {
    const rows = (await t.db.execute(sql`select count(*)::int as n from holiday_rule`)) as unknown as { rows: { n: number }[] };
    expect(rows.rows[0]!.n).toBe(11);
  });

  it("una scadenza annuale calcola la prossima data da oggi, mai una data fissa del futuro scritta nel codice", async () => {
    const id = await create();
    expect(await dates(id)).toEqual([["2027-03-01", "open"]]);
    expect((await listDeadlines(t.db)).find((d) => d.id === id)).toMatchObject({ leadDays: [30, 7, 1, 0], origin: "manual", priority: "normal" });
  });

  it("sposta al primo giorno lavorativo se richiesto, con i festivi a dati (anche quelli comunali)", async () => {
    // 2026-12-25 e' venerdi' (Natale): si sposta a lunedi' 28.
    const christmas = await create({ title: "Natale", calc: { type: "fixed_annual", month: 12, day: 25 }, shiftToBusinessDay: true });
    expect(await dates(christmas)).toEqual([["2026-12-28", "open"]]);
    // Senza lo spostamento resta com'e'.
    expect(await dates(await create({ title: "Natale fermo", calc: { type: "fixed_annual", month: 12, day: 25 } }))).toEqual([["2026-12-25", "open"]]);
    // Un festivo comunale (santo patrono) inserito come dato sposta ulteriormente: 2026-09-21 (lunedi') festivo del Comune.
    await t.db.execute(sql`insert into holiday_rule (name, kind, month, day, territory_id) values ('Santo patrono di prova', 'fixed', 9, 21, ${municipalityId})`);
    const local = await create({ title: "Patrono", assetId, calc: { type: "fixed_annual", month: 9, day: 21 }, shiftToBusinessDay: true });
    expect(await dates(local)).toEqual([["2026-09-22", "open"]]);
    const elsewhere = await create({ title: "Patrono altrove", calc: { type: "fixed_annual", month: 9, day: 21 }, shiftToBusinessDay: true });
    expect(await dates(elsewhere)).toEqual([["2026-09-21", "open"]]);
  });

  it("relative_to usa l'ancora presa dalle caratteristiche del bene, e senza ancora non produce date", async () => {
    const calc = { type: "relative_to", anchor: { kind: "attribute", name: "data_contratto" }, offset: { unit: "days", amount: 60 } };
    expect(await dates(await create({ title: "Dopo il contratto", assetId, calc }))).toEqual([["2026-06-30", "open"]]);
    expect(await dates(await create({ title: "Senza ancora", assetId, calc: { ...calc, anchor: { kind: "attribute", name: "assente" } } }))).toEqual([]);
  });

  it("recurring genera tutte le date dell'orizzonte; manual vuole la data e non ne calcola altre", async () => {
    const monthly = await create({ title: "Mensile", calc: { type: "recurring", anchor: { kind: "date", date: "2026-01-31" }, every: { unit: "months", amount: 3 } } });
    expect((await dates(monthly)).map(([d]) => d)).toEqual(["2026-07-31", "2026-10-31", "2027-01-31", "2027-04-30", "2027-07-31"].filter((d) => d <= "2027-07-20"));
    const manual = await run((uow) => createDeadline(uow, base({ calc: { type: "manual" } }), TODAY));
    expect(manual).toMatchObject({ ok: false, errors: { firstDueOn: expect.any(Array) } });
    const manualId = await create({ title: "A mano", calc: { type: "manual" }, firstDueOn: "2026-09-10" });
    expect(await dates(manualId)).toEqual([["2026-09-10", "open"]]);
    expect(await run((uow) => addOccurrence(uow, manualId, "2026-09-10"))).toMatchObject({ ok: false, errors: { dueOn: ["Questa data c'è già"] } });
    expect(await run((uow) => addOccurrence(uow, manualId, "2026-12-10"))).toMatchObject({ ok: true });
    expect((await dates(manualId)).length).toBe(2);
  });

  it("modificare il calcolo annulla le date future aperte che non valgono piu', non quelle chiuse", async () => {
    const id = await create({ title: "Da ricalcolare", calc: { type: "recurring", anchor: { kind: "date", date: "2026-06-30" }, every: { unit: "months", amount: 6 } } });
    const before = await dates(id);
    expect(before.length).toBeGreaterThan(2);
    const first = await occurrenceOf(id, "2026-06-30");
    await run((uow) => completeOccurrence(uow, first.id, { completionKind: "owner" }, TODAY));

    expect(await run((uow) => updateDeadline(uow, id, base({ title: "Da ricalcolare", calc: { type: "fixed_annual", month: 11, day: 5 } }), TODAY))).toMatchObject({ ok: true });
    const after = await dates(id);
    expect(after).toContainEqual(["2026-06-30", "done"]);
    expect(after).toContainEqual(["2026-11-05", "open"]);
    expect(after.filter(([, status]) => status === "open")).toEqual([["2026-11-05", "open"]]);
    expect(after.filter(([, status]) => status === "cancelled").length).toBeGreaterThan(0);
  });

  it("chiusura: la prova puo' essere obbligatoria e chi attesta l'adempimento si distingue", async () => {
    const id = await create({ title: "Con prova", proofRequired: true, professionalPartyId: professionalId, calc: { type: "manual" }, firstDueOn: "2026-07-01" });
    const occ = await occurrenceOf(id);
    expect(await run((uow) => completeOccurrence(uow, occ.id, { completionKind: "owner" }, TODAY))).toMatchObject({ ok: false, errors: { reference: [expect.stringContaining("prova")] } });
    expect(await run((uow) => completeOccurrence(uow, occ.id, { completionKind: "owner", documentId: "00000000-0000-4000-8000-000000000000" }, TODAY))).toMatchObject({ ok: false, errors: { documentId: expect.any(Array) } });
    expect(await run((uow) => completeOccurrence(uow, occ.id, { completionKind: "boh", reference: "x" }, TODAY))).toMatchObject({ ok: false, errors: { completionKind: expect.any(Array) } });

    expect(await run((uow) => completeOccurrence(uow, occ.id, { completionKind: "professional_validated", reference: "Protocollo 123", documentId, completedOn: "2026-06-30" }, TODAY))).toMatchObject({ ok: true });
    const done = await occurrenceOf(id);
    expect(done).toMatchObject({ status: "done", completionKind: "professional_validated", completedOn: "2026-06-30" });
    expect(done.proofs).toEqual([expect.objectContaining({ reference: "Protocollo 123", documentId, documentTitle: "Ricevuta" })]);
    expect(await run((uow) => completeOccurrence(uow, occ.id, { completionKind: "owner", reference: "x" }, TODAY))).toMatchObject({ ok: false });

    // «Validata da un professionista» senza un professionista indicato non e' possibile.
    const noPro = await create({ title: "Senza professionista", calc: { type: "manual" }, firstDueOn: "2026-07-02" });
    const noProOccurrence = (await occurrenceOf(noPro)).id;
    expect(await run((uow) => completeOccurrence(uow, noProOccurrence, { completionKind: "professional_validated" }, TODAY))).toMatchObject({ ok: false, errors: { completionKind: expect.any(Array) } });

    // Si riapre, e si puo' aggiungere una prova dopo.
    await run((uow) => reopenOccurrence(uow, occ.id));
    expect(await occurrenceOf(id)).toMatchObject({ status: "open", completionKind: null, completedOn: null });
    expect(await run((uow) => addProof(uow, occ.id, { reference: "Quietanza 9" }))).toMatchObject({ ok: true });
    expect(await run((uow) => addProof(uow, occ.id, {}))).toMatchObject({ ok: false });
    expect((await occurrenceOf(id)).proofs).toHaveLength(2);
  });

  it("rinvio e annullamento: il rinvio vuole una data futura e non cambia la scadenza", async () => {
    const id = await create({ title: "Da rinviare", calc: { type: "manual" }, firstDueOn: "2026-06-10" });
    const occ = await occurrenceOf(id);
    expect(await run((uow) => snoozeOccurrence(uow, occ.id, "2026-06-15", TODAY))).toMatchObject({ ok: false, errors: { snoozeUntil: expect.any(Array) } });
    expect(await run((uow) => snoozeOccurrence(uow, occ.id, "2026-06-20", TODAY))).toMatchObject({ ok: true });
    expect(await occurrenceOf(id)).toMatchObject({ dueOn: "2026-06-10", snoozedUntil: "2026-06-20", status: "open", overdue: true });
    await run((uow) => cancelOccurrence(uow, occ.id));
    expect((await occurrenceOf(id)).status).toBe("cancelled");
  });

  it("le viste: in ritardo, prossime e completate; filtri per bene e categoria", async () => {
    const overdue = await listOccurrences(t.db, "overdue", {}, TODAY);
    expect(overdue.every((o) => o.overdue && o.dueOn < TODAY)).toBe(true);
    const upcoming = await listOccurrences(t.db, "upcoming", {}, TODAY);
    expect(upcoming.every((o) => o.dueOn >= TODAY && o.daysLeft >= 0)).toBe(true);
    expect(upcoming.map((o) => o.dueOn)).toEqual([...upcoming.map((o) => o.dueOn)].sort());
    expect((await listOccurrences(t.db, "done", {}, TODAY)).every((o) => o.status === "done")).toBe(true);
    const forAsset = await listOccurrences(t.db, "all", { assetId }, TODAY);
    expect(forAsset.length).toBeGreaterThan(0);
    expect(forAsset.every((o) => o.assetId === assetId)).toBe(true);
    expect((await listOccurrences(t.db, "all", { category: "technical" }, TODAY)).length).toBe(0);
  });

  it("archiviare nasconde le date e il giro giornaliero le ignora", async () => {
    const id = await create({ title: "Da archiviare", calc: { type: "manual" }, firstDueOn: "2026-06-16" });
    await run((uow) => setDeadlineArchived(uow, id, true));
    expect((await listOccurrences(t.db, "all", {}, TODAY)).some((o) => o.deadlineId === id)).toBe(false);
    expect((await listOccurrences(t.db, "all", { includeArchived: true }, TODAY)).some((o) => o.deadlineId === id)).toBe(true);
  });
});

describe("scadenze derivate dalle regole", () => {
  let t: TestDb;
  let assetId: string;
  const run = <T>(work: Parameters<typeof runInUnitOfWork<T>>[2]) => runInUnitOfWork(t.db, actor, work);
  const okValue = <V>(r: { ok: boolean; value?: V }): V => {
    if (!r.ok) throw new Error(`atteso successo: ${JSON.stringify(r)}`);
    return r.value as V;
  };
  const derived = async () => (await listDeadlines(t.db, { includeArchived: true })).filter((d) => d.origin === "rule");

  beforeAll(async () => {
    t = await createTestDb();
    await run((uow) =>
      importIstat(uow, [
        { regionCode: "90", regionName: "Regione di prova", provinceCode: "900", provinceName: "Provincia di prova", provinceSigla: "PP", municipalityCode: "900001", municipalityName: "Comune Uno", cadastralCode: "Z101" },
      ]),
    );
    const municipalityId = (await t.db.select().from(territory).where(eq(territory.kind, "municipality")))[0]!.id;
    await run((uow) => seedExampleRules(uow, undefined));
    assetId = okValue(await run((uow) => createAsset(uow, owner, { kind: "dwelling", name: "Bene con regole", territoryId: municipalityId }))).id;
  }, 60_000);
  afterAll(async () => {
    await t.close();
  });

  it("la valutazione del dossier crea la scadenza della regola con le sue date, spostate al giorno lavorativo", async () => {
    await run((uow) => evaluateDossier(uow, assetId, TODAY));
    const [d] = await derived();
    expect(d).toMatchObject({ title: "Controllo annuale del dossier", origin: "rule", ruleKey: "esempio_promemoria", outcomeKey: "controllo_annuale", category: "administrative", priority: "low", stale: false, shiftToBusinessDay: true, assetId });
    expect(d!.explanation).toMatchObject({ ruleTitle: "Esempio: promemoria annuale", versionNo: 1 });
    // 31 gennaio 2027 e' domenica -> lunedi' 1 febbraio.
    const detail = (await getDeadlineDetail(t.db, d!.id, TODAY))!;
    expect(detail.occurrences.map((o) => o.dueOn)).toEqual(["2027-02-01"]);
  });

  it("rivalutare e' idempotente e non tocca responsabile, preavvisi e stato scelti dal proprietario", async () => {
    const [d] = await derived();
    const professional = okValue(await run((uow) => createParty(uow, { displayName: "Consulente", roles: ["other"] }))).id;
    await run((uow) => updateOwnerFields(uow, d!.id, { professionalPartyId: professional, priority: "high", leadDays: [10, 0] }));
    const occ = (await getDeadlineDetail(t.db, d!.id, TODAY))!.occurrences[0]!;
    await run((uow) => completeOccurrence(uow, occ.id, { completionKind: "owner" }, TODAY));

    const auditBefore = (await t.db.select().from(auditLog)).length;
    await run((uow) => evaluateDossier(uow, assetId, TODAY));
    expect((await t.db.select().from(auditLog)).length).toBe(auditBefore);
    expect(await derived()).toHaveLength(1);
    expect((await derived())[0]).toMatchObject({ professionalPartyId: professional, priority: "high", leadDays: [10, 0] });
    expect((await getDeadlineDetail(t.db, d!.id, TODAY))!.occurrences[0]).toMatchObject({ status: "done" });

    // Una scadenza che viene da una regola non si modifica nel contenuto.
    expect(await run((uow) => updateDeadline(uow, d!.id, { title: "x", category: "fiscal", level: "national", calc: { type: "manual" }, firstDueOn: "2026-07-01" }, TODAY))).toMatchObject({ ok: false });
  });

  it("una nuova versione della regola cambia il calcolo: le date future aperte si ricalcolano, quelle chiuse restano", async () => {
    const rule = (await listRules(t.db)).find((r) => r.key === "esempio_promemoria")!;
    await run((uow) =>
      addRuleVersion(uow, rule.id, {
        title: rule.current.title,
        level: "national",
        sourceText: "v2",
        outcomes: [
          { type: "deadline", key: "controllo_annuale", title: "Controllo annuale (rivisto)", category: "administrative", calc: { type: "fixed_annual", month: 6, day: 30 }, priority: "low", shiftToBusinessDay: false },
        ],
      }),
    );
    await run((uow) => evaluateDossier(uow, assetId, TODAY));
    const [d] = await derived();
    expect(d).toMatchObject({ title: "Controllo annuale (rivisto)", calc: { type: "fixed_annual", month: 6, day: 30 }, professionalPartyId: expect.any(String) });
    const occurrences = (await getDeadlineDetail(t.db, d!.id, TODAY))!.occurrences.map((o) => [o.dueOn, o.status]).sort();
    expect(occurrences).toContainEqual(["2027-02-01", "done"]);
    expect(occurrences).toContainEqual(["2026-06-30", "open"]);
  });

  it("disattivare la regola segna la scadenza 'da rivedere' senza cancellare nulla", async () => {
    const rule = (await listRules(t.db)).find((r) => r.key === "esempio_promemoria")!;
    await run((uow) => setRuleActive(uow, rule.id, false));
    await run((uow) => evaluateDossier(uow, assetId, TODAY));
    const [d] = await derived();
    expect(d).toMatchObject({ stale: true, archived: false });
    expect((await getDeadlineDetail(t.db, d!.id, TODAY))!.occurrences.length).toBeGreaterThan(0);
    await run((uow) => setRuleActive(uow, rule.id, true));
    await run((uow) => evaluateDossier(uow, assetId, TODAY));
    expect((await derived())[0]!.stale).toBe(false);
  });
});

describe("avvisi e giro giornaliero", () => {
  let t: TestDb;
  const run = <T>(work: Parameters<typeof runInUnitOfWork<T>>[2]) => runInUnitOfWork(t.db, actor, work);
  const okValue = <V>(r: { ok: boolean; value?: V }): V => {
    if (!r.ok) throw new Error(`atteso successo: ${JSON.stringify(r)}`);
    return r.value as V;
  };
  const cycle = (today: string, mail?: MailPort) => run((uow) => runDailyCycle(uow, { today, mail, baseUrl: "http://localhost:3000" }));
  const notices = async () => (await listNotifications(t.db, { unreadOnly: false })).map((n) => [n.dueOn, n.leadDays, n.title] as const);

  beforeAll(async () => {
    t = await createTestDb();
    await t.db.insert(user).values({ id: "u1", name: "Proprietario", email: "proprietario@example.test" });
  });
  afterAll(async () => {
    await t.close();
  });

  it("un avviso parte quando si raggiunge il preavviso, una volta sola anche se il giro gira due volte", async () => {
    const id = okValue(await run((uow) => createDeadline(uow, { title: "Pagamento", category: "fiscal", level: "national", calc: { type: "manual" }, firstDueOn: "2026-07-31", leadDays: [30, 7, 1, 0] }, "2026-06-01"))).id;
    expect(id).toBeTruthy();

    expect(await cycle("2026-06-15")).toMatchObject({ notifications: 0 }); // mancano 46 giorni
    expect(await cycle("2026-07-01")).toMatchObject({ notifications: 1 });
    expect(await cycle("2026-07-01")).toMatchObject({ notifications: 0 }); // stesso giorno: nulla di nuovo
    expect(await cycle("2026-07-10")).toMatchObject({ notifications: 0 }); // ancora il passo dei 30 giorni
    expect(await cycle("2026-07-24")).toMatchObject({ notifications: 1 });
    expect(await cycle("2026-07-31")).toMatchObject({ notifications: 1 });
    expect(await notices()).toEqual([
      ["2026-07-31", 0, "Oggi: Pagamento"],
      ["2026-07-31", 7, "Tra 7 giorni: Pagamento"],
      ["2026-07-31", 30, "Tra 30 giorni: Pagamento"],
    ]);
  });

  it("scaduta e non chiusa, la scadenza genera avvisi di ritardo sempre piu' distanziati", async () => {
    await cycle("2026-08-01");
    await cycle("2026-08-02");
    await cycle("2026-08-04");
    await cycle("2026-08-20");
    expect((await notices()).filter(([, lead]) => lead < 0).map(([, lead]) => lead).sort((a, b) => b - a)).toEqual([-1, -3, -14]);
    expect((await notices()).find(([, lead]) => lead === -14)![2]).toBe("In ritardo da 14 giorni: Pagamento");
  });

  it("un giro dopo molti giorni di inattivita' crea un solo avviso, quello del passo piu' recente", async () => {
    const id = okValue(await run((uow) => createDeadline(uow, { title: "Dopo una pausa", category: "fiscal", level: "national", calc: { type: "manual" }, firstDueOn: "2026-09-30", leadDays: [30, 7, 1, 0] }, "2026-06-01"))).id;
    expect(id).toBeTruthy();
    await cycle("2026-09-29"); // salta tutti i passi precedenti
    expect((await notices()).filter(([, , title]) => title.includes("Dopo una pausa"))).toEqual([["2026-09-30", 1, "Tra 1 giorno: Dopo una pausa"]]);
  });

  it("scadenze completate, annullate, rinviate o archiviate non generano avvisi", async () => {
    const make = async (title: string) => okValue(await run((uow) => createDeadline(uow, { title, category: "fiscal", level: "national", calc: { type: "manual" }, firstDueOn: "2026-10-10", leadDays: [30, 0] }, "2026-06-01"))).id;
    const done = await make("Chiusa");
    const cancelled = await make("Annullata");
    const snoozed = await make("Rinviata");
    const archived = await make("Archiviata");
    const occ = async (id: string) => (await getDeadlineDetail(t.db, id, "2026-09-15"))!.occurrences[0]!.id;
    // Gli id si leggono PRIMA: dentro una transazione aperta il database (PGlite) ha una sola connessione.
    const [doneOcc, cancelledOcc, snoozedOcc] = [await occ(done), await occ(cancelled), await occ(snoozed)];
    await run(async (uow) => {
      await completeOccurrence(uow, doneOcc, { completionKind: "owner" }, "2026-09-15");
      await cancelOccurrence(uow, cancelledOcc);
      await snoozeOccurrence(uow, snoozedOcc, "2026-10-05", "2026-09-15");
      await setDeadlineArchived(uow, archived, true);
    });
    await cycle("2026-09-15");
    const titles = (await notices()).map(([, , title]) => title);
    for (const name of ["Chiusa", "Annullata", "Rinviata", "Archiviata"]) expect(titles.some((x) => x.includes(name)), name).toBe(false);
    // Passato il rinvio, gli avvisi ripartono.
    await cycle("2026-10-06");
    expect((await notices()).some(([, , title]) => title.includes("Rinviata"))).toBe(true);
  });

  it("l'email parte solo se il servizio e' configurato e attivato, per gli avvisi nati dopo l'attivazione, una volta sola", async () => {
    const sent: { to: string; subject: string; text: string }[] = [];
    const goodMail: MailPort = { configured: true, send: async (m) => void sent.push(m) };
    let fail = true;
    const flakyMail: MailPort = {
      configured: true,
      send: async (m) => {
        if (fail) throw new Error("servizio non raggiungibile");
        sent.push(m);
      },
    };
    const make = async (title: string, dueOn: string) => okValue(await run((uow) => createDeadline(uow, { title, category: "fiscal", level: "national", calc: { type: "manual" }, firstDueOn: dueOn, leadDays: [0] }, "2026-06-01"))).id;

    // Servizio configurato ma non attivato nelle impostazioni: nessuna email.
    await make("Prima dell'attivazione", "2026-12-20");
    await cycle("2026-12-20", goodMail);
    expect(sent).toHaveLength(0);
    expect(await run((uow) => saveNotificationSettings(uow, { emailEnabled: true, emailAddress: "non-una-email" }))).toMatchObject({ ok: false, errors: { emailAddress: expect.any(Array) } });
    expect(await run((uow) => saveNotificationSettings(uow, { emailEnabled: true, emailAddress: "" }))).toMatchObject({ ok: true });
    expect(await getNotificationSettings(t.db)).toEqual({ emailEnabled: true, emailAddress: "" });

    // Attivare le email non spedisce gli avvisi arretrati.
    expect(await cycle("2026-12-20", goodMail)).toMatchObject({ emails: 0, emailErrors: 0 });
    expect(sent).toHaveLength(0);

    // Un avviso nuovo, con un servizio che fallisce: l'errore e' registrato, l'avviso resta e si riprova al giro dopo.
    const id = await make("Con email", "2026-12-21");
    // Il giorno dopo la scadenza, anche quella dell'attivazione genera il suo avviso di ritardo: sono due avvisi nuovi.
    expect(await cycle("2026-12-21", flakyMail)).toMatchObject({ emails: 0, emailErrors: 2 });
    expect(await t.db.select().from(notification).where(eq(notification.emailError, "servizio non raggiungibile"))).toHaveLength(2);
    fail = false;
    expect(await cycle("2026-12-21", flakyMail)).toMatchObject({ emails: 2, emailErrors: 0 });
    expect(sent.map((m) => m.subject).sort()).toEqual(["In ritardo da 1 giorno: Prima dell'attivazione", "Oggi: Con email"]);
    expect(sent.every((m) => m.to === "proprietario@example.test")).toBe(true);
    expect(sent.find((m) => m.subject === "Oggi: Con email")!.text).toContain(`http://localhost:3000/scadenze/${id}`);
    // Non si manda due volte; senza servizio configurato gli avvisi restano solo nell'app.
    expect(await cycle("2026-12-21", flakyMail)).toMatchObject({ emails: 0 });
    expect(await cycle("2026-12-21", { configured: false, send: async () => {} })).toMatchObject({ emails: 0, emailErrors: 0 });

    // L'indirizzo scelto nelle impostazioni ha la precedenza su quello dell'account.
    await run((uow) => saveNotificationSettings(uow, { emailEnabled: true, emailAddress: "altro@example.test" }));
    await make("Altro indirizzo", "2026-12-22");
    await cycle("2026-12-22", goodMail);
    expect(sent.at(-1)).toMatchObject({ to: "altro@example.test", subject: "Oggi: Altro indirizzo" });
  });

  it("segnare come letto e il riepilogo per il pannello", async () => {
    const unread = await listNotifications(t.db, { unreadOnly: true });
    expect(unread.length).toBeGreaterThan(3);
    await run((uow) => markNotificationRead(uow, unread[0]!.id));
    expect((await listNotifications(t.db, { unreadOnly: true })).length).toBe(unread.length - 1);
    await run((uow) => markNotificationRead(uow, null));
    expect(await listNotifications(t.db, { unreadOnly: true })).toEqual([]);
    const s = await deadlineSummary(t.db, "2026-12-15");
    expect(s).toMatchObject({ unreadNotifications: 0 });
    expect(s.overdue).toBeGreaterThan(0);
  });

  it("l'audit registra le operazioni senza titoli, note ne' indirizzi email", async () => {
    const rows = await t.db.select().from(auditLog).where(sql`${auditLog.action} like 'deadline.%' or ${auditLog.action} like 'notification.%' or ${auditLog.action} = 'settings.notifications'`);
    const actions = new Set(rows.map((r) => r.action));
    for (const a of ["deadline.create", "deadline.cycle", "deadline.occurrence.complete", "deadline.occurrence.snooze", "deadline.archive", "settings.notifications", "notification.read", "notification.read_all"]) expect(actions, a).toContain(a);
    const text = JSON.stringify(rows);
    expect(text).not.toContain("Con email");
    expect(text).not.toContain("altro@example.test");
    expect(text).not.toContain("Pagamento");
    expect((await t.db.execute(sql`select audit_log_verify() as v`) as unknown as { rows: { v: unknown }[] }).rows[0]!.v).toBeNull();
  });
});
