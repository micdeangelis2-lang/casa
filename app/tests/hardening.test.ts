import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { eq, sql } from "drizzle-orm";
import { territory } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { LocalFileStorage } from "@/platform/storage";
import { createAsset } from "@/modules/assets";
import { createDeadline, completeOccurrence, getDeadlineDetail } from "@/modules/deadlines";
import { createDocument, listDocumentCategories } from "@/modules/documents";
import { addCode, addRent, createLetting } from "@/modules/lettings";
import { addPremium, createPolicy } from "@/modules/insurance";
import { createObligation, createTaxType, updateObligation } from "@/modules/taxes";
import { importIstat } from "@/modules/territory";
import { createTestDb, type TestDb } from "./helpers/test-db";
import { makePdf } from "./helpers/sample-pdf";

/**
 * Indurimento dello schema (migrazione 0023): CHECK sulle enumerazioni, univoci di business con messaggio leggibile,
 * documenti che non si cancellano portandosi via le prove.
 */

const actor = { type: "owner", id: "o1" } as const;
const owner = { displayName: "Proprietario Prova", email: "prova@example.test" };
const TODAY = "2026-06-15";

describe("indurimento dello schema", () => {
  let t: TestDb;
  let dir: string;
  let storage: LocalFileStorage;
  let assetId: string;
  let documentId: string;

  const run = <T>(work: Parameters<typeof runInUnitOfWork<T>>[2]) => runInUnitOfWork(t.db, actor, work);
  const okValue = <V>(r: { ok: boolean; value?: V }): V => {
    if (!r.ok) throw new Error(`atteso successo: ${JSON.stringify(r)}`);
    return r.value as V;
  };
  const rejects = async (statement: ReturnType<typeof sql>) => {
    await expect(t.db.execute(statement)).rejects.toThrow();
  };

  beforeAll(async () => {
    t = await createTestDb();
    dir = await mkdtemp(join(tmpdir(), "hardening-test-"));
    storage = new LocalFileStorage(dir);
    await run((uow) => importIstat(uow, [{ regionCode: "90", regionName: "Regione di prova", provinceCode: "900", provinceName: "Provincia di prova", provinceSigla: "PP", municipalityCode: "900001", municipalityName: "Comune Uno", cadastralCode: "Z101" }]));
    const municipalityId = (await t.db.select().from(territory).where(eq(territory.kind, "municipality")))[0]!.id;
    assetId = okValue(await run((uow) => createAsset(uow, owner, { kind: "dwelling", name: "Bene di prova", territoryId: municipalityId }))).id;
    const categoryId = (await listDocumentCategories(t.db))[0]!.id;
    documentId = okValue(await run((uow) => createDocument(uow, { title: "Ricevuta", categoryId }, { name: "ricevuta.pdf", bytes: makePdf("ricevuta") }, storage))).id;
  }, 60_000);
  afterAll(async () => {
    await t.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("le enumerazioni testuali hanno un CHECK nel database", async () => {
    await rejects(sql`update asset set kind = 'castello' where id = ${assetId}`);
    await rejects(sql`update territory set source = 'altro' where id = (select id from territory limit 1)`);
    await rejects(sql`insert into deadline (title, category, level, calc) values ('x', 'boh', 'national', '{}'::jsonb)`);
    await rejects(sql`insert into audit_log (actor_type, actor_id, action, entity_type, entity_id) values ('robot', 'x', 'a.b', 'e', 'i')`);
    const checks = (await t.db.execute(sql`select conname, convalidated from pg_constraint where conname in ('asset_kind_check','territory_source_check','deadline_category_check','audit_log_actor_type_check','share_package_item_confidentiality_check')`)) as unknown as { rows: { conname: string; convalidated: boolean }[] };
    expect(checks.rows).toHaveLength(5);
    expect(checks.rows.every((r) => r.convalidated)).toBe(true);
  });

  it("canoni: due scadenze uguali nella stessa locazione danno un messaggio in italiano", async () => {
    const lettingId = okValue(await run((uow) => createLetting(uow, { assetId, type: "residential", title: "Locazione", startsOn: "2026-07-01", endsOn: "2030-06-30" }))).id;
    expect(await run((uow) => addRent(uow, lettingId, { dueOn: "2026-07-05", amount: "500,00" }))).toMatchObject({ ok: true });
    expect(await run((uow) => addRent(uow, lettingId, { dueOn: "2026-07-05", amount: "100,00" }))).toMatchObject({ ok: false, errors: { dueOn: ["Esiste già un canone con questa scadenza"] } });
    expect(await run((uow) => addRent(uow, lettingId, { dueOn: "2026-08-05", amount: "500,00" }))).toMatchObject({ ok: true });
    // Il database lo impone comunque.
    await rejects(sql`insert into letting_rent (letting_id, due_on, amount_cents) values (${lettingId}, '2026-07-05', 1)`);

    expect(await run((uow) => addCode(uow, lettingId, { label: "Codice A", value: "123" }))).toMatchObject({ ok: true });
    expect(await run((uow) => addCode(uow, lettingId, { label: "Codice A", value: "123" }))).toMatchObject({ ok: false, errors: { value: [expect.stringContaining("già")] } });
    expect(await run((uow) => addCode(uow, lettingId, { label: "Codice A", value: "456" }))).toMatchObject({ ok: true });
  });

  it("premi: una sola rata per scadenza", async () => {
    const policyId = okValue(await run((uow) => createPolicy(uow, { title: "Polizza di prova" }))).id;
    expect(await run((uow) => addPremium(uow, policyId, { dueOn: "2026-09-01", amount: "300,00" }))).toMatchObject({ ok: true });
    expect(await run((uow) => addPremium(uow, policyId, { dueOn: "2026-09-01", amount: "300,00" }))).toMatchObject({ ok: false, errors: { dueOn: ["Esiste già un premio con questa scadenza"] } });
    expect(await run((uow) => addPremium(uow, policyId, { dueOn: "2027-09-01", amount: "300,00" }))).toMatchObject({ ok: true });
  });

  it("tributi: stessa voce solo con etichette diverse; la modifica non collide con se stessa", async () => {
    const typeId = okValue(await run((uow) => createTaxType(uow, { name: "Tributo di prova", kind: "tax" }))).id;
    const base = { assetId, taxTypeId: typeId, year: 2026 };
    const first = okValue(await run((uow) => createObligation(uow, { ...base }))).id;
    expect(await run((uow) => createObligation(uow, { ...base }))).toMatchObject({ ok: false, errors: { label: [expect.stringContaining("etichetta")] } });
    const acconto = okValue(await run((uow) => createObligation(uow, { ...base, label: "Acconto" }))).id;
    expect(await run((uow) => createObligation(uow, { ...base, label: "Acconto" }))).toMatchObject({ ok: false });
    expect(await run((uow) => updateObligation(uow, acconto, { ...base, label: "Saldo" }))).toMatchObject({ ok: true });
    expect(await run((uow) => updateObligation(uow, first, { ...base, label: "Saldo" }))).toMatchObject({ ok: false, errors: { label: expect.any(Array) } });
    expect(await run((uow) => updateObligation(uow, first, { ...base, note: "nota" }))).toMatchObject({ ok: true });
    await rejects(sql`insert into tax_obligation (asset_id, tax_type_id, year, label) values (${assetId}, ${typeId}, 2026, null)`);
  });

  it("un documento che e' prova di una scadenza non si cancella: l'archiviazione e' l'unica via", async () => {
    const deadlineId = okValue(await run((uow) => createDeadline(uow, { title: "Con prova", category: "fiscal", level: "national", calc: { type: "manual" }, firstDueOn: "2026-07-01", proofRequired: true }, TODAY))).id;
    const occurrence = (await getDeadlineDetail(t.db, deadlineId, TODAY))!.occurrences[0]!;
    expect(await run((uow) => completeOccurrence(uow, occurrence.id, { completionKind: "owner", documentId }, TODAY))).toMatchObject({ ok: true });
    await expect(t.db.execute(sql`delete from document where id = ${documentId}`)).rejects.toThrow();
    const proofs = (await t.db.execute(sql`select count(*)::int as n from deadline_proof where document_id = ${documentId}`)) as unknown as { rows: { n: number }[] };
    expect(proofs.rows[0]!.n).toBe(1);
    const policies = (await t.db.execute(sql`select confdeltype, conrelid::regclass::text as t from pg_constraint where confrelid = 'document'::regclass and contype = 'f' and confdeltype = 'c'`)) as unknown as { rows: { t: string }[] };
    // Restano a cascata solo le parti del documento stesso (versioni e legame ai beni).
    expect(policies.rows.map((r) => r.t).sort()).toEqual(["document_asset", "document_version"]);
  });

  it("la migrazione non fallisce se esistono gia' duplicati o righe fuori elenco: lascia un avviso", async () => {
    const file = await readFile(resolve(__dirname, "../drizzle/0023_hardening_checks_uniques.sql"), "utf8");
    const all = file.split("--> statement-breakpoint").map((x) => x.trim());
    const statements = [
      all.find((x) => x.startsWith("ALTER TABLE") && x.includes('"asset_kind_check"')),
      all.find((x) => x.startsWith("DO $$") && x.includes('"asset_kind_check"')),
      all.find((x) => x.startsWith("DO $$") && x.includes("letting_rent_letting_due_uq")),
    ].filter((x): x is string => x !== undefined);
    expect(statements).toHaveLength(3);
    // Stato "prima della migrazione": tolti indici e vincoli, poi inseriti dati che li violerebbero.
    const lettingId = (await t.db.execute(sql`select id from letting limit 1`)) as unknown as { rows: { id: string }[] };
    const id = lettingId.rows[0]!.id;
    await t.db.execute(sql`drop index letting_rent_letting_due_uq`);
    await t.db.execute(sql`alter table asset drop constraint asset_kind_check`);
    await t.db.execute(sql`insert into letting_rent (letting_id, due_on, amount_cents) values (${id}, '2026-07-05', 1)`);
    await t.db.execute(sql`update asset set kind = 'vecchio_tipo' where id = ${assetId}`);
    for (const statement of statements) await t.db.execute(sql.raw(statement));
    const state = (await t.db.execute(sql`select
      (select count(*)::int from pg_indexes where indexname = 'letting_rent_letting_due_uq') as idx,
      (select convalidated from pg_constraint where conname = 'asset_kind_check') as validated`)) as unknown as { rows: { idx: number; validated: boolean }[] };
    expect(state.rows[0]).toEqual({ idx: 0, validated: false });
    // Ripristino dello stato corretto per gli altri test.
    await t.db.execute(sql`update asset set kind = 'dwelling' where id = ${assetId}`);
    await t.db.execute(sql`delete from letting_rent where letting_id = ${id} and due_on = '2026-07-05' and amount_cents = 1`);
  });
});
