import { describe, expect, it } from "vitest";
import { computeFindings, countBySeverity, type Sources } from "@/modules/attention/domain/findings";

const TODAY = "2026-06-15";

const quiet = (over: Partial<Sources> = {}): Sources => ({
  today: TODAY,
  overdueDeadlines: 0,
  soonDeadlines: 0,
  documents: [],
  obligations: [],
  returns: [],
  condominiums: [],
  works: [],
  warranties: [],
  policies: [],
  lettings: [],
  dossiers: [],
  backup: { configured: true, lastSuccessOn: "2026-06-14", lastFailed: false },
  ...over,
});
const kinds = (s: Sources) => computeFindings(s).map((f) => f.kind);

describe("«da controllare»", () => {
  it("con i dati in ordine non segnala nulla", () => {
    expect(computeFindings(quiet())).toEqual([]);
  });

  it("segnala scadenze in ritardo (alta) e imminenti (normale), con i conteggi", () => {
    const f = computeFindings(quiet({ overdueDeadlines: 3, soonDeadlines: 2 }));
    expect(f.map((x) => [x.kind, x.severity, x.params])).toEqual([
      ["deadlines_overdue", "high", { count: 3 }],
      ["deadlines_soon", "normal", { count: 2, days: 14 }],
    ]);
    expect(f[0]!.href).toBe("/scadenze?vista=ritardo");
  });

  it("i documenti con la validita' passata o entro 60 giorni; quelli senza data o lontani no", () => {
    const f = computeFindings(
      quiet({
        documents: [
          { id: "a", title: "Passato", validTo: "2026-05-01" },
          { id: "b", title: "Vicino", validTo: "2026-08-01" },
          { id: "c", title: "Lontano", validTo: "2027-01-01" },
          { id: "d", title: "Senza data", validTo: null },
          { id: "e", title: "Oggi", validTo: TODAY },
        ],
      }),
    );
    expect(f.map((x) => [x.kind, x.params.title])).toEqual([["document_expired", "Passato"], ["document_expiring", "Oggi"], ["document_expiring", "Vicino"]]);
    expect(f[0]!.href).toBe("/documenti/a");
  });

  it("tributi: voce con data superata (alta), pagamenti senza prova, dichiarazione in ritardo (alta)", () => {
    const f = computeFindings(
      quiet({
        obligations: [
          { id: "o1", title: "Imposta 2026", assetName: "Casa", overdue: true, dueOn: "2026-06-01", paymentsWithoutProof: 2 },
          { id: "o2", title: "Altra 2026", assetName: "Box", overdue: false, dueOn: null, paymentsWithoutProof: 0 },
        ],
        returns: [{ id: "r1", title: "Comunicazione 2026", overdue: true, dueOn: "2026-05-31" }],
      }),
    );
    expect(f.map((x) => [x.kind, x.severity])).toEqual([["return_overdue", "high"], ["tax_overdue", "high"], ["tax_proof_missing", "normal"]]);
  });

  it("condominio: rate non pagate con la scadenza passata e contratti scaduti o in scadenza", () => {
    const f = computeFindings(
      quiet({
        condominiums: [
          {
            id: "c1",
            name: "Condominio Prova",
            unpaidOverdue: { count: 2, cents: 45_000, oldestDueOn: "2026-03-01" },
            contracts: [{ title: "Pulizie", validTo: "2026-06-01" }, { title: "Ascensore", validTo: "2026-07-15" }, { title: "Lontano", validTo: "2030-01-01" }, { title: "Senza fine", validTo: null }],
          },
        ],
      }),
    );
    expect(f.map((x) => x.kind)).toEqual(["condo_rates_overdue", "condo_contract_expired", "condo_contract_expiring"]);
    expect(f[0]!.params).toMatchObject({ count: 2, cents: 45_000 });
    expect(f[0]!.href).toBe("/condominio/c1?sezione=esercizi");
  });

  it("manutenzioni: fatture da pagare, preventivi scaduti, garanzie in scadenza (quelle scadute no)", () => {
    const f = computeFindings(
      quiet({
        works: [{ id: "w1", title: "Caldaia", unpaidCents: 100_000, expiredQuotes: 1 }, { id: "w2", title: "Tinteggiatura", unpaidCents: 0, expiredQuotes: 0 }],
        warranties: [{ id: "g1", title: "Garanzia A", state: "expiring", endsOn: "2026-07-01" }, { id: "g2", title: "Garanzia B", state: "expired", endsOn: "2026-01-01" }, { id: "g3", title: "Garanzia C", state: "active", endsOn: "2028-01-01" }],
      }),
    );
    expect(f.map((x) => x.kind).sort()).toEqual(["warranty_expiring", "work_invoice_unpaid", "work_quote_expired"]);
  });

  it("assicurazioni: premio con scadenza superata (alta), polizza in scadenza o scaduta ma non archiviata", () => {
    const f = computeFindings(
      quiet({
        policies: [
          { id: "p1", title: "Casa", state: "expiring", endsOn: "2026-07-10", nextPremium: { dueOn: "2026-06-01", amountCents: 24_000, overdue: true } },
          { id: "p2", title: "Vecchia", state: "expired", endsOn: "2026-01-31", nextPremium: null },
          { id: "p3", title: "Senza fine", state: "undated", endsOn: null, nextPremium: null },
        ],
      }),
    );
    expect(f.map((x) => [x.kind, x.severity])).toEqual([["premium_overdue", "high"], ["policy_expired", "normal"], ["policy_expiring", "normal"]]);
  });

  it("locazioni: canoni e adempimenti in ritardo (alta), contratto con fine passata ma ancora in corso, codici scaduti o in scadenza", () => {
    const f = computeFindings(
      quiet({
        lettings: [
          {
            id: "l1",
            title: "Locazione",
            status: "active",
            endsOn: "2026-05-31",
            overdueRents: 2,
            reports: [{ title: "Comunicazione", dueOn: "2026-06-01", overdue: true }, { title: "Futuro", dueOn: "2026-09-01", overdue: false }],
            codes: [{ label: "Codice A", validUntil: "2026-01-01", state: "expired" }, { label: "Codice B", validUntil: "2026-07-01", state: "expiring" }, { label: "Codice C", validUntil: null, state: "undated" }],
          },
          { id: "l2", title: "Conclusa", status: "ended", endsOn: "2026-01-01", overdueRents: 0, reports: [], codes: [] },
        ],
      }),
    );
    expect(f.map((x) => x.kind).sort()).toEqual(["code_expired", "code_expiring", "letting_end_passed", "rent_overdue", "report_overdue"]);
    expect(f.filter((x) => x.severity === "high").map((x) => x.kind).sort()).toEqual(["rent_overdue", "report_overdue"]);
  });

  it("dossier: voci senza documento e voci da rivedere, per bene", () => {
    const f = computeFindings(quiet({ dossiers: [{ assetId: "a1", assetName: "Casa", missing: 4, stale: 1 }, { assetId: "a2", assetName: "Box", missing: 0, stale: 0 }] }));
    expect(f.map((x) => [x.kind, x.params.count])).toEqual([["dossier_missing", 4], ["dossier_stale", 1]]);
    expect(f[0]!.href).toBe("/immobili/a1/dossier");
  });

  it("backup: non configurato, mai fatto, troppo vecchio, ultimo fallito", () => {
    expect(kinds(quiet({ backup: { configured: false, lastSuccessOn: null, lastFailed: false } }))).toEqual(["backup_not_configured"]);
    expect(kinds(quiet({ backup: { configured: true, lastSuccessOn: null, lastFailed: false } }))).toEqual(["backup_never"]);
    expect(kinds(quiet({ backup: { configured: true, lastSuccessOn: "2026-06-08", lastFailed: false } }))).toEqual([]);
    expect(kinds(quiet({ backup: { configured: true, lastSuccessOn: "2026-06-07", lastFailed: false } }))).toEqual(["backup_old"]);
    expect(kinds(quiet({ backup: { configured: true, lastSuccessOn: "2026-06-14", lastFailed: true } }))).toEqual(["backup_failed"]);
  });

  it("l'ordine e' stabile: prima le priorita' alte, poi le date piu' vecchie, senza data in fondo", () => {
    const f = computeFindings(
      quiet({
        overdueDeadlines: 1,
        documents: [{ id: "a", title: "Doc", validTo: "2026-05-01" }],
        policies: [{ id: "p", title: "P", state: "expiring", endsOn: "2026-07-01", nextPremium: { dueOn: "2026-06-10", amountCents: 100, overdue: true } }],
        dossiers: [{ assetId: "x", assetName: "X", missing: 1, stale: 0 }],
      }),
    );
    expect(f.map((x) => x.kind)).toEqual(["premium_overdue", "deadlines_overdue", "document_expired", "policy_expiring", "dossier_missing"]);
    expect(countBySeverity(f)).toEqual({ high: 2, normal: 3 });
    expect(new Set(f.map((x) => x.id)).size).toBe(f.length);
  });

  it("nessun testo del risultato afferma un'irregolarita': solo fatti (date, importi, conteggi)", () => {
    const f = computeFindings(quiet({ overdueDeadlines: 1 }));
    expect(JSON.stringify(f)).not.toMatch(/irregolar|violazion|illegal|sanzion/i);
  });
});
