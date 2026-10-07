import { describe, expect, it } from "vitest";
import { buildNotarySheet, mentionsEncumbrance, notaryPackageHref, sumQuotas, type SheetInput } from "@/modules/notary";

const TODAY = "2026-06-15";
const right = (holderId: string, rightType: string, num: number, den: number, validTo: string | null = null) => ({
  holder: { id: holderId, displayName: `Titolare ${holderId}` },
  rightType, quotaNumerator: num, quotaDenominator: den, validFrom: null, validTo, notes: null,
});
const cad = (o: Partial<SheetInput["asset"]["cadastral"][number]> = {}) => ({ sheet: "5", parcel: "10", subunit: "3", cadastralCategory: "A/2", cadastralClass: null, consistency: null, incomeCents: null, validFrom: null, validTo: null, notes: null, ...o });
const base = (): SheetInput => ({
  today: TODAY,
  asset: { id: "a1", kind: "dwelling", name: "Casa", territoryLabel: "Comune", locality: null, address: "Via Prova 1", postalCode: null, useType: null, inCondominium: false, notes: null, rights: [], cadastral: [], attributes: {} },
  parties: [],
  documents: [],
  categories: [{ id: "c1", code: "title_deed", name: "Titolo" }, { id: "c2", code: "cadastral", name: "Catasto" }, { id: "c3", code: "other", name: "Altro" }],
  dossierItems: [],
  related: [],
});
const codes = (i: SheetInput) => buildNotarySheet(i).gaps.map((g) => g.code);

describe("scheda notaio: quote e diritti (casi limite)", () => {
  it("somma di nessuna quota = zero; quote oltre l'intero restano oltre l'intero", () => {
    expect(sumQuotas([])).toEqual({ numerator: 0, denominator: 1 });
    expect(sumQuotas([{ quotaNumerator: 3, quotaDenominator: 2 }, { quotaNumerator: 1, quotaDenominator: 2 }])).toEqual({ numerator: 2, denominator: 1 });
  });

  it("denominatori grandi non perdono precisione (BigInt)", () => {
    const q = Array.from({ length: 6 }, () => ({ quotaNumerator: 1, quotaDenominator: 1_000_003 }));
    expect(sumQuotas(q)).toEqual({ numerator: 6, denominator: 1_000_003 });
  });

  it("tutti i diritti terminati: «nessun diritto in corso», non «nessun diritto»; il giorno di oggi e' ancora in corso", () => {
    const ended = base();
    ended.asset.rights = [right("p1", "ownership", 1, 1, "2026-06-14")];
    expect(codes(ended)).toContain("noCurrentRights");
    expect(codes(ended)).not.toContain("noRights");
    const today = base();
    today.asset.rights = [right("p1", "ownership", 1, 1, TODAY)];
    expect(codes(today)).not.toContain("noCurrentRights");
    expect(codes(base())).toContain("noRights");
  });

  it("quote parziali per tipo di diritto: segnala solo il tipo incompleto con la somma ridotta", () => {
    const i = base();
    i.asset.rights = [right("p1", "ownership", 1, 3), right("p2", "ownership", 1, 6), right("p3", "usufruct", 1, 1)];
    const gap = buildNotarySheet(i).gaps.filter((g) => g.code === "quotaPartial");
    expect(gap).toEqual([{ code: "quotaPartial", params: { rightType: "ownership", sum: "1/2" } }]);
  });

  it("titolare senza codice fiscale e indirizzo: un solo avviso per titolare anche con piu' diritti", () => {
    const i = base();
    i.asset.rights = [right("p1", "ownership", 1, 2), right("p1", "usufruct", 1, 2), right("p2", "ownership", 1, 2)];
    i.parties = [{ id: "p2", displayName: "Titolare p2", taxCode: "XXXXXX", address: null, pec: null, email: null, phone: null }];
    const gaps = buildNotarySheet(i).gaps.filter((g) => g.code === "holderDataMissing");
    expect(gaps).toHaveLength(2);
    expect(gaps.find((g) => g.params.name === "Titolare p1")?.params.fields).toBe("taxCode,address");
    expect(gaps.find((g) => g.params.name === "Titolare p2")?.params.fields).toBe("address");
  });
});

describe("scheda notaio: catasto e documenti (casi limite)", () => {
  it("catasto: nessuna riga, solo storico, riga incompleta con i campi mancanti", () => {
    expect(codes(base())).toContain("noCadastral");
    const onlyHistory = base();
    onlyHistory.asset.cadastral = [cad({ validTo: "2020-01-01" })];
    expect(codes(onlyHistory)).toContain("noCurrentCadastral");
    expect(codes(onlyHistory)).not.toContain("noCadastral");
    const partial = base();
    partial.asset.cadastral = [cad({ sheet: null, subunit: null, cadastralCategory: null })];
    expect(buildNotarySheet(partial).gaps).toContainEqual({ code: "cadastralIncomplete", params: { fields: "sheet,subunit,category" } });
    const complete = base();
    complete.asset.cadastral = [cad()];
    expect(codes(complete)).not.toContain("cadastralIncomplete");
  });

  it("catasto: la riga piu' recente per prima, quelle senza data in fondo", () => {
    const i = base();
    i.asset.cadastral = [cad({ validFrom: null, parcel: "senza" }), cad({ validFrom: "2015-01-01", parcel: "vecchia" }), cad({ validFrom: "2022-01-01", parcel: "nuova" })];
    expect(buildNotarySheet(i).cadastralCurrent.map((c) => c.parcel)).toEqual(["nuova", "vecchia", "senza"]);
  });

  it("documenti: categoria scelta vuota segnalata; scaduti e da verificare contati", () => {
    const i = base();
    i.focusCategoryIds = ["c3"];
    i.documents = [
      { id: "d1", title: "A", categoryId: "c1", issuedOn: null, validTo: "2026-06-14", verificationStatus: "draft" },
      { id: "d2", title: "B", categoryId: "c1", issuedOn: null, validTo: TODAY, verificationStatus: "to_verify" },
      { id: "d3", title: "C", categoryId: "c1", issuedOn: null, validTo: null, verificationStatus: "verified_by_owner" },
    ];
    const s = buildNotarySheet(i);
    expect(s.documentGroups.map((g) => g.category.id)).toEqual(["c1", "c3"]);
    expect(s.documentTotals).toEqual({ total: 3, unverified: 2, expired: 1 });
    expect(s.gaps).toContainEqual({ code: "categoryEmpty", params: { name: "Altro" } });
    expect(s.gaps).toContainEqual({ code: "documentsToVerify", params: { count: 2 } });
    expect(s.gaps).toContainEqual({ code: "documentsExpired", params: { count: 1 } });
  });

  it("senza la categoria dei titoli il controllo sulla provenienza si salta; una nota sul diritto basta a non segnalarla", () => {
    const noCat = base();
    noCat.categories = [{ id: "c3", code: "other", name: "Altro" }];
    expect(codes(noCat)).not.toContain("provenanceNotRegistered");
    expect(codes(base())).toContain("provenanceNotRegistered");
    const withNote = base();
    withNote.asset.rights = [{ ...right("p1", "ownership", 1, 1), notes: "Successione 2001" }];
    expect(codes(withNote)).not.toContain("provenanceNotRegistered");
  });

  it("gravami: i titoli che li nominano compaiono da documento e dossier, ma non se gia' collegati a una registrazione", () => {
    const i = base();
    i.documents = [
      { id: "d1", title: "Nota di Ipoteca", categoryId: "c1", issuedOn: null, validTo: null, verificationStatus: "verified_by_owner" },
      { id: "d2", title: "Servitù di passo", categoryId: "c1", issuedOn: null, validTo: null, verificationStatus: "verified_by_owner" },
    ];
    i.dossierItems = [{ title: "Diritto di abitazione", categoryName: "x", status: "missing", documentCount: 0 }, { title: "Planimetria", categoryName: "x", status: "ok", documentCount: 1 }];
    i.encumbranceRecords = [{ id: "e1", kind: "mortgage", title: "Ipoteca", registeredOn: null, endedOn: null, beneficiaryName: null, amountCents: null, reference: null, documentId: "d1", documentTitle: "Nota di Ipoteca", note: null }];
    const s = buildNotarySheet(i);
    expect(s.encumbrances.map((e) => `${e.source}:${e.title}`)).toEqual(["document:Servitù di passo", "dossier:Diritto di abitazione"]);
    expect(s.dossierOpen).toHaveLength(1);
    expect(s.gaps).toContainEqual({ code: "dossierOpen", params: { count: 1 } });
    expect(mentionsEncumbrance("PIGNORAMENTO immobiliare")).toBe(true);
    expect(mentionsEncumbrance("")).toBe(false);
  });

  it("pertinenze senza diritti o senza catasto in corso sono segnalate per nome", () => {
    const i = base();
    i.related = [
      { id: "r1", name: "Box", kind: "garage", direction: "linkedTo", declaredBasis: null, validationStatus: "x", rightsCount: 0, currentCadastralCount: 1 },
      { id: "r2", name: "Cantina", kind: "cellar", direction: "linkedFrom", declaredBasis: null, validationStatus: "x", rightsCount: 1, currentCadastralCount: 0 },
    ];
    const g = buildNotarySheet(i).gaps;
    expect(g).toContainEqual({ code: "relatedNoRights", params: { name: "Box" } });
    expect(g).toContainEqual({ code: "relatedNoCadastral", params: { name: "Cantina" } });
    expect(g.filter((x) => x.code === "relatedNoRights")).toHaveLength(1);
  });
});

describe("scheda notaio: indirizzo del pacchetto", () => {
  it("senza contatto non aggiunge il parametro; codifica gli identificativi ostili", () => {
    const href = notaryPackageHref({ assetIds: [], categoryIds: [] });
    expect(href).not.toContain("contatto");
    expect(href).toContain("destinatario=notary");
    const hostile = notaryPackageHref({ assetIds: ["a&livello=public"], categoryIds: ["c#x"], contactId: null });
    expect(hostile).toContain("immobile=a%26livello%3Dpublic");
    expect(hostile.match(/livello=/g)).toHaveLength(1);
    expect(hostile).not.toContain("#");
  });
});
