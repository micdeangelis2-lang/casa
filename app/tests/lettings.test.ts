import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { auditLog, territory } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { LocalFileStorage } from "@/platform/storage";
import { createAsset } from "@/modules/assets";
import { getDeadlineDetail, listDeadlines } from "@/modules/deadlines";
import { createParty } from "@/modules/directory";
import { createDocument, listDocumentCategories } from "@/modules/documents";
import { evaluateDossier, getDossier } from "@/modules/dossier";
import {
  activeLettingTypes,
  addCode,
  addLettingParty,
  addRent,
  addReport,
  createLetting,
  generateRentSchedule,
  getLettingDetail,
  listLettings,
  markReportDone,
  recordRentPayment,
  removeCode,
  removeLettingParty,
  removeRent,
  removeReport,
  reopenReport,
  setLettingStatus,
  updateLetting,
} from "@/modules/lettings";
import { createRule } from "@/modules/rules";
import { importIstat } from "@/modules/territory";
import { createTestDb, type TestDb } from "./helpers/test-db";
import { makePdf } from "./helpers/sample-pdf";

const actor = { type: "owner", id: "o1" } as const;
const owner = { displayName: "Proprietario Prova", email: "prova@example.test" };
const TODAY = "2026-06-15";

describe("locazioni e ricettivita'", () => {
  let t: TestDb;
  let dir: string;
  let storage: LocalFileStorage;
  let assetId: string;
  let otherAssetId: string;
  let tenantId: string;
  let managerId: string;
  let documentId: string;
  let lettingId: string;
  let shortId: string;

  const run = <T>(work: Parameters<typeof runInUnitOfWork<T>>[2]) => runInUnitOfWork(t.db, actor, work);
  const okValue = <V>(r: { ok: boolean; value?: V }): V => {
    if (!r.ok) throw new Error(`atteso successo: ${JSON.stringify(r)}`);
    return r.value as V;
  };
  const detail = (id = lettingId) => getLettingDetail(t.db, id, TODAY).then((d) => d!);

  beforeAll(async () => {
    t = await createTestDb();
    dir = await mkdtemp(join(tmpdir(), "letting-test-"));
    storage = new LocalFileStorage(dir);
    await run((uow) => importIstat(uow, [{ regionCode: "90", regionName: "Regione di prova", provinceCode: "900", provinceName: "Provincia di prova", provinceSigla: "PP", municipalityCode: "900001", municipalityName: "Comune Uno", cadastralCode: "Z101" }]));
    const municipalityId = (await t.db.select().from(territory).where(eq(territory.kind, "municipality")))[0]!.id;
    assetId = okValue(await run((uow) => createAsset(uow, owner, { kind: "dwelling", name: "Appartamento A", territoryId: municipalityId }))).id;
    otherAssetId = okValue(await run((uow) => createAsset(uow, owner, { kind: "dwelling", name: "Casa vacanze", territoryId: municipalityId }))).id;
    tenantId = okValue(await run((uow) => createParty(uow, { displayName: "Inquilino Esempio", roles: ["tenant"] }))).id;
    managerId = okValue(await run((uow) => createParty(uow, { displayName: "Gestore Esempio", roles: ["manager"] }))).id;
    const categoryId = (await listDocumentCategories(t.db))[0]!.id;
    documentId = okValue(await run((uow) => createDocument(uow, { title: "Contratto firmato", categoryId }, { name: "contratto.pdf", bytes: makePdf("contratto") }, storage))).id;
  }, 60_000);
  afterAll(async () => {
    await t.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("senza il tipo non si salva; con il tipo reale si registra contratto, cauzione e registrazione", async () => {
    expect(await run((uow) => createLetting(uow, { assetId, title: "Casa" }))).toMatchObject({ ok: false, errors: { type: expect.any(Array) } });
    expect(await run((uow) => createLetting(uow, { assetId: "00000000-0000-4000-8000-000000000000", type: "residential", title: "x" }))).toMatchObject({ ok: false, errors: { assetId: expect.any(Array) } });
    expect(await run((uow) => createLetting(uow, { assetId, type: "residential", title: "x", managerPartyId: "00000000-0000-4000-8000-000000000000" }))).toMatchObject({ ok: false, errors: { managerPartyId: expect.any(Array) } });
    expect(await run((uow) => createLetting(uow, { assetId, type: "residential", title: "x", createDeadline: true }))).toMatchObject({ ok: false, errors: { endsOn: expect.any(Array) } });

    lettingId = okValue(
      await run((uow) =>
        createLetting(uow, {
          assetId,
          type: "residential",
          title: "Locazione a Esempio",
          startsOn: "2026-07-01",
          endsOn: "2030-06-30",
          monthlyRent: "650,00",
          deposit: "1.300,00",
          depositReceivedOn: "2026-06-25",
          registeredOn: "2026-07-10",
          registrationNumber: "REG-123",
          registrationOffice: "Ufficio di prova",
          contractDocumentId: documentId,
          managerPartyId: managerId,
          createDeadline: true,
        }),
      ),
    ).id;
    const d = await detail();
    expect(d).toMatchObject({ assetName: "Appartamento A", type: "residential", status: "active", monthlyRentCents: 65_000, depositCents: 130_000, managerName: "Gestore Esempio", contractDocumentTitle: "Contratto firmato", registrationNumber: "REG-123" });
    expect((await listDeadlines(t.db)).find((x) => x.title === "Fine di «Locazione a Esempio» (Appartamento A)")).toMatchObject({ category: "letting", assetId });
    expect((await listLettings(t.db, {}, TODAY)).map((l) => l.id)).toEqual([lettingId]);
  });

  it("le persone collegate sono contatti della rubrica: aggiungere due volte aggiorna il ruolo", async () => {
    expect(await run((uow) => addLettingParty(uow, lettingId, { partyId: "00000000-0000-4000-8000-000000000000" }))).toMatchObject({ ok: false, errors: { partyId: expect.any(Array) } });
    await run((uow) => addLettingParty(uow, lettingId, { partyId: tenantId, role: "tenant" }));
    await run((uow) => addLettingParty(uow, lettingId, { partyId: tenantId, role: "guarantor" }));
    expect((await detail()).people.map((p) => [p.name, p.role])).toEqual([["Inquilino Esempio", "guarantor"]]);
    expect((await listLettings(t.db, {}, TODAY))[0]!.people).toEqual(["Inquilino Esempio"]);
    await run((uow) => addLettingParty(uow, lettingId, { partyId: tenantId, role: "tenant" }));
    await run((uow) => removeLettingParty(uow, lettingId, tenantId));
    expect((await detail()).people).toEqual([]);
    await run((uow) => addLettingParty(uow, lettingId, { partyId: tenantId, role: "tenant" }));
  });

  it("il calendario dei canoni: scadenze collegate, pagamenti parziali e completi, rigenerazione senza promemoria orfani", async () => {
    expect(await run((uow) => generateRentSchedule(uow, lettingId, { firstDueOn: "2026-07-01", months: "3", amount: "0" }))).toMatchObject({ ok: false, errors: { amount: expect.any(Array) } });
    expect(await run((uow) => generateRentSchedule(uow, lettingId, { firstDueOn: "2026-07-01", months: "30", amount: "650", createDeadlines: true }))).toMatchObject({ ok: false, errors: { createDeadlines: expect.any(Array) } });

    await run((uow) => generateRentSchedule(uow, lettingId, { firstDueOn: "2026-07-01", months: "3", amount: "650,00", createDeadlines: true }));
    const first = await detail();
    expect(first.rents.map((r) => [r.dueOn, r.amountCents, r.state])).toEqual([["2026-07-01", 65_000, "due"], ["2026-08-01", 65_000, "due"], ["2026-09-01", 65_000, "due"]]);
    const oldDeadlines = first.rents.map((r) => r.deadlineId!);
    expect(oldDeadlines.every(Boolean)).toBe(true);

    // Rigenerare prima di qualunque pagamento: i vecchi promemoria vengono archiviati, non lasciati orfani.
    await run((uow) => generateRentSchedule(uow, lettingId, { firstDueOn: "2026-06-01", months: "3", amount: "650,00", createDeadlines: true }));
    const live = (await listDeadlines(t.db)).map((d) => d.id);
    for (const id of oldDeadlines) expect(live).not.toContain(id);
    const rents = (await detail()).rents;
    expect(rents.map((r) => r.dueOn)).toEqual(["2026-06-01", "2026-07-01", "2026-08-01"]);
    expect(rents[0]!.state).toBe("overdue");
    expect((await detail()).rentTotals).toEqual({ dueCents: 195_000, paidCents: 0, overdueCents: 65_000 });

    const june = rents[0]!;
    await run((uow) => recordRentPayment(uow, june.id, { paid: "300,00", paidOn: "2026-06-05" }, TODAY));
    expect((await detail()).rents[0]).toMatchObject({ paidCents: 30_000, state: "overdue" });
    expect((await getDeadlineDetail(t.db, june.deadlineId!, TODAY))!.occurrences[0]!.status).toBe("open");
    await run((uow) => recordRentPayment(uow, june.id, { paid: "650,00", paidOn: "2026-06-08", documentId }, TODAY));
    expect((await detail()).rents[0]).toMatchObject({ state: "paid", paidOn: "2026-06-08", documentTitle: "Contratto firmato" });
    expect((await getDeadlineDetail(t.db, june.deadlineId!, TODAY))!.occurrences[0]).toMatchObject({ status: "done", completedOn: "2026-06-08" });
    // Correggere il totale verso il basso riapre la scadenza; poi lo si rimette a posto.
    await run((uow) => recordRentPayment(uow, june.id, { paid: "400,00", paidOn: "2026-06-08" }, TODAY));
    expect((await getDeadlineDetail(t.db, june.deadlineId!, TODAY))!.occurrences[0]!.status).toBe("open");
    await run((uow) => recordRentPayment(uow, june.id, { paid: "650,00", paidOn: "2026-06-08" }, TODAY));
    expect((await getDeadlineDetail(t.db, june.deadlineId!, TODAY))!.occurrences[0]!.status).toBe("done");
    expect((await detail()).rentTotals).toMatchObject({ paidCents: 65_000, overdueCents: 0 });

    // Con un canone pagato il calendario non si rigenera.
    expect(await run((uow) => generateRentSchedule(uow, lettingId, { firstDueOn: "2026-06-01", months: "3", amount: "700" }))).toMatchObject({ ok: false, errors: { _: ["Ci sono canoni già pagati: non si può rigenerare il calendario"] } });

    await run((uow) => addRent(uow, lettingId, { dueOn: "2026-09-15", amount: "50,00" }));
    const extra = (await detail()).rents.find((r) => r.dueOn === "2026-09-15")!;
    expect(await run((uow) => removeRent(uow, extra.id))).toMatchObject({ ok: true });
    expect((await detail()).rents).toHaveLength(3);
    const july = (await detail()).rents[1]!;
    await run((uow) => removeRent(uow, july.id));
    expect((await listDeadlines(t.db)).map((d) => d.id)).not.toContain(july.deadlineId);
  });

  it("una locazione breve non ha il calendario dei canoni; si registra con il suo tipo e un gestore", async () => {
    shortId = okValue(await run((uow) => createLetting(uow, { assetId: otherAssetId, type: "short_term", title: "Casa vacanze", managerPartyId: managerId }))).id;
    expect(await run((uow) => generateRentSchedule(uow, shortId, { firstDueOn: "2026-07-01", months: "3", amount: "100" }))).toMatchObject({ ok: false, errors: { _: [expect.stringContaining("soggiorni brevi")] } });
    expect(await activeLettingTypes(t.db, otherAssetId)).toEqual(["short_term"]);
    expect(await activeLettingTypes(t.db, assetId)).toEqual(["residential"]);
  });

  it("i codici identificativi sono scritti dal proprietario con la loro validita'", async () => {
    expect(await run((uow) => addCode(uow, shortId, { label: " ", value: "x" }))).toMatchObject({ ok: false, errors: { label: expect.any(Array) } });
    await run((uow) => addCode(uow, shortId, { label: "Codice identificativo", value: "ABC-123", issuer: "Ente di prova", issuedOn: "2026-01-01", validUntil: "2026-12-31" }));
    await run((uow) => addCode(uow, shortId, { label: "Codice vecchio", value: "OLD", validUntil: "2026-05-01" }));
    const codes = (await detail(shortId)).codes;
    expect(codes.map((c) => [c.label, c.value, c.state])).toEqual([["Codice identificativo", "ABC-123", "active"], ["Codice vecchio", "OLD", "expired"]]);
    await run((uow) => removeCode(uow, codes[1]!.id));
    expect((await detail(shortId)).codes).toHaveLength(1);
  });

  it("gli adempimenti (comunicazioni, imposta di soggiorno, statistiche) hanno scadenza, ricevuta e si chiudono dalla scadenza", async () => {
    expect(await run((uow) => addReport(uow, shortId, { kind: "tourist_tax", title: "Imposta del trimestre", createDeadline: true }))).toMatchObject({ ok: false, errors: { dueOn: expect.any(Array) } });
    await run((uow) => addReport(uow, shortId, { kind: "tourist_tax", title: "Imposta del trimestre", period: "2° trimestre", dueOn: "2026-07-15", amount: "120,50", createDeadline: true }));
    await run((uow) => addReport(uow, shortId, { kind: "statistics", title: "Rilevazione mensile", dueOn: "2026-06-01" }));
    let reports = (await detail(shortId)).reports;
    expect(reports.map((r) => [r.title, r.state])).toEqual([["Rilevazione mensile", "overdue"], ["Imposta del trimestre", "open"]]);
    const tax = reports[1]!;
    expect((await listDeadlines(t.db)).find((d) => d.title === "Imposta del trimestre (2° trimestre): Casa vacanze")).toMatchObject({ category: "hospitality", assetId: otherAssetId });

    expect(await run((uow) => markReportDone(uow, tax.id, {}))).toMatchObject({ ok: false, errors: { doneOn: expect.any(Array) } });
    await run((uow) => markReportDone(uow, tax.id, { doneOn: "2026-07-10", documentId, amount: "118,00" }));
    reports = (await detail(shortId)).reports;
    expect(reports.find((r) => r.id === tax.id)).toMatchObject({ state: "done", doneOn: "2026-07-10", amountCents: 11_800, documentTitle: "Contratto firmato" });
    expect((await getDeadlineDetail(t.db, tax.deadlineId!, TODAY))!.occurrences[0]).toMatchObject({ status: "done", completedOn: "2026-07-10" });
    await run((uow) => reopenReport(uow, tax.id));
    expect((await detail(shortId)).reports.find((r) => r.id === tax.id)!.state).toBe("open");
    expect((await getDeadlineDetail(t.db, tax.deadlineId!, TODAY))!.occurrences[0]!.status).toBe("open");
    await run((uow) => removeReport(uow, reports[0]!.id));
    expect((await detail(shortId)).reports).toHaveLength(1);
  });

  it("lo stato e la conclusione: la fine si compila, l'attivita' conclusa non conta piu' come tipo in corso", async () => {
    expect(await run((uow) => setLettingStatus(uow, shortId, "chiusa", TODAY))).toMatchObject({ ok: false, errors: { status: expect.any(Array) } });
    await run((uow) => setLettingStatus(uow, shortId, "ended", TODAY));
    expect(await detail(shortId)).toMatchObject({ status: "ended", endsOn: TODAY });
    expect(await activeLettingTypes(t.db, otherAssetId)).toEqual([]);
    expect((await listLettings(t.db, {}, TODAY)).map((l) => l.id)).toEqual([lettingId]);
    expect((await listLettings(t.db, { includeEnded: true }, TODAY)).map((l) => l.id).sort()).toEqual([lettingId, shortId].sort());
    await run((uow) => setLettingStatus(uow, shortId, "active", TODAY));
    expect(await run((uow) => updateLetting(uow, shortId, { assetId: otherAssetId, type: "accommodation", title: "Casa vacanze", status: "active" }))).toMatchObject({ ok: true });
    expect(await activeLettingTypes(t.db, otherAssetId)).toEqual(["accommodation"]);
  });

  it("il tipo di attivita' in corso e' un fatto del bene per le regole: la voce compare e sparisce con l'attivita'", async () => {
    okValue(await run((uow) => createRule(uow, { title: "Esempio: attività ricettiva", level: "national", sourceText: "Esempio", appliesWhen: { op: "contains", path: "letting.types", value: "accommodation" }, outcomes: [{ type: "checklist", key: "documenti_attivita", title: "Documenti dell'attività ricettiva", dossierCategory: "hospitality", expectedDocumentCategory: "other" }] })));
    await run((uow) => evaluateDossier(uow, otherAssetId, TODAY));
    const items = async () => (await getDossier(t.db, otherAssetId, TODAY))!.categories.flatMap((c) => c.items);
    const found = (await items()).find((i) => i.outcomeKey === "documenti_attivita")!;
    expect(found).toMatchObject({ stale: false });
    expect(found.explanation?.facts).toEqual([{ path: "letting.types", value: ["accommodation"] }]);

    await run((uow) => setLettingStatus(uow, shortId, "ended", TODAY));
    await run((uow) => evaluateDossier(uow, otherAssetId, TODAY));
    expect((await items()).find((i) => i.outcomeKey === "documenti_attivita")!.stale).toBe(true);
  });

  it("l'audit registra azioni e identificativi, mai testi, importi, codici o numeri di registrazione", async () => {
    const rows = await t.db.select().from(auditLog).where(sql`${auditLog.action} like 'letting.%'`);
    expect(new Set(rows.map((r) => r.action)).size).toBeGreaterThan(12);
    const text = JSON.stringify(rows);
    for (const secret of ["Locazione a Esempio", "REG-123", "ABC-123", "Imposta del trimestre", "Casa vacanze", "Inquilino Esempio", "Gestore Esempio", "Codice identificativo"]) expect(text, secret).not.toContain(secret);
    expect((await t.db.execute(sql`select audit_log_verify() as v`) as unknown as { rows: { v: unknown }[] }).rows[0]!.v).toBeNull();
  });
});
