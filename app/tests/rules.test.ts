import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { auditLog, rule, ruleVersion, territory } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import {
  addRuleVersion,
  cloneRule,
  createRule,
  getRule,
  listRules,
  loadActiveRules,
  seedExampleRules,
  setRuleActive,
  setVersionVerification,
} from "@/modules/rules";
import { exampleRules } from "@/modules/rules/domain/seed";
import { ruleVersionInputSchema } from "@/modules/rules/domain/rule";
import { importIstat } from "@/modules/territory";
import { createTestDb, type TestDb } from "./helpers/test-db";

const actor = { type: "owner", id: "o1" } as const;

describe("regole", () => {
  let t: TestDb;
  let municipalityId: string;
  let regionId: string;

  const run = <T>(work: Parameters<typeof runInUnitOfWork<T>>[2]) => runInUnitOfWork(t.db, actor, work);
  const base = (over: Record<string, unknown> = {}) => ({
    title: "Regola di prova",
    level: "national",
    sourceText: "Esempio",
    outcomes: [{ type: "checklist", key: "voce", title: "Voce", dossierCategory: "cadastre", expectedDocumentCategory: "cadastral" }],
    ...over,
  });
  const created = (r: { ok: boolean; value?: { id: string; key?: string } }) => {
    if (!r.ok || !r.value) throw new Error(`atteso successo: ${JSON.stringify(r)}`);
    return r.value;
  };

  beforeAll(async () => {
    t = await createTestDb();
    await run((uow) =>
      importIstat(uow, [
        { regionCode: "90", regionName: "Regione di prova", provinceCode: "900", provinceName: "Provincia di prova", provinceSigla: "PP", municipalityCode: "900001", municipalityName: "Comune Uno", cadastralCode: "Z101" },
      ]),
    );
    municipalityId = (await t.db.select().from(territory).where(eq(territory.kind, "municipality")))[0]!.id;
    regionId = (await t.db.select().from(territory).where(eq(territory.kind, "region")))[0]!.id;
  });
  afterAll(async () => {
    await t.close();
  });

  it("crea una regola con la prima versione, chiave stabile e stato 'da verificare'", async () => {
    const { id, key } = created(await run((uow) => createRule(uow, base())));
    expect(key).toMatch(/^regola_di_prova_[0-9a-f]{4}$/);
    const detail = await getRule(t.db, id);
    expect(detail).toMatchObject({ key, active: true, versions: [{ versionNo: 1, level: "national", verificationStatus: "to_verify", appliesWhen: null }] });
  });

  it("controlla livello e territorio, e le categorie (che sono dati)", async () => {
    const bad = (over: Record<string, unknown>) => run((uow) => createRule(uow, base(over)));
    expect(await bad({ level: "municipal" })).toMatchObject({ ok: false, errors: { territoryId: [expect.stringContaining("Comune")] } });
    expect(await bad({ level: "municipal", territoryId: regionId })).toMatchObject({ ok: false, errors: { territoryId: [expect.stringContaining("Comune")] } });
    expect(await bad({ level: "regional", territoryId: municipalityId })).toMatchObject({ ok: false, errors: { territoryId: expect.any(Array) } });
    expect(await bad({ level: "national", territoryId: municipalityId })).toMatchObject({ ok: false, errors: { territoryId: expect.any(Array) } });
    expect(await bad({ territoryId: "00000000-0000-4000-8000-000000000000" })).toMatchObject({ ok: false, errors: { territoryId: ["Il territorio scelto non esiste"] } });
    expect(await bad({ outcomes: [{ type: "checklist", key: "x", title: "X", dossierCategory: "inventata", expectedDocumentCategory: "nemmeno" }] })).toMatchObject({
      ok: false,
      errors: { "outcomes.0.dossierCategory": expect.any(Array), "outcomes.0.expectedDocumentCategory": expect.any(Array) },
    });
    expect(await bad({ level: "municipal", territoryId: municipalityId })).toMatchObject({ ok: true });
    expect(await bad({ level: "regional", territoryId: regionId })).toMatchObject({ ok: true });
  });

  it("modificare crea una nuova versione e lascia intatta la precedente", async () => {
    const { id } = created(await run((uow) => createRule(uow, base({ title: "Da modificare", description: "Prima" }))));
    const v2 = await run((uow) => addRuleVersion(uow, id, base({ title: "Da modificare", description: "Dopo", validFrom: "2027-01-01", verificationStatus: "verified_by_owner" })));
    expect(v2).toMatchObject({ ok: true, value: { versionNo: 2 } });

    const detail = (await getRule(t.db, id))!;
    expect(detail.versions.map((v) => [v.versionNo, v.description, v.verificationStatus])).toEqual([
      [2, "Dopo", "verified_by_owner"],
      [1, "Prima", "to_verify"],
    ]);
    const [last] = await t.db.select().from(auditLog).where(eq(auditLog.action, "rule.version.add"));
    expect(last!.diff).toMatchObject({ versionNo: 2, changed: ["description", "validFrom"] });
    expect(JSON.stringify(last!.diff)).not.toContain("Dopo");
  });

  it("una versione e' immutabile anche per chi scrive direttamente nel database; cambia solo la verifica", async () => {
    const { id } = created(await run((uow) => createRule(uow, base({ title: "Immutabile" }))));
    const version = (await getRule(t.db, id))!.versions[0]!;

    await expect(t.db.update(ruleVersion).set({ title: "Manomessa" }).where(eq(ruleVersion.id, version.id))).rejects.toThrow();
    await expect(t.db.update(ruleVersion).set({ outcomes: [] }).where(eq(ruleVersion.id, version.id))).rejects.toThrow();
    await expect(t.db.delete(ruleVersion).where(eq(ruleVersion.id, version.id))).rejects.toThrow();
    expect((await getRule(t.db, id))!.versions[0]!.title).toBe("Immutabile");

    expect(await run((uow) => setVersionVerification(uow, version.id, "validated_by_professional"))).toMatchObject({ ok: true });
    expect((await getRule(t.db, id))!.versions[0]!.verificationStatus).toBe("validated_by_professional");
    expect(await run((uow) => setVersionVerification(uow, "00000000-0000-4000-8000-000000000000", "draft"))).toMatchObject({ ok: false });
  });

  it("clona una regola come bozza indipendente e la si puo' disattivare e riattivare", async () => {
    const { id, key } = created(await run((uow) => createRule(uow, base({ title: "Originale", verificationStatus: "verified_by_owner" }))));
    const copy = created(await run((uow) => cloneRule(uow, id)));
    expect(copy.id).not.toBe(id);
    expect(copy.key).not.toBe(key);
    expect((await getRule(t.db, copy.id))!.versions[0]).toMatchObject({ title: "Originale (copia)", verificationStatus: "draft" });

    expect(await run((uow) => setRuleActive(uow, id, false))).toMatchObject({ ok: true });
    expect((await loadActiveRules(t.db)).map((r) => r.id)).not.toContain(id);
    expect((await listRules(t.db)).find((r) => r.id === id)).toMatchObject({ active: false, versionCount: 1 });
    await run((uow) => setRuleActive(uow, id, true));
    expect((await loadActiveRules(t.db)).map((r) => r.id)).toContain(id);
  });

  it("le regole di esempio sono valide, 'da verificare' e si caricano una volta sola", async () => {
    for (const seed of exampleRules({ municipalityId })) {
      const parsed = ruleVersionInputSchema.safeParse(seed.input);
      expect(parsed.success, seed.key).toBe(true);
      expect(parsed.success && parsed.data.verificationStatus).toBe("to_verify");
    }
    expect(exampleRules().some((s) => s.key === "esempio_comunale")).toBe(false);

    expect(await run((uow) => seedExampleRules(uow, municipalityId))).toMatchObject({ ok: true, value: { created: 7, skipped: 0 } });
    expect(await run((uow) => seedExampleRules(uow, municipalityId))).toMatchObject({ ok: true, value: { created: 0, skipped: 7 } });
    const comunale = (await listRules(t.db)).find((r) => r.key === "esempio_comunale")!;
    expect(comunale).toMatchObject({ territoryLabel: expect.stringContaining("Comune Uno"), current: { level: "municipal", verificationStatus: "to_verify" } });
    expect((await t.db.select().from(rule).where(eq(rule.key, "esempio_titolo"))).length).toBe(1);
  });

  it("registra nell'audit solo codici e conteggi, mai il contenuto della regola", async () => {
    const rows = await t.db.select().from(auditLog).where(sql`${auditLog.action} like 'rule.%'`);
    expect(rows.length).toBeGreaterThan(8);
    const text = JSON.stringify(rows);
    expect(text).not.toContain("Esempio illustrativo");
    expect(text).not.toContain("Documento atteso");
  });
});
