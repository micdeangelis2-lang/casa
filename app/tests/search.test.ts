import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { territory } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { LocalFileStorage } from "@/platform/storage";
import { createAsset } from "@/modules/assets";
import { createCondominium } from "@/modules/condominium";
import { createDeadline } from "@/modules/deadlines";
import { createParty } from "@/modules/directory";
import { createDocument, listDocumentCategories } from "@/modules/documents";
import { createPolicy } from "@/modules/insurance";
import { createLetting } from "@/modules/lettings";
import { createWork } from "@/modules/maintenance";
import { createMatter } from "@/modules/matters";
import { createRule } from "@/modules/rules";
import { cleanQuery, matchesAll, normalize, searchAll } from "@/modules/search";
import { createObligation, createTaxType } from "@/modules/taxes";
import { importIstat } from "@/modules/territory";
import { createTestDb, type TestDb } from "./helpers/test-db";
import { makePdf } from "./helpers/sample-pdf";

const actor = { type: "owner", id: "o1" } as const;
const owner = { displayName: "Proprietario Prova", email: "prova@example.test" };

describe("ricerca: testo cercato", () => {
  it("ignora maiuscole, accenti e spazi doppi", () => {
    expect(normalize("Caffè ÈLITE")).toBe("caffe elite");
    expect(matchesAll("caffe", "Bar Caffè Centrale")).toBe(true);
    expect(matchesAll("  CAFFÈ   centrale ", "Bar Caffè Centrale")).toBe(true);
    expect(matchesAll("caffe", null, undefined, "Altro")).toBe(false);
  });

  it("tutte le parole devono comparire, anche in campi diversi", () => {
    expect(matchesAll("rossi caldaia", "Mario Rossi", "Sostituzione caldaia")).toBe(true);
    expect(matchesAll("rossi tetto", "Mario Rossi", "Sostituzione caldaia")).toBe(false);
  });

  it("un testo troppo corto non si cerca; uno troppo lungo si taglia", () => {
    expect(cleanQuery(null)).toBeNull();
    expect(cleanQuery(" a ")).toBeNull();
    expect(cleanQuery("  ab  ")).toBe("ab");
    expect(cleanQuery("x".repeat(300))).toHaveLength(100);
  });
});

describe("ricerca: nei moduli", () => {
  let t: TestDb;
  let dir: string;
  let storage: LocalFileStorage;
  let assetId: string;

  const run = <V>(work: Parameters<typeof runInUnitOfWork<V>>[2]) => runInUnitOfWork(t.db, actor, work);
  const okValue = <V>(r: { ok: boolean; value?: V }): V => {
    if (!r.ok) throw new Error(`atteso successo: ${JSON.stringify(r)}`);
    return r.value as V;
  };
  const groupsFor = async (q: string) => (await searchAll(t.db, q))?.groups.map((g) => g.group) ?? null;

  beforeAll(async () => {
    t = await createTestDb();
    dir = await mkdtemp(join(tmpdir(), "search-test-"));
    storage = new LocalFileStorage(dir);
    await run((uow) => importIstat(uow, [{ regionCode: "90", regionName: "Regione di prova", provinceCode: "900", provinceName: "Provincia di prova", provinceSigla: "PP", municipalityCode: "900001", municipalityName: "Comune Uno", cadastralCode: "Z101" }]));
    const municipalityId = (await t.db.select().from(territory).where(eq(territory.kind, "municipality")))[0]!.id;
    assetId = okValue(await run((uow) => createAsset(uow, owner, { kind: "dwelling", name: "Villa Girasole", territoryId: municipalityId, address: "Via dei Girasoli 3" }))).id;
    okValue(await run((uow) => createParty(uow, { displayName: "Giulia Girasoli", roles: ["tenant"], email: "giulia@example.test" })));
    okValue(await run((uow) => createParty(uow, { displayName: "Società Perché", roles: ["supplier"] })));
    const categoryId = (await listDocumentCategories(t.db))[0]!.id;
    okValue(await run((uow) => createDocument(uow, { title: "Contratto di fornitura girasole", categoryId }, { name: "contratto.pdf", bytes: makePdf("clausola unica") }, storage)));
    okValue(await run((uow) => createDeadline(uow, { title: "Rinnovo girasole", category: "administrative", level: "national", calc: { type: "manual" }, firstDueOn: "2030-01-31", priority: "normal" })));
    const typeId = okValue(await run((uow) => createTaxType(uow, { name: "Imposta locale" }))).id;
    okValue(await run((uow) => createObligation(uow, { assetId, taxTypeId: typeId, year: 2026, label: "Girasole acconto" })));
    okValue(await run((uow) => createCondominium(uow, { name: "Condominio Girasole" })));
    okValue(await run((uow) => createWork(uow, { assetId, title: "Potatura girasoli" })));
    okValue(await run((uow) => createPolicy(uow, { title: "Polizza Girasole", policyNumber: "POL-9", assetIds: [assetId] })));
    okValue(await run((uow) => createLetting(uow, { assetId, type: "short_term", title: "Casa vacanze Girasole" })));
    okValue(await run((uow) => createMatter(uow, { title: "Pratica girasole" })));
    okValue(await run((uow) => createRule(uow, { title: "Regola girasole", level: "national", sourceText: "Esempio", outcomes: [{ type: "checklist", key: "voce", title: "Voce", dossierCategory: "cadastre", expectedDocumentCategory: "cadastral" }] })));
  }, 90_000);
  afterAll(async () => {
    await t.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("un testo troppo corto non cerca nulla", async () => {
    expect(await searchAll(t.db, "g")).toBeNull();
    expect(await searchAll(t.db, "")).toBeNull();
    expect(await searchAll(t.db, null)).toBeNull();
  });

  it("trova lo stesso testo in tutte le sezioni, nell'ordine dei gruppi, senza badare ad accenti e maiuscole", async () => {
    expect(await groupsFor("GIRASOLE")).toEqual(["assets", "documents", "deadlines", "taxes", "condominium", "maintenance", "insurance", "lettings", "matters", "rules"]);
    const outcome = (await searchAll(t.db, "Girasole"))!;
    expect(outcome.total).toBe(outcome.groups.reduce((n, g) => n + g.total, 0));
    const hrefs = Object.fromEntries(outcome.groups.map((g) => [g.group, g.items[0]!.href]));
    expect(hrefs).toMatchObject({
      assets: `/immobili/${assetId}`,
      documents: expect.stringMatching(/^\/documenti\/[0-9a-f-]{36}$/),
      deadlines: expect.stringMatching(/^\/scadenze\/[0-9a-f-]{36}$/),
      taxes: expect.stringMatching(/^\/tributi\/[0-9a-f-]{36}$/),
      condominium: expect.stringMatching(/^\/condominio\/[0-9a-f-]{36}$/),
      maintenance: expect.stringMatching(/^\/manutenzioni\/[0-9a-f-]{36}$/),
      insurance: expect.stringMatching(/^\/assicurazioni\/[0-9a-f-]{36}$/),
      lettings: expect.stringMatching(/^\/locazioni\/[0-9a-f-]{36}$/),
      matters: expect.stringMatching(/^\/pratiche\/[0-9a-f-]{36}$/),
      rules: expect.stringMatching(/^\/regole\/[0-9a-f-]{36}$/),
    });
  });

  it("la rubrica si cerca per nome e per email; i documenti anche nel testo del file", async () => {
    expect(await groupsFor("giulia")).toEqual(["parties"]);
    expect(await groupsFor("giulia@example")).toEqual(["parties"]);
    expect(await groupsFor("clausola unica")).toEqual(["documents"]);
    // Senza badare agli accenti anche dove cerca il database (rubrica e titoli dei documenti).
    expect(await groupsFor("societa perche")).toEqual(["parties"]);
    expect(await groupsFor("FORNITURA GIRASOLE")).toEqual(["documents"]);
  });

  it("piu' parole restringono il risultato e un testo senza corrispondenze non da' gruppi", async () => {
    expect(await groupsFor("polizza girasole")).toEqual(["insurance"]);
    expect(await groupsFor("pol-9")).toEqual(["insurance"]);
    const none = (await searchAll(t.db, "zzzzzz"))!;
    expect(none).toMatchObject({ query: "zzzzzz", groups: [], total: 0 });
  });

  it("per gruppo si mostrano al massimo 8 risultati ma il totale conta tutti", async () => {
    for (let i = 0; i < 10; i += 1) okValue(await run((uow) => createMatter(uow, { title: `Pratica numerata ${i}` })));
    const group = (await searchAll(t.db, "pratica numerata"))!.groups[0]!;
    expect(group).toMatchObject({ group: "matters", total: 10 });
    expect(group.items).toHaveLength(8);
  });
});
