import { describe, expect, it } from "vitest";
import { buildOfficeView, type OfficeDeadlineInput, type OfficeMatterInput } from "@/modules/offices/domain/office";
import { agentPackageHref, buildDocumentSection, ordinaryExpenses, recentWorks, type SheetDocument, type WorkLite } from "@/modules/agent/domain/sheet";
import { groupPoliciesByAsset, policiesWithoutAsset, type OverviewPolicy } from "@/modules/insurance/domain/assicuratore-overview";
import { overlapsYear, proofState, sortGaps, type DossierGap } from "@/modules/economy/domain/dossier";
import { buildTimeline, timelineCsv, TIMELINE_KINDS, type TimelineCsvLabels, type TimelineEvent } from "@/modules/matters/domain/dossier";

const TODAY = "2026-06-15";
const OFFICE = "office-1";

const matter = (o: Partial<OfficeMatterInput> & { id: string }): OfficeMatterInput => ({ title: o.id, status: "open", openedOn: "2026-01-01", closedOn: null, assetName: null, assignments: [], requests: [], opinions: [], ...o });
const request = (id: string, o: Partial<OfficeMatterInput["requests"][number]> = {}): OfficeMatterInput["requests"][number] => ({ id, title: id, requestedFromPartyId: OFFICE, status: "requested", requestedOn: "2026-01-02", dueOn: null, documentTitle: null, ...o });
const deadline = (id: string, o: Partial<OfficeDeadlineInput> = {}): OfficeDeadlineInput => ({ deadlineId: id, occurrenceId: `o-${id}`, title: id, dueOn: "2026-07-01", assetName: null, responsiblePartyId: null, professionalPartyId: null, ...o });

describe("uffici: vista di cio' che e' aperto (casi limite)", () => {
  it("nessun dato: conteggi a zero e nessuna prossima data", () => {
    expect(buildOfficeView(OFFICE, [], [], TODAY).counts).toEqual({ openMatters: 0, openRequests: 0, openDeadlines: 0, overdue: 0, nextDueOn: null, answers: 0 });
  });

  it("una pratica entra se l'ufficio e' incaricato, destinatario, a cui sono state chieste carte o che ha dato un parere; altre no", () => {
    const view = buildOfficeView(
      OFFICE,
      [
        matter({ id: "estranea", assignments: [{ partyId: "altro", role: "x" }], requests: [request("r", { requestedFromPartyId: "altro" })] }),
        matter({ id: "incaricato", assignments: [{ partyId: OFFICE, role: "referente" }] }),
        matter({ id: "destinatario", officePartyId: OFFICE, protocolNumber: "P1", submittedOn: "2026-02-01", responseDueOn: "2026-08-01" }),
        matter({ id: "richiesta", requests: [request("r1")] }),
        matter({ id: "parere", opinions: [{ id: "p", partyId: OFFICE, nature: "informational", summary: "s", issuedOn: null, documentTitle: null }] }),
      ],
      [],
      TODAY,
    );
    expect(view.matters.map((m) => m.id).sort()).toEqual(["destinatario", "incaricato", "parere", "richiesta"]);
    expect(view.matters.find((m) => m.id === "incaricato")).toMatchObject({ role: "referente", isRecipient: false, protocolNumber: null, submittedOn: null });
    expect(view.matters.find((m) => m.id === "destinatario")).toMatchObject({ role: null, isRecipient: true, protocolNumber: "P1", responseDueOn: "2026-08-01" });
  });

  it("i dati di protocollo di una pratica altrui non trapelano: solo se l'ufficio e' il destinatario", () => {
    const view = buildOfficeView(OFFICE, [matter({ id: "m", officePartyId: "altro-ufficio", protocolNumber: "SEGRETO", submittedOn: "2026-01-01", responseDueOn: "2026-02-02", assignments: [{ partyId: OFFICE, role: null }] })], [], TODAY);
    expect(view.matters[0]).toMatchObject({ protocolNumber: null, submittedOn: null, responseDueOn: null, isRecipient: false });
    expect(view.counts.nextDueOn).toBeNull();
  });

  it("ordine: aperte prima, dalla piu' vecchia; chiuse dopo, dalla piu' recente", () => {
    const view = buildOfficeView(
      OFFICE,
      [
        matter({ id: "chiusa-vecchia", status: "closed", openedOn: "2020-01-01", assignments: [{ partyId: OFFICE, role: null }] }),
        matter({ id: "aperta-nuova", openedOn: "2026-05-01", assignments: [{ partyId: OFFICE, role: null }] }),
        matter({ id: "chiusa-nuova", status: "closed", openedOn: "2025-01-01", assignments: [{ partyId: OFFICE, role: null }] }),
        matter({ id: "aperta-vecchia", status: "waiting", openedOn: "2026-01-01", assignments: [{ partyId: OFFICE, role: null }] }),
      ],
      [],
      TODAY,
    );
    expect(view.matters.map((m) => m.id)).toEqual(["aperta-vecchia", "aperta-nuova", "chiusa-nuova", "chiusa-vecchia"]);
    expect(view.counts.openMatters).toBe(2);
  });

  it("scadenze: responsabile, professionista o pratica destinataria; ritardo il giorno dopo; la data piu' vicina vince tra richieste, termine di risposta e scadenze", () => {
    const view = buildOfficeView(
      OFFICE,
      [
        matter({ id: "dest", officePartyId: OFFICE, responseDueOn: "2026-06-14", requests: [request("r1", { dueOn: "2026-05-01" }), request("r2", { status: "received" }), request("r3", { dueOn: null })] }),
        matter({ id: "chiusa", status: "closed", officePartyId: OFFICE, responseDueOn: "2020-01-01", requests: [request("rc", { dueOn: "2020-01-01" })] }),
      ],
      [
        deadline("resp", { responsiblePartyId: OFFICE, dueOn: TODAY }),
        deadline("prof", { professionalPartyId: OFFICE, dueOn: "2026-06-14" }),
        deadline("pratica", { matterId: "dest", dueOn: "2026-09-01" }),
        deadline("pratica-chiusa", { matterId: "chiusa", dueOn: "2026-10-01" }),
        deadline("altrui", { responsiblePartyId: "altro", dueOn: "2026-01-01" }),
        deadline("senza-collegamento", { matterId: null }),
      ],
      TODAY,
    );
    expect(view.deadlines.map((d) => d.deadlineId)).toEqual(["prof", "resp", "pratica", "pratica-chiusa"]);
    expect(view.deadlines.map((d) => d.overdue)).toEqual([true, false, false, false]);
    // In ritardo: scadenza "prof" + richiesta r1 (maggio) + termine di risposta (14 giugno); le voci della pratica chiusa non contano.
    expect(view.counts).toMatchObject({ openMatters: 1, openRequests: 2, openDeadlines: 4, overdue: 3, nextDueOn: "2026-05-01" });
    // Risposte: la richiesta ricevuta r2 (le chiuse contano anch'esse tra le pratiche dell'ufficio, ma non e' una risposta aperta).
    expect(view.counts.answers).toBe(1);
  });
});

describe("scheda per l'agente: casi limite", () => {
  const doc = (id: string, categoryId: string, o: Partial<SheetDocument> = {}): SheetDocument => ({ id, title: id, categoryId, confidentiality: "ordinary", issuedOn: null, validTo: null, verificationStatus: "draft", ...o });
  const cats = [{ id: "c1", name: "Titoli" }, { id: "c2", name: "Catasto" }, { id: "c3", name: "Impianti" }];

  it("categorie scelte senza documenti, con soli documenti oltre il livello, e documenti scaduti il giorno dopo", () => {
    const s = buildDocumentSection({
      documents: [doc("t", "c1", { confidentiality: "reserved" }), doc("c", "c2", { validTo: "2026-06-14" }), doc("c-oggi", "c2", { validTo: TODAY })],
      categories: cats,
      cap: "ordinary",
      focusCategoryIds: ["c1", "c2", "c3"],
      dossier: [{ title: "Agibilità", status: "missing" }, { title: "APE", status: "requested" }, { title: "Vecchia", status: "expired" }, { title: "Ok", status: "present" }],
      today: TODAY,
    });
    expect(s.withheldTotal).toBe(1);
    expect(s.checklist).toEqual([
      { kind: "category_withheld", categoryName: "Titoli", count: 1 },
      { kind: "category_empty", categoryName: "Impianti" },
      { kind: "document_expired", title: "c", validTo: "2026-06-14" },
      { kind: "dossier_open", title: "Agibilità", status: "missing" },
      { kind: "dossier_open", title: "APE", status: "requested" },
      { kind: "dossier_open", title: "Vecchia", status: "expired" },
    ]);
    expect(s.groups.map((g) => g.category.id)).toEqual(["c1", "c2"]);
  });

  it("senza categorie scelte (null) si guardano tutte; con elenco vuoto nessuna; il livello piu' alto vede tutto", () => {
    const base = { documents: [doc("t", "c1", { confidentiality: "highly_reserved" })], categories: cats, dossier: [], today: TODAY };
    expect(buildDocumentSection({ ...base, cap: "ordinary", focusCategoryIds: null }).checklist.map((c) => c.kind)).toEqual(["category_withheld", "category_empty", "category_empty"]);
    expect(buildDocumentSection({ ...base, cap: "ordinary", focusCategoryIds: [] }).checklist).toEqual([]);
    const all = buildDocumentSection({ ...base, cap: "highly_reserved", focusCategoryIds: ["c1"] });
    expect(all.withheldTotal).toBe(0);
    expect(all.groups[0]!.documents).toHaveLength(1);
  });

  it("spese ordinarie: solo preventivi ordinari e solo le rate dell'immobile; nessuna rata = nessuna riga", () => {
    const years = [
      { label: "2025", budgets: [{ kind: "ordinary", title: "Ord", installments: [{ assetId: "a", amountCents: 100, paidCents: 40 }, { assetId: "a", amountCents: 50, paidCents: 50 }, { assetId: "b", amountCents: 999, paidCents: 0 }] }, { kind: "extraordinary", title: "Str", installments: [{ assetId: "a", amountCents: 7, paidCents: 0 }] }, { kind: "ordinary", title: "Altro immobile", installments: [{ assetId: "b", amountCents: 1, paidCents: 0 }] }] },
      { label: "2026", budgets: [] },
    ];
    expect(ordinaryExpenses(years, "a")).toEqual([{ yearLabel: "2025", title: "Ord", dueCents: 150, paidCents: 90 }]);
    expect(ordinaryExpenses(years, "zzz")).toEqual([]);
    expect(ordinaryExpenses([], "a")).toEqual([]);
  });

  it("lavori recenti: annullati esclusi, data di riferimento fine > inizio > prevista, senza date in fondo, limite rispettato", () => {
    const w = (id: string, o: Partial<WorkLite> = {}): WorkLite => ({ id, title: id, status: "completed", scheduledOn: null, startedOn: null, completedOn: null, supplierName: null, ...o });
    const out = recentWorks([w("senza"), w("annullato", { status: "cancelled", completedOn: "2030-01-01" }), w("prevista", { scheduledOn: "2026-09-01" }), w("fine", { completedOn: "2026-03-01", startedOn: "2027-01-01" }), w("inizio", { startedOn: "2026-05-01" })]);
    expect(out.map((x) => [x.id, x.referenceOn])).toEqual([["prevista", "2026-09-01"], ["inizio", "2026-05-01"], ["fine", "2026-03-01"], ["senza", null]]);
    expect(recentWorks(Array.from({ length: 15 }, (_, i) => w(`w${i}`, { completedOn: `2026-01-${String(i + 1).padStart(2, "0")}` })))).toHaveLength(10);
    expect(recentWorks([w("a"), w("b")], 1)).toHaveLength(1);
    expect(recentWorks([])).toEqual([]);
  });

  it("indirizzo del pacchetto per l'agente: livello predefinito ordinario, contatto solo se presente, valori codificati", () => {
    const href = agentPackageHref({ assetId: "a&b", categoryIds: ["c 1"] });
    expect(href).toContain("livello=ordinary");
    expect(href).toContain("immobile=a%26b");
    expect(href).toContain("categoria=c+1");
    expect(href).not.toContain("contatto");
    expect(agentPackageHref({ assetId: "a", categoryIds: [], contactId: "k", level: "reserved" })).toContain("contatto=k");
    expect(agentPackageHref({ assetId: "a", categoryIds: [], level: "reserved" })).toContain("livello=reserved");
  });
});

describe("assicurazioni: polizze per bene (casi limite)", () => {
  const policy = (id: string, o: Partial<OverviewPolicy> = {}): OverviewPolicy => ({ id, title: id, insurerName: null, policyNumber: null, startsOn: null, endsOn: null, state: "active", premiumCents: null, assetIds: [], openClaims: 0, coverages: [], ...o });

  it("stato del bene: nessuna polizza, solo scadute, in corso (anche senza data di fine); le garanzie sono quelle del bene o dell'intera polizza", () => {
    const rows = groupPoliciesByAsset(
      [{ id: "a", name: "A", declaredValueCents: 500 }, { id: "b", name: "B" }, { id: "c", name: "C" }],
      [
        policy("scaduta", { assetIds: ["b"], state: "expired", endsOn: "2020-01-01" }),
        policy("senza-fine", { assetIds: ["a"], state: "undated" }),
        policy("futura", { assetIds: ["c"], state: "upcoming" }),
        policy("mista", { assetIds: ["a", "b"], endsOn: "2027-01-01", coverages: [{ title: "mia", assetId: "a", sumInsuredCents: 1, deductibleCents: null }, { title: "altro", assetId: "b", sumInsuredCents: 2, deductibleCents: null }, { title: "intera", assetId: null, sumInsuredCents: 3, deductibleCents: null }] }),
      ],
    );
    expect(rows.map((r) => [r.assetId, r.status])).toEqual([["a", "current"], ["b", "current"], ["c", "notCurrent"]]);
    expect(rows[0]!.declaredValueCents).toBe(500);
    expect(rows[1]!.declaredValueCents).toBeNull();
    expect(rows[0]!.policies.map((p) => p.id)).toEqual(["mista", "senza-fine"]);
    expect(rows[0]!.policies[0]!.coverages.map((c) => c.title)).toEqual(["mia", "intera"]);
    expect(groupPoliciesByAsset([{ id: "x", name: "X" }], [])[0]!.status).toBe("none");
    expect(groupPoliciesByAsset([], [policy("p")])).toEqual([]);
  });

  it("a parita' di scadenza le polizze si ordinano per titolo; senza bene collegato sono segnalate a parte", () => {
    const rows = groupPoliciesByAsset([{ id: "a", name: "A" }], [policy("zeta", { assetIds: ["a"], endsOn: "2027-01-01" }), policy("alfa", { assetIds: ["a"], endsOn: "2027-01-01" })]);
    expect(rows[0]!.policies.map((p) => p.id)).toEqual(["alfa", "zeta"]);
    expect(policiesWithoutAsset([policy("a", { assetIds: ["x"] }), policy("b")]).map((p) => p.id)).toEqual(["b"]);
  });
});

describe("dossier economico: intervalli e ordine (casi limite)", () => {
  it("un periodo tocca l'anno anche se coincide per un solo giorno; estremi assenti = senza limite", () => {
    expect(overlapsYear(null, null, 2026)).toBe(true);
    expect(overlapsYear("2026-12-31", null, 2026)).toBe(true);
    expect(overlapsYear("2027-01-01", null, 2026)).toBe(false);
    expect(overlapsYear(null, "2026-01-01", 2026)).toBe(true);
    expect(overlapsYear(null, "2025-12-31", 2026)).toBe(false);
    expect(overlapsYear("2020-01-01", "2030-01-01", 2026)).toBe(true);
  });

  it("stato della prova: campo assente, vuoto, presente", () => {
    expect(proofState({ documentId: undefined })).toBe("notTracked");
    expect(proofState({ documentId: null })).toBe("missing");
    expect(proofState({ documentId: "d" })).toBe("present");
  });

  it("le segnalazioni si ordinano per genere, poi immobile (senza immobile in testa), voce e data; l'elenco originale non cambia", () => {
    const g = (kind: DossierGap["kind"], subject: string, assetName: string | null, date: string | null): DossierGap => ({ kind, subject, assetName, date, amountCents: null, href: "/" });
    const input = [g("payment_no_proof", "B", "Zeta", null), g("asset_no_rights", "Z", "Alfa", null), g("payment_no_proof", "A", "Zeta", "2026-02-01"), g("payment_no_proof", "A", "Zeta", null), g("payment_no_proof", "C", null, null), g("asset_no_rights", "A", "Alfa", null)];
    const copy = [...input];
    const sorted = sortGaps(input);
    expect(sorted.map((x) => `${x.kind}/${x.assetName}/${x.subject}/${x.date}`)).toEqual([
      "asset_no_rights/Alfa/A/null",
      "asset_no_rights/Alfa/Z/null",
      "payment_no_proof/null/C/null",
      "payment_no_proof/Zeta/A/null",
      "payment_no_proof/Zeta/A/2026-02-01",
      "payment_no_proof/Zeta/B/null",
    ]);
    expect(input).toEqual(copy);
  });
});

describe("pratiche: cronologia (casi limite)", () => {
  const ev = (title: string, kind: TimelineEvent["kind"], date: string | null, o: Partial<TimelineEvent> = {}): TimelineEvent => ({ date, kind, title, detail: null, href: null, amountCents: null, ...o });
  const labels: TimelineCsvLabels = { header: ["Data", "Fonte", "Fatto", "Dettaglio", "Importo"], kind: Object.fromEntries(TIMELINE_KINDS.map((k) => [k, `K:${k}`])) as TimelineCsvLabels["kind"] };

  it("a parita' di data per fonte e poi per titolo; gli eventi senza data non si perdono e stanno a parte", () => {
    const t = buildTimeline([ev("b", "rent", "2026-01-01"), ev("z", "matter", "2026-01-01"), ev("a", "rent", "2026-01-01"), ev("prima", "document", "2025-12-31"), ev("senza-2", "rent", null), ev("senza-1", "matter", null)]);
    expect(t.dated.map((e) => e.title)).toEqual(["prima", "z", "a", "b"]);
    expect(t.undated.map((e) => e.title)).toEqual(["senza-1", "senza-2"]);
    expect(buildTimeline([])).toEqual({ dated: [], undated: [] });
  });

  it("CSV: date in italiano, importo con virgola (anche zero), vuoti dove non c'e' dato, senza data in fondo", () => {
    const csv = timelineCsv(buildTimeline([ev("Senza data", "event", null), ev("Canone", "rent", "2026-03-05", { amountCents: 0 }), ev("Sinistro", "claim", "2026-02-01", { amountCents: 123456, detail: "Nota" })]), labels);
    const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter(Boolean);
    expect(lines[0]).toBe("Data;Fonte;Fatto;Dettaglio;Importo");
    expect(lines[1]).toBe("01/02/2026;K:claim;Sinistro;Nota;1.234,56");
    expect(lines[2]).toBe("05/03/2026;K:rent;Canone;;0,00");
    expect(lines[3]).toBe(";K:event;Senza data;;");
  });
});
