import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditLog, deadline, matter } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { createDeadline, listDeadlines, updateOwnerFields } from "@/modules/deadlines";
import { createParty } from "@/modules/directory";
import { addEvent, createMatter, getMatterDetail, removeEvent, updateMatter } from "@/modules/matters";
import { getOfficeDetail, listOfficesOverview } from "@/modules/offices";
import messages from "../messages/it.json";
import { loadMatterDossier, type DossierT } from "@/lib/matter-dossier";
import { createTestDb, type TestDb } from "./helpers/test-db";

const actor = { type: "owner", id: "o1" } as const;
const TODAY = "2026-06-15";

const t: DossierT = (key, values = {}) => {
  const text = key.split(".").reduce<unknown>((n, p) => (n as Record<string, unknown> | undefined)?.[p], messages.avvocato);
  if (typeof text !== "string") throw new Error(`messaggio mancante: ${key}`);
  return text.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ""));
};

describe("pratica: ufficio, protocollo, fatti e scadenze collegate", () => {
  let db: TestDb;
  const run = <T>(work: Parameters<typeof runInUnitOfWork<T>>[2]) => runInUnitOfWork(db.db, actor, work);
  const okValue = <V>(r: { ok: boolean; value?: V }): V => {
    if (!r.ok) throw new Error(`atteso successo: ${JSON.stringify(r)}`);
    return r.value as V;
  };

  beforeAll(async () => {
    db = await createTestDb();
  }, 60_000);
  afterAll(async () => {
    await db.close();
  });

  it("registra ufficio, protocollo, presentazione e termine comunicato, e li mostra in fascicolo e in /uffici", async () => {
    const office = okValue(await run((uow) => createParty(uow, { displayName: "Ufficio Prova", roles: ["public_office"] }))).id;
    const matterId = okValue(
      await run((uow) =>
        createMatter(uow, { title: "Istanza di prova", officePartyId: office, protocolNumber: "PROT-123/2026", submittedOn: "2026-06-01", responseDueOn: "2026-06-10" }, TODAY),
      ),
    ).id;
    const detail = (await getMatterDetail(db.db, matterId))!;
    expect(detail).toMatchObject({ officePartyId: office, officeName: "Ufficio Prova", protocolNumber: "PROT-123/2026", submittedOn: "2026-06-01", responseDueOn: "2026-06-10" });

    const dossier = (await loadMatterDossier(db.db, matterId, t, TODAY))!;
    const kinds = dossier.timeline.dated.map((e) => `${e.date}:${e.kind}`);
    expect(kinds).toContain("2026-06-01:submission");
    expect(kinds).toContain("2026-06-10:submission");
    expect(dossier.timeline.dated.find((e) => e.date === "2026-06-01" && e.kind === "submission")?.detail).toContain("PROT-123/2026");

    const view = (await getOfficeDetail(db.db, office, TODAY))!.view;
    expect(view.matters).toMatchObject([{ id: matterId, isRecipient: true, protocolNumber: "PROT-123/2026", responseDueOn: "2026-06-10" }]);
    // Il termine di risposta comunicato e' passato e la pratica e' aperta: conta tra le date superate.
    expect(view.counts).toMatchObject({ openMatters: 1, overdue: 1, nextDueOn: "2026-06-10" });
    const overview = await listOfficesOverview(db.db, TODAY);
    expect(overview.offices.find((o) => o.party.id === office)!.counts.openMatters).toBe(1);
    expect(overview.mattersWithoutOffice).toBe(0);
  });

  it("rifiuta un ufficio inesistente e aggiorna i dati senza perdere il resto; l'audit non riporta i valori", async () => {
    const bad = await run((uow) => createMatter(uow, { title: "X", officePartyId: "00000000-0000-4000-8000-000000000000" }, TODAY));
    expect(bad.ok).toBe(false);
    const matterId = okValue(await run((uow) => createMatter(uow, { title: "Da aggiornare" }, TODAY))).id;
    okValue(await run((uow) => updateMatter(uow, matterId, { title: "Da aggiornare", protocolNumber: "SEGRETO-9", submittedOn: "2026-06-02" }, TODAY)));
    const rows = await db.db.select().from(auditLog).where(eq(auditLog.entityId, matterId));
    const update = rows.find((r) => r.action === "matter.update")!;
    expect(JSON.stringify(update.diff)).toContain("protocolNumber");
    expect(JSON.stringify(rows.map((r) => r.diff))).not.toContain("SEGRETO-9");
  });

  it("registra fatti con tipo, data, parte e documento facoltativi, e li toglie", async () => {
    const matterId = okValue(await run((uow) => createMatter(uow, { title: "Con fatti" }, TODAY))).id;
    const party = okValue(await run((uow) => createParty(uow, { displayName: "Controparte" }))).id;
    okValue(await run((uow) => addEvent(uow, matterId, { kind: "hearing", occurredOn: "2026-07-01", title: "Prima udienza", note: "Aula 3", partyId: party })));
    expect((await run((uow) => addEvent(uow, matterId, { kind: "invalid", occurredOn: "2026-07-01", title: "x" }))).ok).toBe(false);
    expect((await run((uow) => addEvent(uow, matterId, { kind: "note", occurredOn: "", title: "x" }))).ok).toBe(false);
    expect((await run((uow) => addEvent(uow, matterId, { kind: "note", occurredOn: "2026-07-01", title: "x", partyId: "00000000-0000-4000-8000-000000000000" }))).ok).toBe(false);
    await run((uow) => addEvent(uow, matterId, { kind: "note", occurredOn: "2026-06-20", title: "Nota" }));

    const detail = (await getMatterDetail(db.db, matterId))!;
    expect(detail.events.map((e) => `${e.occurredOn}:${e.kind}`)).toEqual(["2026-07-01:hearing", "2026-06-20:note"]);
    expect(detail.events[0]).toMatchObject({ title: "Prima udienza", partyName: "Controparte" });

    const dossier = (await loadMatterDossier(db.db, matterId, t, TODAY))!;
    expect(dossier.timeline.dated.map((e) => e.kind)).toContain("event");

    const audits = await db.db.select().from(auditLog).where(eq(auditLog.entityId, matterId));
    expect(JSON.stringify(audits.map((r) => r.diff))).not.toContain("Aula 3");

    const removed = await run((uow) => removeEvent(uow, matterId, detail.events[1]!.id));
    expect(removed.ok).toBe(true);
    expect((await run((uow) => removeEvent(uow, matterId, detail.events[1]!.id))).ok).toBe(false);
    expect((await getMatterDetail(db.db, matterId))!.events).toHaveLength(1);
  });

  it("collega una scadenza alla pratica e la mostra nel fascicolo e presso l'ufficio; la cancellazione della pratica scollega", async () => {
    const office = okValue(await run((uow) => createParty(uow, { displayName: "Ufficio Collegato", roles: ["public_office"] }))).id;
    const matterId = okValue(await run((uow) => createMatter(uow, { title: "Pratica collegata", officePartyId: office }, TODAY))).id;
    const deadlineId = okValue(
      await run((uow) => createDeadline(uow, { title: "Integrazione richiesta", category: "administrative", level: "national", matterId, calc: { type: "manual" }, firstDueOn: "2026-08-01" }, TODAY)),
    ).id;
    // Nessun professionista indicato: senza il collegamento diretto non comparirebbe.
    const dossier = (await loadMatterDossier(db.db, matterId, t, TODAY))!;
    expect(dossier.timeline.dated.map((e) => `${e.date}:${e.kind}`)).toContain("2026-08-01:deadline");
    expect(dossier.checklist.map((c) => c.code)).not.toContain("noDeadlines");
    expect((await listDeadlines(db.db, {})).find((d) => d.id === deadlineId)?.matterId).toBe(matterId);
    expect((await getOfficeDetail(db.db, office, TODAY))!.view.deadlines.map((d) => d.title)).toEqual(["Integrazione richiesta"]);

    const missing = await run((uow) => createDeadline(uow, { title: "X", category: "administrative", level: "national", matterId: "00000000-0000-4000-8000-000000000000", calc: { type: "manual" }, firstDueOn: "2026-08-01" }, TODAY));
    expect(missing.ok).toBe(false);

    // Il collegamento si cambia anche per le scadenze che vengono da una regola (campi del proprietario).
    okValue(await run((uow) => updateOwnerFields(uow, deadlineId, { matterId })));

    await db.db.delete(matter).where(eq(matter.id, matterId));
    const [row] = await db.db.select({ matterId: deadline.matterId }).from(deadline).where(eq(deadline.id, deadlineId));
    expect(row!.matterId).toBeNull();
  });
});
