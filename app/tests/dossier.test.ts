import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { auditLog, territory } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { LocalFileStorage } from "@/platform/storage";
import { createAsset, setAssetArchived, updateAsset } from "@/modules/assets";
import { createDocument, listDocumentCategories } from "@/modules/documents";
import {
  addManualItem,
  evaluateAllDossiers,
  evaluateDossier,
  getDossier,
  linkDocument,
  listDossierCategories,
  removeManualItem,
  setItemNote,
  setItemStatus,
  unlinkDocument,
} from "@/modules/dossier";
import { addRuleVersion, createRule, getRule, listRules, seedExampleRules, setRuleActive } from "@/modules/rules";
import { importIstat } from "@/modules/territory";
import { createTestDb, type TestDb } from "./helpers/test-db";
import { makePdf } from "./helpers/sample-pdf";

const actor = { type: "owner", id: "o1" } as const;
const owner = { displayName: "Proprietario Prova", email: "prova@example.test" };
const TODAY = "2026-06-15";

describe("dossier", () => {
  let t: TestDb;
  let dir: string;
  let storage: LocalFileStorage;
  let comuneUno: string;
  let comuneDue: string;
  let assetId: string;

  const run = <T>(work: Parameters<typeof runInUnitOfWork<T>>[2]) => runInUnitOfWork(t.db, actor, work);
  const evaluate = (id = assetId, asOf = TODAY) => run((uow) => evaluateDossier(uow, id, asOf));
  const dossier = async (id = assetId) => (await getDossier(t.db, id, TODAY))!;
  const items = async (id = assetId) => (await dossier(id)).categories.flatMap((c) => c.items);
  const item = async (ruleKey: string, outcomeKey: string, id = assetId) => (await items(id)).find((i) => i.ruleKey === ruleKey && i.outcomeKey === outcomeKey)!;
  const okValue = <V>(r: { ok: boolean; value?: V }): V => {
    if (!r.ok) throw new Error(`atteso successo: ${JSON.stringify(r)}`);
    return r.value as V;
  };
  const assetInput = (over: Record<string, unknown> = {}) => ({
    kind: "dwelling",
    name: "Bene del dossier",
    territoryId: comuneUno,
    useType: "primary_residence",
    inCondominium: true,
    rights: [
      { holder: { type: "self" }, rightType: "co_ownership", quotaNumerator: 1, quotaDenominator: 2 },
      { holder: { type: "self" }, rightType: "co_ownership", quotaNumerator: 1, quotaDenominator: 4 },
    ],
    attributes: [{ key: "anno_costruzione", type: "number", value: "1985" }],
    ...over,
  });

  beforeAll(async () => {
    t = await createTestDb();
    dir = await mkdtemp(join(tmpdir(), "dossier-test-"));
    storage = new LocalFileStorage(dir);
    const row = (n: number, name: string) => ({ regionCode: "90", regionName: "Regione di prova", provinceCode: "900", provinceName: "Provincia di prova", provinceSigla: "PP", municipalityCode: String(900000 + n), municipalityName: name, cadastralCode: `Z${100 + n}` });
    await run((uow) => importIstat(uow, [row(1, "Comune Uno"), row(2, "Comune Due")]));
    const municipalities = await t.db.select().from(territory).where(eq(territory.kind, "municipality"));
    comuneUno = municipalities.find((m) => m.name === "Comune Uno")!.id;
    comuneDue = municipalities.find((m) => m.name === "Comune Due")!.id;
    await run((uow) => seedExampleRules(uow, comuneUno));
    assetId = okValue(await run((uow) => createAsset(uow, owner, assetInput()))).id;
  }, 60_000);
  afterAll(async () => {
    await t.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("le categorie del dossier sono dati: le 13 della specifica", async () => {
    const categories = await listDossierCategories(t.db);
    expect(categories).toHaveLength(13);
    expect(categories.map((c) => c.code)).toEqual(["title", "cadastre", "building", "habitability", "condominium", "systems", "taxes", "utilities", "insurance", "works", "lettings", "hospitality", "disputes"]);
  });

  it("la prima valutazione crea le voci attese e ogni voce e' spiegata", async () => {
    const result = await evaluate();
    expect(result).toMatchObject({ ok: true, value: { created: 7, updated: 0, staled: 0, unchanged: 0 } });
    const all = await items();
    expect(all.map((i) => `${i.ruleKey}/${i.outcomeKey}`).sort()).toEqual([
      "esempio_catasto/planimetria",
      "esempio_catasto/visura",
      "esempio_comunale/ricevute_tributi_locali",
      "esempio_condominio/regolamento",
      "esempio_condominio/verbale",
      "esempio_impianti/documentazione_impianti",
      "esempio_titolo/atto_provenienza",
    ]);
    expect(all.every((i) => i.status === "missing" && i.origin === "rule" && !i.stale && i.unverifiedRule)).toBe(true);

    const impianti = await item("esempio_impianti", "documentazione_impianti");
    expect(impianti.explanation).toMatchObject({
      ruleTitle: "Esempio: documentazione degli impianti",
      versionNo: 1,
      level: "national",
      verificationStatus: "to_verify",
      facts: [{ path: "attributes.anno_costruzione", value: 1985 }],
    });
    expect(impianti.expectedDocumentCategoryName).toContain("Impianti");
    const comunale = await item("esempio_comunale", "ricevute_tributi_locali");
    expect(comunale.explanation).toMatchObject({ level: "municipal", territoryId: comuneUno });
  });

  it("una regola comunale non si applica a un bene di un altro Comune", async () => {
    const other = okValue(await run((uow) => createAsset(uow, owner, assetInput({ name: "Altro Comune", territoryId: comuneDue, inCondominium: false, attributes: [], rights: [] })))).id;
    await evaluate(other);
    const keys = (await items(other)).map((i) => i.ruleKey);
    expect(keys).not.toContain("esempio_comunale");
    expect(keys).not.toContain("esempio_condominio");
    expect(keys).not.toContain("esempio_impianti");
    expect(keys).toContain("esempio_titolo");
  });

  it("gli avvisi sono calcolati dalle regole e non sono voci del dossier", async () => {
    const d = await dossier();
    expect(d.notices.map((n) => n.outcomeKey)).toEqual(["piu_titolari"]);
    expect(d.notices[0]!.explanation.facts).toEqual([{ path: "rights.regimes", value: ["co_ownership"] }]);
    expect((await items()).some((i) => i.outcomeKey === "piu_titolari")).toBe(false);
  });

  it("rivalutare senza cambiamenti non scrive nulla, nemmeno nell'audit", async () => {
    const before = (await t.db.select().from(auditLog)).length;
    expect(await evaluate()).toMatchObject({ ok: true, value: { created: 0, updated: 0, staled: 0, restored: 0, unchanged: 7 } });
    expect((await t.db.select().from(auditLog)).length).toBe(before);
  });

  it("stato, nota e documenti scelti dal proprietario non vengono mai toccati dal motore", async () => {
    const visura = await item("esempio_catasto", "visura");
    const categoryId = (await listDocumentCategories(t.db)).find((c) => c.code === "cadastral")!.id;
    const doc = okValue(await run((uow) => createDocument(uow, { title: "Visura 2026", categoryId, assetIds: [assetId], validTo: "2026-03-01" }, { name: "visura.pdf", bytes: makePdf("visura") }, storage)));

    // Collegare un documento a una voce "mancante" la porta a "presente".
    expect(await run((uow) => linkDocument(uow, visura.id, doc.id))).toMatchObject({ ok: true, value: { status: "present" } });
    await run((uow) => setItemNote(uow, visura.id, "Chiesta al commercialista"));
    await run((uow) => setItemStatus(uow, (visura.id), "validated_by_professional"));

    // Il documento e' scaduto (validTo nel passato): lo si segnala, senza cambiare lo stato scelto.
    const view = await item("esempio_catasto", "visura");
    expect(view).toMatchObject({ status: "validated_by_professional", ownerNote: "Chiesta al commercialista" });
    expect(view.documents).toEqual([expect.objectContaining({ id: doc.id, title: "Visura 2026", expired: true })]);

    // Una rivalutazione, anche dopo una modifica del bene, lascia tutto com'e'.
    await run((uow) => updateAsset(uow, owner, assetId, assetInput({ notes: "cambiato" })));
    await evaluate();
    expect(await item("esempio_catasto", "visura")).toMatchObject({ status: "validated_by_professional", ownerNote: "Chiesta al commercialista", documents: [expect.objectContaining({ id: doc.id })] });

    expect(await run((uow) => unlinkDocument(uow, visura.id, doc.id))).toMatchObject({ ok: true });
    expect((await item("esempio_catasto", "visura")).documents).toEqual([]);
    expect(await run((uow) => linkDocument(uow, visura.id, "00000000-0000-4000-8000-000000000000"))).toMatchObject({ ok: false, errors: { documentId: expect.any(Array) } });
  });

  it("quando una regola non si applica piu' la voce resta, segnata, e torna se la regola torna", async () => {
    const regolamento = await item("esempio_condominio", "regolamento");
    await run((uow) => setItemStatus(uow, regolamento.id, "present"));

    await run((uow) => updateAsset(uow, owner, assetId, assetInput({ inCondominium: false })));
    expect(await evaluate()).toMatchObject({ ok: true, value: { staled: 2, created: 0 } });
    expect(await item("esempio_condominio", "regolamento")).toMatchObject({ stale: true, status: "present" });
    expect((await dossier()).staleCount).toBe(2);

    await run((uow) => updateAsset(uow, owner, assetId, assetInput({ inCondominium: true })));
    expect(await evaluate()).toMatchObject({ ok: true, value: { restored: 2, staled: 0 } });
    expect(await item("esempio_condominio", "regolamento")).toMatchObject({ stale: false, status: "present" });
  });

  it("una nuova versione della regola aggiorna la derivazione ma conserva la voce e il suo stato", async () => {
    const before = await item("esempio_titolo", "atto_provenienza");
    await run((uow) => setItemStatus(uow, before.id, "to_verify"));
    const rule = (await listRules(t.db)).find((r) => r.key === "esempio_titolo")!;
    const v = rule.current;
    expect(
      await run((uow) =>
        addRuleVersion(uow, rule.id, {
          title: v.title,
          level: v.level,
          sourceText: v.sourceText,
          verificationStatus: "verified_by_owner",
          outcomes: [{ type: "checklist", key: "atto_provenienza", title: "Atto di provenienza aggiornato", dossierCategory: "title", expectedDocumentCategory: "title_deed" }],
        }),
      ),
    ).toMatchObject({ ok: true, value: { versionNo: 2 } });

    expect(await evaluate()).toMatchObject({ ok: true, value: { updated: 1, created: 0 } });
    const after = await item("esempio_titolo", "atto_provenienza");
    expect(after).toMatchObject({ id: before.id, title: "Atto di provenienza aggiornato", status: "to_verify", unverifiedRule: false });
    expect(after.explanation).toMatchObject({ versionNo: 2, verificationStatus: "verified_by_owner" });
    // La versione 1 e' ancora leggibile nello storico, con la sua fonte.
    const detail = await getRule(t.db, rule.id);
    expect(detail!.versions.map((x) => x.versionNo)).toEqual([2, 1]);
  });

  it("versioni per periodo: la regola cambia a seconda della data di valutazione", async () => {
    const created = okValue(
      await run((uow) =>
        createRule(uow, {
          title: "Regola per anno",
          level: "national",
          sourceText: "Esempio",
          validTo: "2026-12-31",
          outcomes: [{ type: "checklist", key: "voce_anno", title: "Voce valida nel 2026", dossierCategory: "taxes" }],
        }),
      ),
    );
    await run((uow) =>
      addRuleVersion(uow, created.id, {
        title: "Regola per anno",
        level: "national",
        sourceText: "Esempio",
        validFrom: "2027-01-01",
        outcomes: [{ type: "checklist", key: "voce_anno", title: "Voce valida dal 2027", dossierCategory: "taxes" }],
      }),
    );
    await evaluate(assetId, "2026-06-15");
    expect((await item(created.key, "voce_anno")).title).toBe("Voce valida nel 2026");
    await evaluate(assetId, "2027-02-01");
    expect(await item(created.key, "voce_anno")).toMatchObject({ title: "Voce valida dal 2027", status: "missing" });
    await evaluate(assetId, "2026-06-15"); // ritorno alla data di prima: la voce si riallinea alla versione in vigore
    expect((await item(created.key, "voce_anno")).title).toBe("Voce valida nel 2026");
  });

  it("disattivare una regola rende 'non piu' applicabili' le sue voci, senza cancellarle", async () => {
    const rule = (await listRules(t.db)).find((r) => r.key === "esempio_catasto")!;
    await run((uow) => setRuleActive(uow, rule.id, false));
    expect(await evaluate()).toMatchObject({ ok: true, value: { staled: 2 } });
    expect(await item("esempio_catasto", "visura")).toMatchObject({ stale: true });
    await run((uow) => setRuleActive(uow, rule.id, true));
    expect(await evaluate()).toMatchObject({ ok: true, value: { restored: 2 } });
  });

  it("le voci manuali si aggiungono e si cancellano; quelle da regola si segnano 'non applicabile'", async () => {
    const categoryId = (await listDossierCategories(t.db)).find((c) => c.code === "disputes")!.id;
    const manual = okValue(await run((uow) => addManualItem(uow, assetId, { categoryId, title: "Lettera dell'amministratore", ownerNote: "Del 2025" })));
    const view = (await items()).find((i) => i.id === manual.id)!;
    expect(view).toMatchObject({ origin: "manual", status: "missing", ruleKey: null, explanation: null, ownerNote: "Del 2025" });

    expect(await run((uow) => addManualItem(uow, assetId, { categoryId: "non-un-uuid", title: " " }))).toMatchObject({ ok: false, errors: { categoryId: expect.any(Array), title: expect.any(Array) } });
    expect(await run((uow) => removeManualItem(uow, manual.id))).toMatchObject({ ok: true });
    expect((await items()).some((i) => i.id === manual.id)).toBe(false);

    const derived = await item("esempio_titolo", "atto_provenienza");
    expect(await run((uow) => removeManualItem(uow, derived.id))).toMatchObject({ ok: false });
    expect(await run((uow) => setItemStatus(uow, derived.id, "non-uno-stato"))).toMatchObject({ ok: false });
    expect(await run((uow) => setItemStatus(uow, derived.id, "not_applicable"))).toMatchObject({ ok: true });
  });

  it("il riepilogo conta gli stati e non dice mai che il bene e' a norma", async () => {
    const d = await dossier();
    const total = d.categories.flatMap((c) => c.items).length;
    expect(d.summary.total).toBe(total);
    expect(Object.values(d.summary.byStatus).reduce((a, b) => a + b, 0)).toBe(total);
    expect(d.summary.byStatus.not_applicable).toBe(1);
    expect(Object.keys(d.summary)).toEqual(["total", "byStatus"]);
  });

  it("un bene archiviato non si valuta; la rivalutazione generale tocca solo i beni attivi", async () => {
    const archived = okValue(await run((uow) => createAsset(uow, owner, assetInput({ name: "Archiviato", rights: [], attributes: [] })))).id;
    await run((uow) => setAssetArchived(uow, archived, true));
    expect(await evaluate(archived)).toMatchObject({ ok: false });
    expect(await run((uow) => evaluateAllDossiers(uow, TODAY))).toMatchObject({ assets: 2 });
  });

  it("l'audit registra stati e conteggi, non note, titoli dei documenti o contenuti delle regole", async () => {
    const rows = await t.db.select().from(auditLog).where(sql`${auditLog.action} like 'dossier.%'`);
    const actions = new Set(rows.map((r) => r.action));
    for (const a of ["dossier.evaluate", "dossier.item.status", "dossier.item.note", "dossier.item.link", "dossier.item.unlink", "dossier.item.create", "dossier.item.delete"]) expect(actions, a).toContain(a);
    const text = JSON.stringify(rows);
    expect(text).not.toContain("Chiesta al commercialista");
    expect(text).not.toContain("Visura 2026");
    expect(text).not.toContain("Lettera dell'amministratore");
    expect(rows.find((r) => r.action === "dossier.item.link")!.diff).toMatchObject({ statusFrom: "missing", statusTo: "present" });
    expect(rowsValid(await t.db.execute(sql`select audit_log_verify() as v`))).toBeNull();
  });
});

const rowsValid = (result: unknown) => (result as { rows: { v: unknown }[] }).rows[0]!.v;
