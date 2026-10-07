import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { territory } from "@/platform/db/schema";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { createAsset } from "@/modules/assets";
import { completeOccurrence, createDeadline, deadlinesCalendar, listOccurrences, setDeadlineArchived, type CalendarLabels } from "@/modules/deadlines";
import { importIstat } from "@/modules/territory";
import { alarmTrigger, buildIcs, foldLine, icsText } from "@/shared/ics";
import { createTestDb, type TestDb } from "./helpers/test-db";

const actor = { type: "owner", id: "o1" } as const;
const NOW = new Date("2026-10-06T08:30:00.000Z");
const octets = (s: string) => new TextEncoder().encode(s).length;

describe("ics: testo e righe", () => {
  it("fa l'escape di backslash, punto e virgola, virgola e a capo, e toglie i caratteri di controllo", () => {
    expect(icsText("a\\b; c, d\nriga")).toBe("a\\\\b\\; c\\, d\\nriga");
    expect(icsText("uno\r\ndue\rtre")).toBe("uno\\ndue\\ntre");
    expect(icsText("x\u0000y\u0007z")).toBe("xyz");
  });

  it("piega le righe oltre 75 byte, con uno spazio di continuazione, senza spezzare un carattere", () => {
    expect(foldLine("corta")).toBe("corta");
    const long = `DESCRIPTION:${"àèìòù€😀".repeat(30)}`;
    const folded = foldLine(long);
    const lines = folded.split("\r\n");
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(octets(line)).toBeLessThanOrEqual(75);
    for (const line of lines.slice(1)) expect(line.startsWith(" ")).toBe(true);
    // Rimettendo insieme le righe si riottiene l'originale.
    expect(lines.map((l, i) => (i === 0 ? l : l.slice(1))).join("")).toBe(long);
  });

  it("i promemoria sono alle 9:00 del giorno stabilito", () => {
    expect(alarmTrigger(0)).toBe("PT9H");
    expect(alarmTrigger(1)).toBe("-PT15H");
    expect(alarmTrigger(7)).toBe("-P6DT15H");
    expect(alarmTrigger(30)).toBe("-P29DT15H");
  });
});

describe("ics: calendario", () => {
  const ics = buildIcs({
    name: "Scadenze; di prova",
    now: NOW,
    events: [
      { uid: "a@x", date: "2026-12-31", summary: "Fine anno, saldo", description: "Riga uno\nRiga due", url: "https://app.example.test/scadenze/1", alarmsDaysBefore: [7, 0, 7], alarmText: "Scadenza: Fine anno" },
      { uid: "b@x", date: "2026-02-28", summary: "Senza promemoria" },
    ],
  });

  it("usa CRLF ovunque e inizia e finisce come un calendario", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(ics).toContain("X-WR-CALNAME:Scadenze\\; di prova\r\n");
  });

  it("scrive eventi di un giorno intero con fine esclusiva, anche a cavallo dell'anno", () => {
    expect(ics).toContain("DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101\r\n");
    expect(ics).toContain("DTSTART;VALUE=DATE:20260228\r\nDTEND;VALUE=DATE:20260301\r\n");
    expect(ics).toContain("DTSTAMP:20261006T083000Z\r\n");
    expect(ics).toContain("SUMMARY:Fine anno\\, saldo\r\n");
    expect(ics).toContain("DESCRIPTION:Riga uno\\nRiga due\r\n");
    expect(ics).toContain("URL:https://app.example.test/scadenze/1\r\n");
  });

  it("un promemoria per ogni preavviso (senza doppioni, dal piu' lontano) e nessuno se non ce ne sono", () => {
    const first = ics.split("BEGIN:VEVENT")[1]!;
    const second = ics.split("BEGIN:VEVENT")[2]!;
    expect(first.match(/BEGIN:VALARM/g)).toHaveLength(2);
    expect(first.indexOf("TRIGGER:-P6DT15H")).toBeLessThan(first.indexOf("TRIGGER:PT9H"));
    expect(second).not.toContain("VALARM");
  });

  it("eventi, promemoria e proprieta' sono bilanciati", () => {
    for (const tag of ["VEVENT", "VALARM"]) expect(ics.match(new RegExp(`BEGIN:${tag}`, "g"))?.length).toBe(ics.match(new RegExp(`END:${tag}`, "g"))?.length);
  });

  it("un indirizzo con spazi o a capo non puo' aggiungere proprieta' al file", () => {
    const hostile = buildIcs({ name: "n", now: NOW, events: [{ uid: "c@x", date: "2026-01-01", summary: "s", url: "https://x.test/\r\nBEGIN:VEVENT" }] });
    // L'indirizzo resta su una riga sola: nessuna riga in piu' che apra un secondo evento.
    expect(hostile.split("\r\n").filter((line) => line === "BEGIN:VEVENT")).toHaveLength(1);
  });
});

describe("ics: scadenze aperte", () => {
  let t: TestDb;
  const run = <V>(work: Parameters<typeof runInUnitOfWork<V>>[2]) => runInUnitOfWork(t.db, actor, work);
  const okValue = <V>(r: { ok: boolean; value?: V }): V => {
    if (!r.ok) throw new Error(`atteso successo: ${JSON.stringify(r)}`);
    return r.value as V;
  };
  const labels: CalendarLabels = {
    name: "Scadenze immobili",
    category: { fiscal: "Fiscale", insurance: "Assicurativa", technical: "Tecnica", condominium: "Condominio", contractual: "Contrattuale", letting: "Locazione", hospitality: "Ricettività", administrative: "Amministrativa", other: "Altro" },
    priority: { low: "Bassa", normal: "Normale", high: "Alta", urgent: "Urgente" },
    fields: { category: "Categoria", asset: "Immobile", priority: "Priorità", proofRequired: "Richiede una prova" },
    alarm: (title) => `Scadenza: ${title}`,
  };
  const base = { category: "fiscal", level: "national", calc: { type: "manual" }, priority: "normal" } as const;

  let municipalityId: string;
  beforeAll(async () => {
    t = await createTestDb();
    await run((uow) => importIstat(uow, [{ regionCode: "90", regionName: "Regione di prova", provinceCode: "900", provinceName: "Provincia di prova", provinceSigla: "PP", municipalityCode: "900001", municipalityName: "Comune Uno", cadastralCode: "Z101" }]));
    municipalityId = (await t.db.select().from(territory).where(eq(territory.kind, "municipality")))[0]!.id;
  }, 60_000);
  afterAll(() => t.close());

  it("contiene le sole scadenze aperte e non archiviate, con categoria, immobile e priorita'", async () => {
    const assetId = okValue(await run((uow) => createAsset(uow, { displayName: "P", email: "p@example.test" }, { kind: "dwelling", name: "Villa Uno", territoryId: municipalityId }))).id;
    okValue(await run((uow) => createDeadline(uow, { ...base, title: "Imposta aperta", firstDueOn: "2030-06-16", priority: "high", assetId, leadDays: [30, 7] })));
    const done = okValue(await run((uow) => createDeadline(uow, { ...base, title: "Imposta pagata", firstDueOn: "2030-07-01" })));
    const archived = okValue(await run((uow) => createDeadline(uow, { ...base, title: "Imposta archiviata", firstDueOn: "2030-08-01" })));

    const occurrence = (await listOccurrences(t.db, "open", { deadlineId: done.id }))[0]!;
    okValue(await run((uow) => completeOccurrence(uow, occurrence.id, { completedOn: "2030-06-30", completionKind: "owner", reference: "F24" })));
    okValue(await run((uow) => setDeadlineArchived(uow, archived.id, true)));

    const ics = await deadlinesCalendar(t.db, labels, { baseUrl: "https://casa.example.test", now: NOW });
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain("SUMMARY:Imposta aperta\r\n");
    expect(ics).toContain("DTSTART;VALUE=DATE:20300616\r\n");
    expect(ics).toContain("DESCRIPTION:Categoria: Fiscale\\nImmobile: Villa Uno\\nPriorità: Alta\r\n");
    expect(ics).toMatch(/URL:https:\/\/casa\.example\.test\/scadenze\/[0-9a-f-]{36}\r\n/);
    expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(2);
    expect(ics).toContain("DESCRIPTION:Scadenza: Imposta aperta\r\n");
    expect(ics).not.toContain("pagata");
    expect(ics).not.toContain("archiviata");
  });

  it("senza scadenze aperte e' un calendario valido ma vuoto", async () => {
    const empty = await createTestDb();
    try {
      const ics = await deadlinesCalendar(empty.db, labels, { now: NOW });
      expect(ics).toBe("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Gestione Immobili//Scadenze//IT\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nX-WR-CALNAME:Scadenze immobili\r\nEND:VCALENDAR\r\n");
    } finally {
      await empty.close();
    }
  }, 60_000);
});
