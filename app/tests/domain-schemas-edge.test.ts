import { describe, expect, it } from "vitest";
import { conditionSchema, conditionShapeIssues, evaluateCondition, factValue, factsUsed, type Condition, type Facts } from "@/modules/rules/domain/condition";
import { partyInputSchema } from "@/modules/directory/domain/party";
import { createTerritorySchema, territoryLabel } from "@/modules/territory/domain/territory";

const facts: Facts = { asset: { kind: "dwelling", useType: null, inCondominium: true }, rights: { regimes: ["ownership"] }, attributes: { vani: 5, riscaldamento: true } };

describe("regole: condizioni (casi limite)", () => {
  it("il valore del confronto: «esiste» non ne vuole, gli altri si; elenco solo con «tra»; numero solo con >= e <=", () => {
    const parse = (c: unknown) => conditionSchema.safeParse(c).success;
    expect(parse({ op: "exists", path: "asset.useType" })).toBe(true);
    expect(parse({ op: "exists", path: "asset.useType", value: "x" })).toBe(false);
    expect(parse({ op: "eq", path: "asset.kind" })).toBe(false);
    expect(parse({ op: "in", path: "asset.kind", value: "dwelling" })).toBe(false);
    expect(parse({ op: "in", path: "asset.kind", value: ["dwelling"] })).toBe(true);
    expect(parse({ op: "eq", path: "asset.kind", value: ["dwelling"] })).toBe(false);
    expect(parse({ op: "gte", path: "attributes.vani", value: "5" })).toBe(false);
    expect(parse({ op: "gte", path: "attributes.vani", value: 5 })).toBe(true);
    expect(parse({ op: "in", path: "asset.kind", value: [] })).toBe(false);
  });

  it("percorsi ostili o non ammessi sono rifiutati; i nodi accettano solo le loro chiavi", () => {
    const parse = (c: unknown) => conditionSchema.safeParse(c).success;
    for (const path of ["__proto__", "asset.constructor", "attributes.", "attributes.A", "attributes.1x", "attributes.a b", "rights", "../etc", `attributes.${"a".repeat(41)}`]) {
      expect(parse({ op: "exists", path }), path).toBe(false);
    }
    expect(parse({ all: [] })).toBe(false);
    expect(parse({ any: [] })).toBe(false);
    expect(parse({ all: [{ op: "exists", path: "asset.kind" }], extra: 1 })).toBe(false);
    expect(parse({ not: { any: [{ op: "exists", path: "asset.kind" }] } })).toBe(true);
    expect(parse({ op: "eq", path: "asset.kind", value: "x".repeat(201) })).toBe(false);
  });

  it("forma: troppo annidata, troppi nodi, e il caso al limite passa", () => {
    const leaf: Condition = { op: "exists", path: "asset.kind" };
    let deep: Condition = leaf;
    for (let i = 0; i < 5; i++) deep = { not: deep };
    expect(conditionShapeIssues(deep)).toBeNull(); // profondita' 6
    expect(conditionShapeIssues({ not: deep })).toMatch(/annidata/);
    expect(conditionShapeIssues({ all: Array.from({ length: 59 }, () => leaf) })).toBeNull(); // 60 nodi
    expect(conditionShapeIssues({ all: Array.from({ length: 60 }, () => leaf) })).toMatch(/troppi/);
    expect(conditionShapeIssues({ any: [leaf, { any: Array.from({ length: 60 }, () => leaf) }] })).toMatch(/troppi/);
    expect(conditionShapeIssues({ any: [leaf, { not: { not: { not: { not: { not: { not: leaf } } } } } }] })).toMatch(/annidata/);
  });

  it("fatti: attributo mancante, tipi dell'attivita' assenti, percorso sconosciuto e prototipo non trapelano", () => {
    expect(factValue(facts, "attributes.manca")).toBeUndefined();
    expect(factValue(facts, "letting.types")).toEqual([]);
    expect(factValue({ ...facts, letting: { types: ["short_term"] } }, "letting.types")).toEqual(["short_term"]);
    expect(factValue(facts, "asset.useType")).toBeUndefined();
    expect(factValue(facts, "qualcosa.altro")).toBeUndefined();
    expect(evaluateCondition({ op: "exists", path: "asset.useType" }, facts).result).toBe(false);
  });

  it("valutazione: confronti con tipi sbagliati o fatti assenti sono falsi, mai errori", () => {
    const ev = (c: Condition) => evaluateCondition(c, facts).result;
    expect(ev({ op: "gte", path: "asset.kind", value: 1 })).toBe(false);
    expect(ev({ op: "lte", path: "attributes.vani", value: 5 })).toBe(true);
    expect(ev({ op: "lte", path: "attributes.manca", value: 5 })).toBe(false);
    expect(ev({ op: "eq", path: "rights.regimes", value: "ownership" })).toBe(false);
    expect(ev({ op: "in", path: "rights.regimes", value: ["ownership"] })).toBe(false);
    expect(ev({ op: "contains", path: "rights.regimes", value: "ownership" })).toBe(true);
    expect(ev({ op: "contains", path: "asset.kind", value: "dwelling" })).toBe(false);
    expect(ev({ op: "contains", path: "rights.regimes" })).toBe(false);
    expect(ev({ op: "exists", path: "rights.regimes" })).toBe(true);
    expect(evaluateCondition(null, facts)).toEqual({ result: true, trace: null });
  });

  it("i fatti consultati compaiono una volta sola, con null per quelli assenti", () => {
    const { trace } = evaluateCondition({ all: [{ op: "exists", path: "asset.useType" }, { not: { op: "eq", path: "asset.kind", value: "garage" } }, { any: [{ op: "eq", path: "asset.kind", value: "dwelling" }, { op: "gte", path: "attributes.vani", value: 3 }] }] }, facts);
    const used = factsUsed(trace);
    expect(used.map((u) => u.path).sort()).toEqual(["asset.kind", "asset.useType", "attributes.vani"]);
    expect(used.find((u) => u.path === "asset.useType")?.value).toBeNull();
    expect(factsUsed(null)).toEqual([]);
  });
});

describe("rubrica: campi normalizzati (casi limite)", () => {
  const parse = (o: Record<string, unknown>) => partyInputSchema.safeParse({ displayName: "Mario", ...o });

  it("codice fiscale: spazi tolti, maiuscolo, vuoto = assente; lunghezza e caratteri verificati", () => {
    const ok = parse({ taxCode: " rss mra 80a01 h501z " });
    expect(ok.success && ok.data.taxCode).toBe("RSSMRA80A01H501Z");
    expect(parse({ taxCode: "   " }).success && (parse({ taxCode: "   " }) as { data: { taxCode?: string } }).data.taxCode).toBeFalsy();
    expect(parse({ taxCode: "ABC" }).success).toBe(false);
    expect(parse({ taxCode: "A".repeat(17) }).success).toBe(false);
    expect(parse({ taxCode: "A".repeat(11) }).success).toBe(true);
    expect(parse({ taxCode: "RSSMRA80A01H501-" }).success).toBe(false);
  });

  it("email e PEC: minuscole e senza spazi ai bordi; vuote = assenti; non valide rifiutate; troppo lunghe rifiutate", () => {
    const ok = parse({ email: "  Mario@Example.TEST ", pec: " P@Pec.Example.test" });
    expect(ok.success && [ok.data.email, ok.data.pec]).toEqual(["mario@example.test", "p@pec.example.test"]);
    expect(parse({ email: "", pec: "  " }).success).toBe(true);
    expect(parse({ email: "non-una-email" }).success).toBe(false);
    expect(parse({ pec: "x@" }).success).toBe(false);
    expect(parse({ email: `${"a".repeat(250)}@e.it` }).success).toBe(false);
  });

  it("nome obbligatorio, ruoli solo quelli noti", () => {
    expect(partyInputSchema.safeParse({ displayName: "  " }).success).toBe(false);
    expect(parse({ roles: ["hacker"] }).success).toBe(false);
    expect(parse({}).success && (parse({}) as { data: { roles: string[] } }).data.roles).toEqual([]);
  });
});

describe("territorio: schema e etichette (casi limite)", () => {
  const id = "123e4567-e89b-42d3-a456-426614174000";

  it("codice catastale: maiuscolo, una lettera e tre cifre; vuoto ammesso; tipi non manuali rifiutati", () => {
    const ok = createTerritorySchema.safeParse({ kind: "municipality", parentId: id, name: "Comune", cadastralCode: " a123 " });
    expect(ok.success && ok.data.cadastralCode).toBe("A123");
    expect(createTerritorySchema.safeParse({ kind: "municipality", parentId: id, name: "Comune", cadastralCode: "" }).success).toBe(true);
    expect(createTerritorySchema.safeParse({ kind: "municipality", parentId: id, name: "Comune", cadastralCode: "AB12" }).success).toBe(false);
    expect(createTerritorySchema.safeParse({ kind: "region", parentId: id, name: "Regione" }).success).toBe(false);
    expect(createTerritorySchema.safeParse({ kind: "locality", parentId: "x", name: "Frazione" }).success).toBe(false);
  });

  it("etichetta: catena vuota, localita' senza comune, comune senza provincia o regione, regione e stato", () => {
    const t = (kind: "country" | "region" | "province" | "municipality" | "locality", name: string, provinceSigla: string | null = null) => ({ kind, name, provinceSigla });
    expect(territoryLabel([])).toBe("");
    expect(territoryLabel([t("locality", "Frazione")])).toBe("Frazione, ");
    expect(territoryLabel([t("locality", "Frazione"), t("municipality", "Comune"), t("province", "Prov", "PP"), t("region", "Reg")])).toBe("Frazione, Comune (PP) · Reg");
    expect(territoryLabel([t("municipality", "Comune")])).toBe("Comune");
    expect(territoryLabel([t("province", "Prov", "PP"), t("region", "Reg")])).toBe("Prov (PP) · Reg");
    expect(territoryLabel([t("region", "Reg"), t("country", "Italia")])).toBe("Reg");
    expect(territoryLabel([t("country", "Italia")])).toBe("Italia");
  });
});
