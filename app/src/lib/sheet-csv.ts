import { csvDocument, type CsvCell } from "@/shared/csv";
import { formatCents } from "@/shared/money";
import type { getAgentSheet } from "@/modules/agent";
import type { getPlantRegister } from "@/modules/maintenance";
import type { NotarySheet } from "@/modules/notary";
import type { PoliciesByAsset } from "@/modules/insurance";

/**
 * CSV delle viste che prima non lo avevano (registro impianti, polizze per immobile, scheda per il notaio, scheda per l'agente).
 * Funzioni pure: i dati arrivano dai moduli di lettura (gli stessi delle pagine), i testi dei codici da chi chiama. Date come
 * gg/mm/aaaa, importi in euro con la virgola. Solo cio' che risulta registrato: nessun giudizio di conformita'.
 */

const dateCell = (value: string | null): string => (value ? value.split("-").reverse().join("/") : "");
const euros = (cents: number | null): string => (cents === null ? "" : formatCents(cents));
const yesNo = (v: boolean): string => (v ? "sì" : "no");
const section = (title: string, header: CsvCell[], body: CsvCell[][]): CsvCell[][] => [[], [title], header, ...body];
const period = (from: string | null, to: string | null): string => [from ? `dal ${dateCell(from)}` : null, to ? `al ${dateCell(to)}` : null].filter(Boolean).join(" ");

// ----------------------------------------------------------------------------------------------- registro impianti

type PlantRegister = Awaited<ReturnType<typeof getPlantRegister>>;

export type PlantCsvLabels = {
  typeName: (code: string) => string;
  state: (code: string) => string;
  dueKind: (code: string) => string;
  workStatus: (code: string) => string;
};

export function plantRegisterCsv(register: PlantRegister, today: string, labels: PlantCsvLabels): string {
  const name = (g: PlantRegister["groups"][number]) => g.plant?.name ?? labels.typeName(g.type);
  const rows: CsvCell[][] = [
    ["Registro impianti"],
    [`Preparato il ${dateCell(today)} con le date scritte dal proprietario. Non dice se un impianto sia a norma né se una verifica sia dovuta: elenca ciò che risulta registrato.`],
    ...section(
      "Impianti",
      ["Immobile", "Impianto", "Tipo", "Installato il", "Matricola", "Installatore", "Manutentore", "Ultima verifica", "Prossima scadenza", "Situazione", "Fine garanzia", "Fornitori"],
      register.groups.map((g): CsvCell[] => [g.assetName, name(g), labels.typeName(g.type), dateCell(g.plant?.installedOn ?? null), g.plant?.serialNumber ?? "", g.plant?.installerName ?? "", g.plant?.maintainerName ?? "", dateCell(g.lastDoneOn), dateCell(g.nextDueOn), labels.state(g.nextState), dateCell(g.warrantyEndsOn), g.suppliers.join(" / ")]),
    ),
    ...section(
      "Verifiche periodiche registrate",
      ["Immobile", "Impianto", "Verifica", "Ogni (mesi)", "Ultima eseguita", "Prossima", "Fornitore"],
      register.groups.flatMap((g) => g.plans.map((p): CsvCell[] => [g.assetName, name(g), p.title, p.intervalMonths, dateCell(p.lastDoneOn), dateCell(p.nextDueOn), p.supplierName ?? ""])),
    ),
    ...section(
      "Garanzie registrate",
      ["Immobile", "Impianto", "Garanzia", "Dal", "Al", "Fornitore", "Documento"],
      register.groups.flatMap((g) => g.warranties.map((w): CsvCell[] => [g.assetName, name(g), w.title, dateCell(w.startsOn), dateCell(w.endsOn), w.supplierName ?? "", w.documentTitle ?? ""])),
    ),
    ...section(
      "Interventi collegati",
      ["Immobile", "Impianto", "Intervento", "Stato", "Data", "Fornitore"],
      register.groups.flatMap((g) => g.works.map((w): CsvCell[] => [g.assetName, name(g), w.title, labels.workStatus(w.status), dateCell(w.completedOn ?? w.scheduledOn), w.supplierName ?? ""])),
    ),
    ...section(
      "Documenti collegati",
      ["Immobile", "Impianto", "Documento", "Categoria", "Valido fino al"],
      register.groups.flatMap((g) => g.documents.map((d): CsvCell[] => [g.assetName, name(g), d.title, d.categoryName, dateCell(d.validTo)])),
    ),
    ...section(
      "Date da guardare",
      ["Data", "Che cosa", "Titolo", "Immobile", "Impianto", "Situazione"],
      register.due.map((d): CsvCell[] => [dateCell(d.date), labels.dueKind(d.kind), d.title, d.assetName, labels.typeName(d.type), labels.state(d.state)]),
    ),
  ];
  return csvDocument(rows);
}

// ----------------------------------------------------------------------------------------------- polizze per immobile

export type PoliciesCsvLabels = { status: (code: string) => string; policyState: (code: string) => string };

export function policiesByAssetCsv(data: PoliciesByAsset, today: string, labels: PoliciesCsvLabels): string {
  const header: CsvCell[] = ["Immobile", "Situazione", "Polizza", "Compagnia", "Numero", "Dal", "Al", "Stato", "Premio annuo (€)", "Sinistri aperti", "Garanzie copiate dal contratto"];
  const coverages = (p: PoliciesByAsset["withoutAsset"][number]) => p.coverages.map((c) => [c.title, c.sumInsuredCents !== null ? `somma assicurata ${euros(c.sumInsuredCents)} €` : null, c.deductibleCents !== null ? `franchigia ${euros(c.deductibleCents)} €` : null].filter(Boolean).join(", ")).join(" / ");
  const policyRow = (p: PoliciesByAsset["withoutAsset"][number]): CsvCell[] => [p.title, p.insurerName ?? "", p.policyNumber ?? "", dateCell(p.startsOn), dateCell(p.endsOn), labels.policyState(p.state), euros(p.premiumCents), p.openClaims, coverages(p)];
  const rows: CsvCell[][] = [
    ["Polizze per immobile"],
    [`Preparato il ${dateCell(today)} con le polizze registrate dal proprietario. Il confronto riguarda solo ciò che è stato inserito: non legge le condizioni di polizza e non dice se un bene sia coperto.`],
    ...section(
      "Immobili e polizze collegate",
      header,
      data.rows.flatMap((r): CsvCell[][] => (r.policies.length === 0 ? [[r.assetName, labels.status(r.status), "", "", "", "", "", "", "", "", ""]] : r.policies.map((p): CsvCell[] => [r.assetName, labels.status(r.status), ...policyRow(p)]))),
    ),
    ...section("Polizze registrate senza immobile collegato", header.slice(2), data.withoutAsset.map(policyRow)),
  ];
  return csvDocument(rows);
}

// ----------------------------------------------------------------------------------------------- scheda per il notaio

export type NotaryCsvLabels = {
  kind: (code: string) => string;
  use: (code: string) => string;
  right: (code: string) => string;
  docStatus: (code: string) => string;
  provenanceKind: (code: string) => string;
  encumbranceKind: (code: string) => string;
  /** Il testo di una segnalazione di dato non risultante. */
  gap: (gap: NotarySheet["gaps"][number]) => string;
};

export function notarySheetCsv(sheet: NotarySheet, labels: NotaryCsvLabels, options: { withheldDocuments?: number } = {}): string {
  const a = sheet.asset;
  const rows: CsvCell[][] = [
    [`Scheda dell'immobile per il notaio: ${a.name}`],
    [`Preparata il ${dateCell(sheet.today)} con i dati registrati nell'app. Non dice se un atto sia possibile né se il bene sia regolare: elenca ciò che risulta e ciò che non risulta.`],
    ...section("Dati che non risultano", ["Segnalazione"], sheet.gaps.map((g): CsvCell[] => [labels.gap(g)])),
    ...section(
      "Bene",
      ["Campo", "Valore"],
      [
        ["Denominazione", a.name],
        ["Tipo", labels.kind(a.kind)],
        ["Uso", a.useType ? labels.use(a.useType) : ""],
        ["Comune", a.territoryLabel],
        ["Indirizzo", [a.address, a.postalCode, a.locality].filter(Boolean).join(" – ")],
        ["In condominio", yesNo(a.inCondominium)],
        ["Note", a.notes],
      ],
    ),
    ...section(
      "Titolarità registrata",
      ["Titolare", "Codice fiscale", "Indirizzo", "PEC", "Diritto", "Quota", "In corso", "Dal", "Al", "Note (provenienza)"],
      sheet.holders.map((h): CsvCell[] => [h.holder.displayName, h.party?.taxCode ?? "", h.party?.address ?? "", h.party?.pec ?? "", labels.right(h.rightType), `${h.quotaNumerator}/${h.quotaDenominator}`, yesNo(h.current), dateCell(h.validFrom), dateCell(h.validTo), h.notes]),
    ),
    ...section(
      "Somma delle quote in corso",
      ["Diritto", "Somma", "Quota intera"],
      sheet.quotaTotals.map((q): CsvCell[] => [labels.right(q.rightType), `${q.numerator}/${q.denominator}`, yesNo(q.whole)]),
    ),
    ...section(
      "Dati catastali",
      ["Foglio", "Particella", "Subalterno", "Categoria", "Classe", "Consistenza", "Rendita (€)", "Dal", "Al", "In corso"],
      [...sheet.cadastralCurrent.map((c) => ({ c, current: true })), ...sheet.cadastralHistory.map((c) => ({ c, current: false }))].map(({ c, current }): CsvCell[] => [c.sheet, c.parcel, c.subunit, c.cadastralCategory, c.cadastralClass, c.consistency, euros(c.incomeCents), dateCell(c.validFrom), dateCell(c.validTo), yesNo(current)]),
    ),
    ...section(
      "Documenti per categoria",
      ["Categoria", "Titolo", "Verifica", "Emesso il", "Valido fino al", "Validità passata alla data della scheda"],
      sheet.documentGroups.flatMap((g) => g.documents.map((d): CsvCell[] => [g.category.name, d.title, labels.docStatus(d.verificationStatus), dateCell(d.issuedOn), dateCell(d.validTo), yesNo(d.expired)])),
    ),
    ...(options.withheldDocuments && options.withheldDocuments > 0 ? [[`${options.withheldDocuments} documenti non sono elencati perché più riservati del livello scelto per questa scheda.`] as CsvCell[]] : []),
    ...section(
      "Provenienza registrata",
      ["Titolo", "Data", "Da", "Notaio", "Estremi dell'atto", "Documento", "Note"],
      sheet.provenances.map((p): CsvCell[] => [labels.provenanceKind(p.kind), dateCell(p.occurredOn), p.fromName, p.notaryName, p.deedReference, p.documentTitle, p.note]),
    ),
    ...section(
      "Ipoteche e vincoli registrati",
      ["Natura", "Titolo", "Registrato il", "Terminato il", "A favore di", "Importo (€)", "Estremi", "Documento", "Note"],
      sheet.encumbranceRecords.map((e): CsvCell[] => [labels.encumbranceKind(e.kind), e.title, dateCell(e.registeredOn), dateCell(e.endedOn), e.beneficiaryName, euros(e.amountCents), e.reference, e.documentTitle, e.note]),
    ),
    ...section(
      "Titoli che nominano un gravame e non sono collegati a un gravame registrato",
      ["Titolo", "Dove"],
      sheet.encumbrances.map((e): CsvCell[] => [e.title, e.source === "document" ? "Documento" : "Dossier"]),
    ),
    ...section("Voci del dossier da raccogliere o rivedere", ["Categoria", "Voce", "Stato", "Documenti collegati"], sheet.dossierOpen.map((i): CsvCell[] => [i.categoryName, i.title, i.status, i.documentCount])),
    ...section(
      "Immobili collegati (pertinenze)",
      ["Immobile", "Tipo", "Collegamento", "Titolarità registrate", "Dati catastali in corso"],
      sheet.related.map((r): CsvCell[] => [r.name, labels.kind(r.kind), r.declaredBasis ?? "", r.rightsCount, r.currentCadastralCount]),
    ),
  ];
  return csvDocument(rows);
}

// ----------------------------------------------------------------------------------------------- scheda per l'agente

type AgentSheet = NonNullable<Awaited<ReturnType<typeof getAgentSheet>>>;

export type AgentCsvLabels = {
  kind: (code: string) => string;
  use: (code: string) => string;
  right: (code: string) => string;
  docStatus: (code: string) => string;
  workStatus: (code: string) => string;
  lettingType: (code: string) => string;
  lettingStatus: (code: string) => string;
  level: (code: string) => string;
  checklist: (item: AgentSheet["documents"]["checklist"][number]) => string;
};

/** I nomi dei titolari compaiono solo se la scheda li include; quelli degli inquilini non compaiono mai. */
export function agentSheetCsv(sheet: AgentSheet, labels: AgentCsvLabels): string {
  const a = sheet.asset;
  const rows: CsvCell[][] = [
    [`Scheda per l'agente immobiliare: ${a.name}`],
    [`Preparata il ${dateCell(sheet.today)} con i dati registrati nell'app. Non contiene stime di valore né giudizi di conformità. Livello massimo di riservatezza dei documenti elencati: ${labels.level(sheet.cap)}.`],
    ...section(
      "Identificazione",
      ["Campo", "Valore"],
      [
        ["Tipo", labels.kind(a.kind)],
        ["Uso", a.useType ? labels.use(a.useType) : ""],
        ["Comune", a.territoryLabel],
        ["Località", a.locality],
        ["Indirizzo", [a.address, a.postalCode].filter(Boolean).join(" – ")],
        ["Note", a.notes],
      ],
    ),
    ...section("Caratteristiche", ["Nome", "Valore"], Object.entries(a.attributes).map(([k, v]): CsvCell[] => [k, typeof v === "boolean" ? yesNo(v) : v])),
    ...section(
      "Dati catastali",
      ["Foglio", "Particella", "Subalterno", "Categoria", "Classe", "Consistenza", "Rendita (€)", "Dal", "Al"],
      a.cadastral.map((c): CsvCell[] => [c.sheet, c.parcel, c.subunit, c.cadastralCategory, c.cadastralClass, c.consistency, euros(c.incomeCents), dateCell(c.validFrom), dateCell(c.validTo)]),
    ),
    ...(sheet.rightsHidden || a.rights.length > 0
      ? section(
          "Titolari",
          ["Titolare", "Diritto", "Quota", "Dal", "Al"],
          sheet.rightsHidden ? [["I nomi dei titolari non sono inclusi in questa scheda", "", "", "", ""]] : a.rights.map((r): CsvCell[] => [r.holder.displayName, labels.right(r.rightType), `${r.quotaNumerator}/${r.quotaDenominator}`, dateCell(r.validFrom), dateCell(r.validTo)]),
        )
      : []),
    ...section(
      "Condominio",
      ["Condominio", "Unità", "Amministratore"],
      sheet.condominium ? [[sheet.condominium.name, sheet.condominium.unitLabel, sheet.condominium.administratorName]] : [],
    ),
    ...section(
      "Spese ordinarie registrate (rate intestate all'immobile, come registrate: non sono le cifre dell'amministratore)",
      ["Esercizio", "Preventivo", "Dovuto (€)", "Pagato (€)"],
      (sheet.condominium?.expenses ?? []).map((e): CsvCell[] => [e.yearLabel, e.title, euros(e.dueCents), euros(e.paidCents)]),
    ),
    ...section(
      "Interventi recenti",
      ["Data", "Intervento", "Stato", "Fornitore"],
      sheet.works.map((w): CsvCell[] => [dateCell(w.referenceOn), w.title, labels.workStatus(w.status), w.supplierName]),
    ),
    ...section(
      "Locazioni",
      ["Locazione", "Tipo", "Stato", "Periodo", "Canone mensile (€)"],
      sheet.lettings.map((l): CsvCell[] => [l.title, labels.lettingType(l.type), labels.lettingStatus(l.status), period(l.startsOn, l.endsOn), euros(l.monthlyRentCents)]),
    ),
    ...section(
      "Documenti (solo entro il livello di riservatezza scelto)",
      ["Categoria", "Titolo", "Emesso il", "Valido fino al", "Verifica"],
      sheet.documents.groups.flatMap((g) => g.documents.map((d): CsvCell[] => [g.category.name, d.title, dateCell(d.issuedOn), dateCell(d.validTo), labels.docStatus(d.verificationStatus)])),
    ),
    ...(sheet.documents.withheldTotal > 0 ? [[`${sheet.documents.withheldTotal} documenti non sono elencati perché più riservati del livello scelto.`] as CsvCell[]] : []),
    ...section("Da preparare prima di consegnare", ["Voce"], sheet.documents.checklist.map((c): CsvCell[] => [labels.checklist(c)])),
  ];
  return csvDocument(rows);
}
