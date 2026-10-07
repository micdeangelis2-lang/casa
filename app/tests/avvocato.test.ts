import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { LocalFileStorage } from "@/platform/storage";
import { createDeadline } from "@/modules/deadlines";
import { createDocument, listDocumentCategories } from "@/modules/documents";
import { createParty } from "@/modules/directory";
import { addOpinion, addRequest, assignParty, createMatter, linkMatterDocument } from "@/modules/matters";
import { buildChecklist, buildTimeline, timelineCsv, type TimelineEvent } from "@/modules/matters/domain/dossier";
import messages from "../messages/it.json";
import { csvLabels, loadMatterDossier, type DossierT } from "@/lib/matter-dossier";
import { createTestDb, type TestDb } from "./helpers/test-db";
import { makePdf } from "./helpers/sample-pdf";
import { conclusiveClaims } from "./helpers/neutral";

const actor = { type: "owner", id: "o1" } as const;
const TODAY = "2026-06-15";

/** Traduttore finto sullo spazio dei nomi `avvocato` reale (sostituisce {x}). */
const t: DossierT = (key, values = {}) => {
  const text = key.split(".").reduce<unknown>((n, p) => (n as Record<string, unknown> | undefined)?.[p], messages.avvocato);
  if (typeof text !== "string") throw new Error(`messaggio mancante: ${key}`);
  return text.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ""));
};

const ev = (over: Partial<TimelineEvent>): TimelineEvent => ({ date: "2026-01-01", kind: "matter", title: "x", detail: null, href: null, amountCents: null, ...over });

describe("fascicolo per il professionista (logica pura)", () => {
  it("ordina per data, poi per fonte e titolo, e tiene a parte gli eventi senza data", () => {
    const timeline = buildTimeline([ev({ date: "2026-03-01", title: "b", kind: "document" }), ev({ date: null, title: "senza data" }), ev({ date: "2026-02-01", title: "a" }), ev({ date: "2026-03-01", title: "a", kind: "request" })]);
    expect(timeline.dated.map((e) => `${e.date}:${e.kind}`)).toEqual(["2026-02-01:matter", "2026-03-01:request", "2026-03-01:document"]);
    expect(timeline.undated.map((e) => e.title)).toEqual(["senza data"]);
  });

  it("il CSV ha date gg/mm/aaaa, importi con la virgola e neutralizza le formule", () => {
    const csv = timelineCsv(buildTimeline([ev({ date: "2026-03-01", title: "=SOMMA(A1)", amountCents: 123456 }), ev({ date: null, title: "n" })]), csvLabels(t));
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe("Data;Fonte;Fatto;Dettaglio;Importo (euro)");
    expect(lines[1]).toContain("01/03/2026;Pratica;'=SOMMA(A1);");
    expect(lines[1]).toContain("1.234,56");
    expect(lines[2]?.startsWith(";Pratica;n")).toBe(true);
  });

  it("l'elenco da completare dice cosa manca nei dati e basta", () => {
    const base = { today: TODAY, partyCount: 1, hasLawyerRole: true, hasAsset: true, hasDescription: true, documents: [{ title: "D", issuedOn: "2026-01-01", validTo: null }], requests: [], opinions: [], deadlineCount: 1 };
    expect(buildChecklist(base)).toEqual([]);
    const codes = buildChecklist({
      ...base,
      partyCount: 1,
      hasLawyerRole: false,
      hasAsset: false,
      documents: [{ title: "Senza data", issuedOn: null, validTo: "2026-01-01" }],
      requests: [{ title: "Visura", status: "requested", dueOn: "2026-05-01" }, { title: "Chiusa", status: "received", dueOn: "2026-05-01" }],
      opinions: [{ partyName: "Avv. X", documentId: null }],
      deadlineCount: 0,
    });
    expect(codes.map((c) => c.code)).toEqual(["noLawyerRole", "noAsset", "openRequests", "requestsPastDue", "documentsWithoutIssueDate", "documentsPastValidity", "opinionsWithoutDocument", "noDeadlines"]);
    expect(codes.find((c) => c.code === "requestsPastDue")?.names).toEqual(["Visura"]);
  });

  it("i testi del fascicolo sono neutri", () => {
    const texts = JSON.stringify(messages.avvocato).split('","').join('"\n"').split("\n");
    expect(texts.flatMap((s) => conclusiveClaims(s))).toEqual([]);
  });
});

describe("fascicolo per il professionista (dati)", () => {
  let tdb: TestDb;
  let dir: string;
  const run = <T>(work: Parameters<typeof runInUnitOfWork<T>>[2]) => runInUnitOfWork(tdb.db, actor, work);
  const okValue = <V>(r: { ok: boolean; value?: V }): V => {
    if (!r.ok) throw new Error(`atteso successo: ${JSON.stringify(r)}`);
    return r.value as V;
  };

  beforeAll(async () => {
    tdb = await createTestDb();
    dir = await mkdtemp(join(tmpdir(), "avvocato-test-"));
  }, 60_000);
  afterAll(async () => {
    await tdb.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("raccoglie parti, richieste, pareri, documenti e scadenze del professionista in ordine di data", async () => {
    const storage = new LocalFileStorage(dir);
    const lawyerId = okValue(await run((uow) => createParty(uow, { displayName: "Avv. Esempio", roles: ["lawyer"], pec: "avv@pec.example.test" }))).id;
    const categoryId = (await listDocumentCategories(tdb.db))[0]!.id;
    const documentId = okValue(await run((uow) => createDocument(uow, { categoryId, title: "Diffida", issuedOn: "2026-02-10" }, { name: "diffida.pdf", bytes: makePdf("diffida") }, storage))).id;
    const matterId = okValue(await run((uow) => createMatter(uow, { title: "Contenzioso di prova", description: "Fatti" }, "2026-02-01"))).id;
    await run((uow) => assignParty(uow, matterId, { partyId: lawyerId, role: "legale" }));
    await run((uow) => addRequest(uow, matterId, { title: "Estratto conto", requestedFromPartyId: lawyerId, dueOn: "2026-03-01" }, "2026-02-05"));
    await run((uow) => addOpinion(uow, matterId, { partyId: lawyerId, nature: "informational", summary: "Orientamento", issuedOn: "2026-02-20" }));
    await run((uow) => linkMatterDocument(uow, matterId, documentId));
    const deadlineId = okValue(await run((uow) => createDeadline(uow, { title: "Udienza", category: "administrative", level: "national", professionalPartyId: lawyerId, calc: { type: "manual" }, firstDueOn: "2026-07-01", leadDays: [7, 0] }, TODAY))).id;
    expect(deadlineId).toBeTruthy();

    const dossier = (await loadMatterDossier(tdb.db, matterId, t, TODAY))!;
    expect(dossier.parties).toMatchObject([{ displayName: "Avv. Esempio", pec: "avv@pec.example.test", role: "legale" }]);
    expect(dossier.documents.map((d) => d.title)).toEqual(["Diffida"]);
    expect(dossier.timeline.dated.map((e) => `${e.date}:${e.kind}`)).toEqual([
      "2026-02-01:matter",
      "2026-02-05:request",
      "2026-02-10:document",
      "2026-02-20:opinion",
      "2026-03-01:request",
      "2026-07-01:deadline",
    ]);
    expect(dossier.checklist.map((c) => c.code)).toEqual(["noAsset", "openRequests", "requestsPastDue", "opinionsWithoutDocument"]);
    expect(await loadMatterDossier(tdb.db, "00000000-0000-4000-8000-000000000000", t, TODAY)).toBeNull();
  }, 60_000);
});
