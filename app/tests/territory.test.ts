import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditLog, territory } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import {
  IstatFormatError,
  createTerritory,
  importIstat,
  parseIstatCsv,
  searchTerritories,
  type IstatRow,
} from "@/modules/territory";
import { createTestDb, type TestDb } from "./helpers/test-db";

const system = { type: "system", id: "test" } as const;

/** Righe sintetiche nel formato ISTAT: nessun dato reale nel codice (il test di architettura lo vieta). */
function istatRow(n: number, over: Partial<IstatRow> = {}): IstatRow {
  return {
    regionCode: "90",
    regionName: "Regione di prova",
    provinceCode: "900",
    provinceName: "Provincia di prova",
    provinceSigla: "PP",
    municipalityCode: String(900000 + n),
    municipalityName: `Comune ${n}`,
    cadastralCode: `Z${(n % 900) + 100}`,
    ...over,
  };
}

function csvLine(r: IstatRow): string {
  const cols = Array<string>(27).fill("");
  cols[0] = r.regionCode;
  cols[1] = r.provinceCode;
  cols[4] = r.municipalityCode;
  cols[6] = r.municipalityName;
  cols[10] = r.regionName;
  cols[11] = r.provinceName;
  cols[14] = r.provinceSigla;
  cols[19] = r.cadastralCode;
  return cols.join(";");
}

describe("lettura del CSV ISTAT", () => {
  const header = "Codice Regione;\"Codice dell'Unità\n(valida a fini statistici)\";Codice Provincia";

  it("ignora le intestazioni anche su piu' righe e legge i Comuni", () => {
    const rows = Array.from({ length: 1200 }, (_, i) => istatRow(i));
    const parsed = parseIstatCsv([header, ...rows.map(csvLine)].join("\r\n"));
    expect(parsed).toHaveLength(1200);
    expect(parsed[5]).toMatchObject({ municipalityName: "Comune 5", provinceSigla: "PP", regionName: "Regione di prova" });
  });

  it("rifiuta un file troppo piccolo (pagina d'errore o tracciato cambiato)", () => {
    expect(() => parseIstatCsv("<!DOCTYPE html><html></html>")).toThrow(IstatFormatError);
  });

  it("rifiuta una riga con codice catastale malformato invece di importare dati sbagliati", () => {
    const rows = Array.from({ length: 1200 }, (_, i) => istatRow(i));
    rows[10] = istatRow(10, { cadastralCode: "???" });
    expect(() => parseIstatCsv(rows.map(csvLine).join("\n"))).toThrow(/non riconosciuta/);
  });
});

describe("territori", () => {
  let t: TestDb;
  const rows = [
    istatRow(1),
    istatRow(2, { municipalityName: "Altro Comune" }),
    istatRow(3, { municipalityName: "Città_con%speciali" }),
  ];

  beforeAll(async () => {
    t = await createTestDb();
    const result = await runInUnitOfWork(t.db, system, (uow) => importIstat(uow, rows));
    expect(result.ok).toBe(true);
  });
  afterAll(async () => {
    await t.close();
  });

  it("importa la gerarchia Stato > Regione > Provincia > Comune con i codici", async () => {
    const kinds = await t.db.select({ kind: territory.kind }).from(territory);
    const count = (k: string) => kinds.filter((r) => r.kind === k).length;
    expect([count("country"), count("region"), count("province"), count("municipality")]).toEqual([1, 1, 1, 3]);
    const [m] = await t.db.select().from(territory).where(eq(territory.code, "900001"));
    expect(m).toMatchObject({ kind: "municipality", cadastralCode: "Z101", source: "istat", verificationStatus: "to_verify" });
  });

  it("e' idempotente e non cancella lo stato di verifica deciso dall'utente", async () => {
    await t.db.update(territory).set({ verificationStatus: "verified_by_owner" }).where(eq(territory.code, "900001"));
    const before = (await t.db.select().from(territory)).length;
    const again = await runInUnitOfWork(t.db, system, (uow) =>
      importIstat(uow, [istatRow(1, { municipalityName: "Comune 1 rinominato" }), ...rows.slice(1)]),
    );
    expect(again.ok).toBe(true);
    expect((await t.db.select().from(territory)).length).toBe(before);
    const [m] = await t.db.select().from(territory).where(eq(territory.code, "900001"));
    expect(m).toMatchObject({ name: "Comune 1 rinominato", verificationStatus: "verified_by_owner" });
  });

  it("cerca per nome con etichetta completa e prima i nomi che iniziano con il testo", async () => {
    const found = await searchTerritories(t.db, { query: "comune" });
    expect(found.length).toBeGreaterThanOrEqual(2);
    expect(found[0]!.label).toBe(`${found[0]!.name} (PP) · Regione di prova`);
    expect(found.map((f) => f.name)).toContain("Altro Comune");
    expect((await searchTerritories(t.db, { query: "c" })).length).toBe(0); // minimo 2 caratteri
  });

  it("tratta % e _ digitati dall'utente come caratteri normali", async () => {
    expect((await searchTerritories(t.db, { query: "%%" })).length).toBe(0);
    expect((await searchTerritories(t.db, { query: "con%spe" })).map((f) => f.name)).toEqual(["Città_con%speciali"]);
  });

  it("aggiunge una localita' dentro un Comune e ne mostra il percorso", async () => {
    const [municipality] = await t.db.select().from(territory).where(eq(territory.code, "900002"));
    const created = await runInUnitOfWork(t.db, system, (uow) =>
      createTerritory(uow, { kind: "locality", parentId: municipality!.id, name: "Frazione Alta" }),
    );
    expect(created.ok).toBe(true);
    const found = await searchTerritories(t.db, { query: "frazione", kinds: ["locality"] });
    expect(found[0]!.label).toBe("Frazione Alta, Altro Comune (PP) · Regione di prova");
  });

  it("rispetta la gerarchia: una localita' non puo' stare dentro una provincia", async () => {
    const [province] = await t.db.select().from(territory).where(eq(territory.kind, "province"));
    const result = await runInUnitOfWork(t.db, system, (uow) =>
      createTerritory(uow, { kind: "locality", parentId: province!.id, name: "Fuori posto" }),
    );
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).toMatch(/deve stare dentro/);
  });

  it("valida i campi e registra l'audit delle scritture", async () => {
    const bad = await runInUnitOfWork(t.db, system, (uow) => createTerritory(uow, { kind: "municipality", name: "" }));
    expect(bad).toMatchObject({ ok: false });
    const actions = (await t.db.select({ a: auditLog.action }).from(auditLog)).map((r) => r.a);
    expect(actions).toContain("territory.import_istat");
    expect(actions).toContain("territory.create");
  });
});
