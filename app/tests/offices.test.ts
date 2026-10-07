import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { territory } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { createAsset } from "@/modules/assets";
import { createDeadline } from "@/modules/deadlines";
import { createParty } from "@/modules/directory";
import { addOpinion, addRequest, assignParty, createMatter, updateMatter } from "@/modules/matters";
import { createRule, setVersionVerification, getRule } from "@/modules/rules";
import { importIstat } from "@/modules/territory";
import { classifyReview, getOfficeDetail, listOfficesOverview, monthsBefore, reviewRules } from "@/modules/offices";
import { buildOfficeView } from "@/modules/offices/domain/office";
import { createTestDb, type TestDb } from "./helpers/test-db";
import { conclusiveClaims } from "./helpers/neutral";

const actor = { type: "owner", id: "o1" } as const;
const owner = { displayName: "Proprietario Prova", email: "prova@example.test" };
const TODAY = "2026-06-15";

describe("uffici: funzioni pure", () => {
  it("sottrae mesi di calendario, riducendo il giorno a fine mese", () => {
    expect(monthsBefore("2026-06-15", 12)).toBe("2025-06-15");
    expect(monthsBefore("2026-03-31", 1)).toBe("2026-02-28");
    expect(monthsBefore("2026-01-10", 3)).toBe("2025-10-10");
  });

  it("classifica il controllo delle regole senza dire se si applicano", () => {
    const base = { today: TODAY, maxAgeMonths: 12 };
    expect(classifyReview({ ...base, status: "draft", lastCheckedOn: "2026-06-01" })).toBe("unverified");
    expect(classifyReview({ ...base, status: "to_verify", lastCheckedOn: null })).toBe("unverified");
    expect(classifyReview({ ...base, status: "verified_by_owner", lastCheckedOn: null })).toBe("no_check_date");
    expect(classifyReview({ ...base, status: "verified_by_owner", lastCheckedOn: "2025-06-14" })).toBe("stale");
    expect(classifyReview({ ...base, status: "validated_by_professional", lastCheckedOn: "2025-06-15" })).toBe("recent");
  });

  it("raggruppa per ufficio cio' che e' aperto", () => {
    const view = buildOfficeView(
      "ufficio",
      [
        {
          id: "m1", title: "Aperta", status: "open", openedOn: "2026-05-01", closedOn: null, assetName: null,
          assignments: [{ partyId: "ufficio", role: "edilizia" }],
          requests: [
            { id: "r1", title: "Visura", requestedFromPartyId: "ufficio", status: "requested", requestedOn: "2026-05-02", dueOn: "2026-06-01", documentTitle: null },
            { id: "r2", title: "Altra", requestedFromPartyId: "altro", status: "requested", requestedOn: "2026-05-02", dueOn: null, documentTitle: null },
          ],
          opinions: [],
        },
        { id: "m2", title: "Chiusa", status: "closed", openedOn: "2025-01-01", closedOn: "2025-02-01", assetName: null, assignments: [{ partyId: "ufficio", role: null }], requests: [], opinions: [] },
        { id: "m3", title: "Estranea", status: "open", openedOn: "2026-05-01", closedOn: null, assetName: null, assignments: [{ partyId: "altro", role: null }], requests: [], opinions: [] },
      ],
      [
        { deadlineId: "d1", occurrenceId: "o1", title: "Termine", dueOn: "2026-07-01", assetName: null, responsiblePartyId: null, professionalPartyId: "ufficio" },
        { deadlineId: "d2", occurrenceId: "o2", title: "Altro", dueOn: "2026-07-01", assetName: null, responsiblePartyId: "altro", professionalPartyId: null },
      ],
      TODAY,
    );
    expect(view.matters.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(view.matters[0]!.requests.map((r) => r.id)).toEqual(["r1"]);
    expect(view.counts).toEqual({ openMatters: 1, openRequests: 1, openDeadlines: 1, overdue: 1, nextDueOn: "2026-06-01", answers: 0 });
  });
});

describe("uffici: dati", () => {
  let t: TestDb;
  let assetId: string;
  let municipalityId: string;
  let regionId: string;
  const run = <T>(work: Parameters<typeof runInUnitOfWork<T>>[2]) => runInUnitOfWork(t.db, actor, work);
  const okValue = <V>(r: { ok: boolean; value?: V }): V => {
    if (!r.ok) throw new Error(`atteso successo: ${JSON.stringify(r)}`);
    return r.value as V;
  };

  beforeAll(async () => {
    t = await createTestDb();
    await run((uow) =>
      importIstat(uow, [{ regionCode: "90", regionName: "Regione di prova", provinceCode: "900", provinceName: "Provincia di prova", provinceSigla: "PP", municipalityCode: "900001", municipalityName: "Comune Uno", cadastralCode: "Z101" }]),
    );
    municipalityId = (await t.db.select().from(territory).where(eq(territory.kind, "municipality")))[0]!.id;
    regionId = (await t.db.select().from(territory).where(eq(territory.kind, "region")))[0]!.id;
    assetId = okValue(await run((uow) => createAsset(uow, owner, { kind: "dwelling", name: "Casa di prova", territoryId: municipalityId }))).id;
  }, 60_000);
  afterAll(async () => {
    await t.close();
  });

  it("mostra cosa e' aperto presso ciascun ufficio, e le pratiche senza ufficio", async () => {
    const office = okValue(await run((uow) => createParty(uow, { displayName: "Ufficio Uno", roles: ["public_office"] }))).id;
    const other = okValue(await run((uow) => createParty(uow, { displayName: "Ufficio Due", roles: ["public_office"] }))).id;
    const lawyer = okValue(await run((uow) => createParty(uow, { displayName: "Avvocato", roles: ["lawyer"] }))).id;
    const open = okValue(await run((uow) => createMatter(uow, { title: "Pratica aperta", assetId, openedOn: "2026-05-01" }, TODAY))).id;
    const closed = okValue(await run((uow) => createMatter(uow, { title: "Pratica chiusa", openedOn: "2025-01-01" }, TODAY))).id;
    await run((uow) => createMatter(uow, { title: "Senza ufficio" }, TODAY));
    await run((uow) => assignParty(uow, open, { partyId: office, role: "edilizia" }));
    await run((uow) => assignParty(uow, closed, { partyId: office }));
    await run((uow) => updateMatter(uow, closed, { title: "Pratica chiusa", status: "closed", openedOn: "2025-01-01" }, TODAY));
    await run((uow) => addRequest(uow, open, { title: "Integrazione", requestedFromPartyId: office, dueOn: "2026-06-01" }, TODAY));
    await run((uow) => addOpinion(uow, open, { partyId: office, nature: "informational", summary: "Risposta ricevuta" }));
    await run((uow) => assignParty(uow, open, { partyId: lawyer }));
    okValue(await run((uow) => createDeadline(uow, { title: "Termine ufficio", category: "fiscal", level: "national", calc: { type: "manual" }, firstDueOn: "2026-07-01", professionalPartyId: office }, TODAY)));

    const overview = await listOfficesOverview(t.db, TODAY);
    const one = overview.offices.find((o) => o.party.id === office)!;
    expect(one.counts).toMatchObject({ openMatters: 1, openRequests: 1, openDeadlines: 1, overdue: 1, answers: 1, nextDueOn: "2026-06-01" });
    expect(overview.offices.find((o) => o.party.id === other)!.counts).toMatchObject({ openMatters: 0, openRequests: 0, openDeadlines: 0 });
    expect(overview.offices.map((o) => o.party.id)).not.toContain(lawyer);
    expect(overview.mattersWithoutOffice).toBe(1);

    const detail = (await getOfficeDetail(t.db, office, TODAY))!;
    expect(detail.view.matters.map((m) => m.title)).toEqual(["Pratica aperta", "Pratica chiusa"]);
    expect(detail.view.deadlines).toHaveLength(1);
    expect(await getOfficeDetail(t.db, lawyer, TODAY)).toBeNull();
    expect(await getOfficeDetail(t.db, "00000000-0000-4000-8000-000000000000", TODAY)).toBeNull();
  });

  it("elenca le regole del territorio con stato di verifica e data dell'ultimo controllo", async () => {
    const mk = async (title: string, over: Record<string, unknown>) =>
      okValue(await run((uow) => createRule(uow, { title, sourceText: "Fonte inserita", outcomes: [{ type: "notice", key: "avviso", title: "Avviso", message: "Testo" }], ...over })));
    const comune = await mk("Regola comunale", { level: "municipal", territoryId: municipalityId });
    await mk("Regola regionale", { level: "regional", territoryId: regionId });
    const ovunque = await mk("Regola nazionale", { level: "national" });
    await mk("Regola non verificata", { level: "national" });
    const versionOf = async (id: string) => (await getRule(t.db, id))!.versions[0]!.id;
    const comuneVersion = await versionOf(comune.id);
    const nationalVersion = await versionOf(ovunque.id);
    await run((uow) => setVersionVerification(uow, comuneVersion, "verified_by_owner"));
    await run((uow) => setVersionVerification(uow, nationalVersion, "validated_by_professional"));

    const today = new Date().toISOString().slice(0, 10);
    const review = (await reviewRules(t.db, { assetId, maxAgeMonths: 12, today }))!;
    expect(review.asset?.name).toBe("Casa di prova");
    expect(review.territoryLabels.some((l) => l.includes("Comune Uno"))).toBe(true);
    expect(review.rows.map((r) => r.title).sort()).toEqual(["Regola comunale", "Regola nazionale", "Regola non verificata", "Regola regionale"]);
    expect(review.rows[0]!.state).toBe("unverified");
    expect(review.rows.find((r) => r.title === "Regola comunale")).toMatchObject({ state: "recent", scope: "territory", territoryLabel: expect.stringContaining("Comune Uno") });
    expect(review.rows.find((r) => r.title === "Regola nazionale")).toMatchObject({ state: "recent", scope: "everywhere", territoryLabel: null });
    expect(review.counts).toMatchObject({ unverified: 2, recent: 2 });

    // Molto piu' avanti nel tempo gli stessi controlli risultano vecchi.
    const later = (await reviewRules(t.db, { maxAgeMonths: 6, today: "2099-01-01" }))!;
    expect(later.counts.stale).toBe(2);
    expect(await reviewRules(t.db, { assetId: "00000000-0000-4000-8000-000000000000" })).toBeNull();
  });

  it("i testi mostrati restano neutri", async () => {
    const messages = (await import("../messages/it.json")).default.offices;
    const texts = JSON.stringify(messages).match(/"([^"]{20,})"/g) ?? [];
    for (const text of texts) expect(conclusiveClaims(text)).toEqual([]);
  });
});
