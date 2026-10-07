import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { fromFlat, toFlat } from "@/modules/rules/domain/condition-form";
import { conditionSchema, evaluateCondition, factsUsed, type Condition, type Facts } from "@/modules/rules/domain/condition";
import { effectiveVersion, evaluateRules, ruleKeyFrom, ruleVersionInputSchema, type RuleVersion, type RuleWithVersions } from "@/modules/rules/domain/rule";

const facts = (over: Partial<Facts> = {}): Facts => ({
  asset: { kind: "dwelling", useType: "primary_residence", inCondominium: true },
  rights: { regimes: ["co_ownership"] },
  attributes: { anno_costruzione: 1985, ascensore: true, classe: "D" },
  ...over,
});

const leaf = (op: string, path: string, value?: unknown) => ({ op, path, ...(value === undefined ? {} : { value }) }) as Condition;

describe("condizioni", () => {
  it("valuta i confronti sui fatti", () => {
    const f = facts();
    const ok = (c: Condition) => evaluateCondition(c, f).result;
    expect(ok(leaf("eq", "asset.kind", "dwelling"))).toBe(true);
    expect(ok(leaf("eq", "asset.kind", "garage"))).toBe(false);
    expect(ok(leaf("in", "asset.kind", ["garage", "dwelling"]))).toBe(true);
    expect(ok(leaf("eq", "asset.inCondominium", true))).toBe(true);
    expect(ok(leaf("contains", "rights.regimes", "co_ownership"))).toBe(true);
    expect(ok(leaf("contains", "rights.regimes", "usufruct"))).toBe(false);
    expect(ok(leaf("lte", "attributes.anno_costruzione", 1990))).toBe(true);
    expect(ok(leaf("gte", "attributes.anno_costruzione", 1990))).toBe(false);
    expect(ok(leaf("exists", "attributes.ascensore"))).toBe(true);
    expect(ok(leaf("exists", "attributes.inesistente"))).toBe(false);
  });

  it("un fatto mancante o di tipo diverso rende falso il confronto, mai un errore", () => {
    const f = facts({ asset: { kind: "land", useType: null, inCondominium: false } });
    expect(evaluateCondition(leaf("eq", "asset.useType", "let"), f).result).toBe(false);
    expect(evaluateCondition(leaf("exists", "asset.useType"), f).result).toBe(false);
    expect(evaluateCondition(leaf("gte", "attributes.classe", 3), facts()).result).toBe(false);
    expect(evaluateCondition(leaf("lte", "attributes.nulla", 3), facts()).result).toBe(false);
    expect(evaluateCondition(leaf("eq", "rights.regimes", "full"), facts()).result).toBe(false);
  });

  it("all, any e not si combinano, e senza condizione la regola vale sempre", () => {
    const f = facts();
    const yes = leaf("eq", "asset.kind", "dwelling");
    const no = leaf("eq", "asset.kind", "garage");
    expect(evaluateCondition({ all: [yes, yes] }, f).result).toBe(true);
    expect(evaluateCondition({ all: [yes, no] }, f).result).toBe(false);
    expect(evaluateCondition({ any: [no, yes] }, f).result).toBe(true);
    expect(evaluateCondition({ any: [no, no] }, f).result).toBe(false);
    expect(evaluateCondition({ not: no }, f).result).toBe(true);
    expect(evaluateCondition(null, f)).toEqual({ result: true, trace: null });
  });

  it("la spiegazione riporta il fatto usato e il valore atteso per ogni confronto", () => {
    const { trace } = evaluateCondition({ all: [leaf("eq", "asset.kind", "garage"), { not: leaf("exists", "attributes.ascensore") }] }, facts());
    expect(trace).toMatchObject({
      kind: "all",
      result: false,
      children: [
        { kind: "cmp", op: "eq", path: "asset.kind", expected: "garage", actual: "dwelling", result: false },
        { kind: "not", result: false, child: { kind: "cmp", op: "exists", path: "attributes.ascensore", actual: true, result: true } },
      ],
    });
    expect(factsUsed(trace)).toEqual([
      { path: "asset.kind", value: "dwelling" },
      { path: "attributes.ascensore", value: true },
    ]);
  });

  it("lo schema accetta solo fatti ammessi e confronti coerenti, niente codice", () => {
    const bad = (c: unknown) => conditionSchema.safeParse(c).success;
    expect(bad(leaf("eq", "asset.kind", "dwelling"))).toBe(true);
    expect(bad({ all: [leaf("exists", "attributes.x")] })).toBe(true);
    expect(bad(leaf("eq", "process.env.SECRET", "x"))).toBe(false);
    expect(bad(leaf("eq", "attributes.UPPER", "x"))).toBe(false);
    expect(bad(leaf("in", "asset.kind", "dwelling"))).toBe(false);
    expect(bad(leaf("eq", "asset.kind", ["a"]))).toBe(false);
    expect(bad(leaf("gte", "attributes.anno", "1990"))).toBe(false);
    expect(bad(leaf("exists", "attributes.x", 1))).toBe(false);
    expect(bad({ all: [] })).toBe(false);
    expect(bad({ eval: "1+1" })).toBe(false);
    expect(bad({ all: [leaf("eq", "asset.kind", "x")], extra: 1 })).toBe(false);
  });

  it("per qualunque albero valido la valutazione termina e not inverte il risultato", () => {
    const paths = ["asset.kind", "asset.inCondominium", "attributes.anno_costruzione", "rights.regimes"];
    const leafArb = fc.oneof(
      fc.constantFrom(...paths).map((path) => leaf("exists", path)),
      fc.constantFrom("dwelling", "garage").map((v) => leaf("eq", "asset.kind", v)),
      fc.integer({ min: 1900, max: 2030 }).map((v) => leaf("lte", "attributes.anno_costruzione", v)),
    );
    const tree = fc.letrec<{ node: Condition }>((rec) => ({
      node: fc.oneof(
        { maxDepth: 4 },
        leafArb,
        fc.array(rec("node"), { minLength: 1, maxLength: 3 }).map((all) => ({ all })),
        fc.array(rec("node"), { minLength: 1, maxLength: 3 }).map((any) => ({ any })),
        rec("node").map((not) => ({ not })),
      ),
    })).node;
    fc.assert(
      fc.property(tree, (c) => {
        expect(conditionSchema.safeParse(c).success).toBe(true);
        const a = evaluateCondition(c, facts());
        const b = evaluateCondition({ not: c }, facts());
        expect(b.result).toBe(!a.result);
      }),
      { numRuns: 200 },
    );
  });
});

const version = (over: Partial<RuleVersion> & { versionNo: number }): RuleVersion => ({
  id: `v${over.versionNo}`,
  title: "Regola di prova",
  description: null,
  level: "national",
  territoryId: null,
  validFrom: null,
  validTo: null,
  appliesWhen: null,
  outcomes: [{ type: "checklist", key: "voce", title: "Documento atteso", dossierCategory: "cadastre" }],
  sourceText: "Esempio",
  sourceUrl: null,
  verificationStatus: "to_verify",
  changeNote: null,
  createdAt: new Date(0),
  ...over,
});
const rule = (key: string, versions: RuleVersion[], active = true): RuleWithVersions => ({ id: `id-${key}`, key, active, versions });

describe("scelta della versione e valutazione delle regole", () => {
  it("sceglie la versione piu' alta tra quelle in vigore alla data", () => {
    const r = rule("r", [
      version({ versionNo: 1, validTo: "2025-12-31" }),
      version({ versionNo: 2, validFrom: "2026-01-01", validTo: "2026-12-31" }),
      version({ versionNo: 3, validFrom: "2027-01-01" }),
    ]);
    expect(effectiveVersion(r, "2025-06-01")?.versionNo).toBe(1);
    expect(effectiveVersion(r, "2026-12-31")?.versionNo).toBe(2);
    expect(effectiveVersion(r, "2027-01-01")?.versionNo).toBe(3);
    expect(effectiveVersion(rule("x", [version({ versionNo: 1, validFrom: "2030-01-01" })]), "2026-01-01")).toBeNull();
    // Una modifica con la stessa validita' sostituisce la precedente.
    expect(effectiveVersion(rule("y", [version({ versionNo: 1 }), version({ versionNo: 2 })]), "2026-01-01")?.versionNo).toBe(2);
  });

  it("applica solo regole attive, in vigore, del territorio giusto e con condizione vera", () => {
    const chain = new Set(["comune-1", "provincia-1", "regione-1", "stato-1"]);
    const rules = [
      rule("nazionale", [version({ versionNo: 1 })]),
      rule("spenta", [version({ versionNo: 1 })], false),
      rule("regionale", [version({ versionNo: 1, level: "regional", territoryId: "regione-1" })]),
      rule("altra_regione", [version({ versionNo: 1, level: "regional", territoryId: "regione-2" })]),
      rule("scaduta", [version({ versionNo: 1, validTo: "2020-01-01" })]),
      rule("garage", [version({ versionNo: 1, appliesWhen: leaf("eq", "asset.kind", "garage") })]),
      rule("condominio", [version({ versionNo: 1, appliesWhen: leaf("eq", "asset.inCondominium", true), level: "condominium" })]),
    ];
    const result = evaluateRules(rules, facts(), chain, "2026-06-01");
    expect(result.items.map((i) => i.ruleKey).sort()).toEqual(["condominio", "nazionale", "regionale"]);
    expect(result.applied).toBe(3);
  });

  it("separa voci di checklist e avvisi e spiega ogni voce con regola, versione, livello e fatti", () => {
    const r = rule("mista", [
      version({
        versionNo: 4,
        level: "municipal",
        territoryId: "comune-1",
        appliesWhen: leaf("contains", "rights.regimes", "co_ownership"),
        verificationStatus: "to_verify",
        outcomes: [
          { type: "checklist", key: "a", title: "Voce A", dossierCategory: "title", expectedDocumentCategory: "title_deed" },
          { type: "notice", key: "b", title: "Avviso B", message: "Da verificare con un professionista" },
        ],
      }),
    ]);
    const { items, notices } = evaluateRules([r], facts(), new Set(["comune-1"]), "2026-06-01");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ ruleKey: "mista", outcomeKey: "a", versionId: "v4", dossierCategory: "title", expectedDocumentCategory: "title_deed" });
    expect(items[0]!.explanation).toMatchObject({ ruleTitle: "Regola di prova", versionNo: 4, level: "municipal", verificationStatus: "to_verify", facts: [{ path: "rights.regimes", value: ["co_ownership"] }] });
    expect(notices).toMatchObject([{ outcomeKey: "b", title: "Avviso B" }]);
  });
});

describe("dati di una versione", () => {
  const valid = {
    title: "Regola",
    level: "national",
    outcomes: [{ type: "checklist", key: "voce", title: "Voce", dossierCategory: "cadastre" }],
    sourceText: "Esempio illustrativo",
  };

  it("accetta una regola minima e imposta lo stato 'da verificare'", () => {
    const parsed = ruleVersionInputSchema.safeParse(valid);
    expect(parsed.success && parsed.data).toMatchObject({ appliesWhen: null, verificationStatus: "to_verify" });
  });

  it("segnala gli errori con messaggi chiari", () => {
    const errors = (v: unknown) => {
      const r = ruleVersionInputSchema.safeParse(v);
      return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.join("."), i.message]));
    };
    expect(errors({ ...valid, title: " ", sourceText: "" })).toMatchObject({ title: expect.stringContaining("obbligatorio"), sourceText: expect.stringContaining("obbligatorio") });
    expect(errors({ ...valid, outcomes: [] })).toMatchObject({ outcomes: "Serve almeno un esito" });
    expect(errors({ ...valid, validFrom: "2026-05-01", validTo: "2026-01-01" })).toHaveProperty("validTo");
    expect(errors({ ...valid, sourceUrl: "non-un-url" })).toHaveProperty("sourceUrl");
    expect(errors({ ...valid, outcomes: [valid.outcomes[0], valid.outcomes[0]] })).toHaveProperty(["outcomes.1.key"], "Codice ripetuto");
    expect(errors({ ...valid, appliesWhen: { all: [leaf("eq", "asset.kind", "x")], extra: 1 } })).toHaveProperty("appliesWhen");
    const deep = Array.from({ length: 8 }).reduce<Condition>((c) => ({ not: c }), leaf("exists", "attributes.x"));
    expect(errors({ ...valid, appliesWhen: deep })).toMatchObject({ appliesWhen: "La condizione è troppo annidata" });
  });

  it("la chiave stabile deriva dal titolo, senza accenti", () => {
    expect(ruleKeyFrom("Agibilità e destinazione d'uso", "ab12")).toBe("agibilita_e_destinazione_d_uso_ab12");
    expect(ruleKeyFrom("???", "ab12")).toBe("regola_ab12");
  });
});

describe("condizione e modulo a campi", () => {
  const yes = leaf("eq", "asset.kind", "dwelling");
  const exists = leaf("exists", "attributes.ascensore");

  it("senza condizione, con un confronto o con piu' confronti si va e si torna senza perdere nulla", () => {
    for (const c of [null, yes, { not: exists }, { all: [yes, { not: exists }] }, { any: [yes, exists, leaf("in", "asset.useType", ["let", "business"])] }] as (Condition | null)[]) {
      const flat = toFlat(c);
      expect(flat, JSON.stringify(c)).not.toBeNull();
      expect(fromFlat(flat!)).toEqual(c);
    }
  });

  it("una condizione annidata non e' rappresentabile dal modulo: si conserva, non si storpia", () => {
    expect(toFlat({ all: [yes, { any: [exists, yes] }] })).toBeNull();
    expect(toFlat({ not: { all: [yes, exists] } })).toBeNull();
    expect(toFlat({ not: { not: yes } })).toBeNull();
  });

  it("la forma piatta non cambia il risultato della valutazione", () => {
    const c: Condition = { any: [leaf("eq", "asset.kind", "garage"), { not: leaf("exists", "attributes.assente") }] };
    expect(evaluateCondition(fromFlat(toFlat(c)!), facts()).result).toBe(evaluateCondition(c, facts()).result);
  });
});
