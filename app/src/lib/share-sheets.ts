import { getTranslations } from "next-intl/server";
import type { Db } from "@/platform/db/types";
import { todayInItaly } from "@/platform/clock";
import { getAgentSheet, type Level } from "@/modules/agent";
import { listDocuments } from "@/modules/documents";
import { dossierCsv, getDossier } from "@/modules/economy";
import { policiesByAsset } from "@/modules/insurance";
import { getManagementStatement, statementCsv } from "@/modules/management";
import { timelineCsv } from "@/modules/matters";
import { getNotarySheet, type NotarySheet } from "@/modules/notary";
import { CONFIDENTIALITY_LEVELS, SHEET_KINDS, type SheetKind } from "@/modules/sharing";
import { briefCsv, getTechnicalBrief, type TechnicalBrief } from "@/modules/technical";
import { csvLabels, loadMatterDossier } from "@/lib/matter-dossier";
import { agentSheetCsv, notarySheetCsv, policiesByAssetCsv } from "@/lib/sheet-csv";
import { isCalendarDate } from "@/shared/dates";
import { z } from "@/shared/zod";

/**
 * Le «schede» che si possono includere in un pacchetto di condivisione e scaricare in CSV: ciascuna e' il CSV gia' offerto
 * dall'app per quella vista (stesse letture dei moduli delle pagine), eventualmente limitato dal tetto di riservatezza.
 * Qui si compongono lettura, testi italiani e filtro di riservatezza; la pagina HTML nasce dal CSV (`modules/sharing`).
 */

const aboveCap = (level: string, cap: Level) => CONFIDENTIALITY_LEVELS.indexOf(level as Level) > CONFIDENTIALITY_LEVELS.indexOf(cap);

/** Cio' che l'utente sceglie per una scheda; si valida sul server (arriva dal modulo di creazione del pacchetto). */
export const sheetSpecSchema = z.object({
  kind: z.enum(SHEET_KINDS),
  assetId: z.uuid().optional(),
  year: z.coerce.number().int().min(1990).max(2100).optional(),
  from: z.string().refine(isCalendarDate).optional(),
  to: z.string().refine(isCalendarDate).optional(),
  matterId: z.uuid().optional(),
  categoryIds: z.array(z.uuid()).max(50).optional(),
  includeRights: z.boolean().optional(),
  /** Solo per il dossier del consulente: aggiunge al pacchetto i documenti di prova dei movimenti dell'anno (entro il tetto). */
  includeProofs: z.boolean().optional(),
});
export type SheetSpec = z.infer<typeof sheetSpecSchema>;

export type LoadedSheet = {
  kind: SheetKind;
  title: string;
  csv: string;
  /** Documenti che il movimento indica come prova (solo per il dossier del consulente), da proporre nel pacchetto. */
  proofDocumentIds: string[];
};

/** Documenti ammessi dal tetto: id consentiti e titoli di quelli esclusi (per toglierli anche dai testi). */
async function visibility(db: Db, assetId: string | undefined, cap: Level | null) {
  const all = await listDocuments(db, assetId ? { assetId } : {});
  const allowed = new Set(all.filter((d) => cap === null || !aboveCap(d.confidentiality, cap)).map((d) => d.id));
  return { allowed, withheld: all.filter((d) => !allowed.has(d.id)) };
}

// ------------------------------------------------------------------------------------------------ etichette

export async function technicalCsvLabels() {
  const ta = await getTranslations({ locale: "it", namespace: "assets" });
  const tdoc = await getTranslations({ locale: "it", namespace: "documents" });
  const tdos = await getTranslations({ locale: "it", namespace: "dossier" });
  const tm = await getTranslations({ locale: "it", namespace: "maintenance" });
  const tmatter = await getTranslations({ locale: "it", namespace: "matters" });
  return {
    kind: (c: string) => ta(`kind.${c as "dwelling"}`),
    use: (c: string) => ta(`use.${c as "let"}`),
    right: (c: string) => ta(`right.${c as "full"}`),
    workStatus: (c: string) => tm(`status.${c as "planned"}`),
    matterStatus: (c: string) => tmatter(`status.${c as "open"}`),
    dossierStatus: (c: string) => tdos(`status.${c as "missing"}`),
    verification: (c: string) => tdoc(`status.${c as "draft"}`),
    warrantyState: (c: string) => tm(`warranties.state.${c as "active"}`),
  };
}

export const statementCsvLabels = {
  title: "Rendiconto di gestione",
  note: "Cio' che risulta dai dati registrati: non valuta la gestione ne' la sua correttezza.",
  area: { taxes: "Tributi", insurance: "Assicurazioni", maintenance: "Manutenzioni", condominium: "Condominio", lettings: "Locazioni (incassi)" },
  state: { paid: "Incassato", partial: "Parziale", overdue: "Non incassato, data superata", due: "Da incassare" },
  stage: { requested: "Richiesto", approved: "Approvato o in corso", executed: "Eseguito", cancelled: "Annullato" },
};

export async function notaryCsvLabels() {
  const ta = await getTranslations({ locale: "it", namespace: "assets" });
  const tn = await getTranslations({ locale: "it", namespace: "notaio" });
  const tdoc = await getTranslations({ locale: "it", namespace: "documents" });
  return {
    kind: (c: string) => ta(`kind.${c as "dwelling"}`),
    use: (c: string) => ta(`use.${c as "let"}`),
    right: (c: string) => ta(`right.${c as "full"}`),
    docStatus: (c: string) => tdoc(`status.${c as "draft"}`),
    provenanceKind: (c: string) => tn(`provenance.kind.${c as "purchase"}`),
    encumbranceKind: (c: string) => tn(`encumbrances.kind.${c as "mortgage"}`),
    gap: (gap: NotarySheet["gaps"][number]) => {
      const params: Record<string, string | number> = { ...gap.params };
      if (typeof params.fields === "string") params.fields = params.fields.split(",").map((f) => tn(`gaps.field.${f as "taxCode"}`)).join(", ");
      if (typeof params.rightType === "string") params.rightType = ta(`right.${params.rightType as "full"}`);
      return tn(`gaps.${gap.code}`, params as never);
    },
  };
}

export async function agentCsvLabels() {
  const ta = await getTranslations({ locale: "it", namespace: "assets" });
  const t = await getTranslations({ locale: "it", namespace: "agente" });
  const tdoc = await getTranslations({ locale: "it", namespace: "documents" });
  const tdo = await getTranslations({ locale: "it", namespace: "dossier" });
  const tl = await getTranslations({ locale: "it", namespace: "lettings" });
  const tm = await getTranslations({ locale: "it", namespace: "maintenance" });
  const ts = await getTranslations({ locale: "it", namespace: "sharing" });
  const dateIt = (d: string) => d.split("-").reverse().join("/");
  return {
    kind: (c: string) => ta(`kind.${c as "dwelling"}`),
    use: (c: string) => ta(`use.${c as "let"}`),
    right: (c: string) => ta(`right.${c as "full"}`),
    docStatus: (c: string) => tdoc(`status.${c as "draft"}`),
    workStatus: (c: string) => tm(`status.${c as "planned"}`),
    lettingType: (c: string) => tl(`types.${c as "residential"}`),
    lettingStatus: (c: string) => tl(`status.${c as "active"}`),
    level: (c: string) => ts(`confidentiality.${c as "ordinary"}`),
    checklist: (c: { kind: string } & Record<string, unknown>) => {
      if (c.kind === "category_empty") return t("checklist.category_empty", { name: String(c.categoryName) });
      if (c.kind === "category_withheld") return t("checklist.category_withheld", { name: String(c.categoryName), count: Number(c.count) });
      if (c.kind === "document_expired") return t("checklist.document_expired", { title: String(c.title), date: dateIt(String(c.validTo)) });
      return t("checklist.dossier_open", { title: String(c.title), status: tdo(`status.${String(c.status) as "missing"}`) });
    },
  };
}

export async function insurerCsvLabels() {
  const t = await getTranslations({ locale: "it", namespace: "assicuratore.byAsset" });
  const ti = await getTranslations({ locale: "it", namespace: "insurance" });
  return { status: (c: string) => t(`status.${c as "none"}`), policyState: (c: string) => ti(`state.${c as "active"}`) };
}

// ------------------------------------------------------------------------------------------------ riservatezza

/** Toglie dalla scheda per il notaio i documenti oltre il tetto (e i loro titoli dai gravami e dalle provenienze); ne restituisce il numero. */
export function limitNotarySheet(sheet: NotarySheet, allowed: Set<string>): { sheet: NotarySheet; withheld: number } {
  let withheld = 0;
  const documentGroups = sheet.documentGroups.map((g) => {
    const documents = g.documents.filter((d) => allowed.has(d.id));
    withheld += g.documents.length - documents.length;
    return { ...g, documents };
  });
  const all = documentGroups.flatMap((g) => g.documents);
  const unlink = <R extends { documentId: string | null; documentTitle: string | null }>(r: R): R => (r.documentId && !allowed.has(r.documentId) ? { ...r, documentId: null, documentTitle: null } : r);
  return {
    withheld,
    sheet: {
      ...sheet,
      documentGroups,
      documentTotals: { total: all.length, unverified: all.filter((d) => d.unverified).length, expired: all.filter((d) => d.expired).length },
      provenances: sheet.provenances.map(unlink),
      encumbranceRecords: sheet.encumbranceRecords.map(unlink),
      encumbrances: sheet.encumbrances.filter((e) => e.source !== "document" || (e.id !== null && allowed.has(e.id))),
    },
  };
}

/** Toglie dalla scheda per il tecnico i documenti oltre il tetto. */
export function limitBrief(brief: TechnicalBrief, allowed: Set<string>): TechnicalBrief {
  return { ...brief, documents: { ...brief.documents, groups: brief.documents.groups.map((g) => ({ ...g, documents: g.documents.filter((d) => allowed.has(d.id)) })) } };
}

// ------------------------------------------------------------------------------------------------ caricamento

/** CSV della scheda per il notaio (la pagina non ha tetto: `cap` nullo). */
export async function loadNotaryCsv(db: Db, assetId: string, options: { focusCategoryIds?: string[]; cap?: Level | null } = {}): Promise<LoadedSheet | null> {
  const sheet = await getNotarySheet(db, assetId, { focusCategoryIds: options.focusCategoryIds });
  if (!sheet) return null;
  const limited = options.cap ? limitNotarySheet(sheet, (await visibility(db, assetId, options.cap)).allowed) : { sheet, withheld: 0 };
  return { kind: "notary", title: `Scheda per il notaio: ${sheet.asset.name}`, csv: notarySheetCsv(limited.sheet, await notaryCsvLabels(), { withheldDocuments: limited.withheld }), proofDocumentIds: [] };
}

export async function loadAgentCsv(db: Db, assetId: string, options: { cap?: Level; focusCategoryIds?: string[]; includeRights?: boolean } = {}): Promise<LoadedSheet | null> {
  const sheet = await getAgentSheet(db, assetId, { cap: options.cap ?? "ordinary", focusCategoryIds: options.focusCategoryIds && options.focusCategoryIds.length > 0 ? options.focusCategoryIds : null, includeRights: options.includeRights === true });
  if (!sheet) return null;
  return { kind: "agent", title: `Scheda per l'agente immobiliare: ${sheet.asset.name}`, csv: agentSheetCsv(sheet, await agentCsvLabels()), proofDocumentIds: [] };
}

export async function loadPoliciesCsv(db: Db, assetId?: string): Promise<LoadedSheet> {
  const data = await policiesByAsset(db);
  const scoped = assetId ? { rows: data.rows.filter((r) => r.assetId === assetId), withoutAsset: [] } : data;
  return { kind: "insurer", title: "Polizze per immobile", csv: policiesByAssetCsv(scoped, todayInItaly(), await insurerCsvLabels()), proofDocumentIds: [] };
}

export async function loadTechnicalCsv(db: Db, assetId: string, cap: Level | null = null): Promise<(LoadedSheet & { today: string }) | null> {
  const brief = await getTechnicalBrief(db, assetId);
  if (!brief) return null;
  const shown = cap ? limitBrief(brief, (await visibility(db, assetId, cap)).allowed) : brief;
  return { kind: "technical", title: `Scheda per il tecnico: ${brief.asset.name}`, csv: briefCsv(shown, await technicalCsvLabels()), proofDocumentIds: [], today: brief.today };
}

export async function loadStatementCsv(db: Db, args: { assetId: string; from: string; to: string }): Promise<LoadedSheet | null> {
  const statement = await getManagementStatement(db, args);
  if (!statement.assetName) return null;
  return { kind: "manager", title: `Rendiconto di gestione: ${statement.assetName}`, csv: statementCsv(statement, statementCsvLabels), proofDocumentIds: [] };
}

export async function loadAccountantCsv(db: Db, year: number): Promise<LoadedSheet> {
  const dossier = await getDossier(db, year);
  const proofs = [...new Set(dossier.movements.flatMap((m) => (m.documentId ? [m.documentId] : [])))];
  return { kind: "accountant", title: `Dossier annuale per il commercialista ${year}`, csv: dossierCsv(dossier), proofDocumentIds: proofs };
}

/** Cronologia della pratica: i documenti oltre il tetto non compaiono come fatti e i loro titoli si tolgono dai dettagli. */
export async function loadMatterCsv(db: Db, matterId: string, cap: Level | null = null): Promise<LoadedSheet | null> {
  const t = await getTranslations({ locale: "it", namespace: "avvocato" });
  const tr = (key: string, values?: Record<string, string | number>) => t(key as never, values as never);
  const dossier = await loadMatterDossier(db, matterId, tr);
  if (!dossier) return null;
  let timeline = dossier.timeline;
  if (cap) {
    const withheld = dossier.documents.filter((d) => aboveCap(d.confidentiality, cap));
    const ids = new Set(withheld.map((d) => d.id));
    const scrub = (text: string | null) => (text === null ? null : withheld.reduce((acc, d) => acc.split(d.title).join("(documento non incluso)"), text));
    const keep = <E extends { kind: string; href: string | null; title: string; detail: string | null }>(events: E[]) =>
      events.filter((e) => !(e.kind === "document" && e.href && ids.has(e.href.replace("/documenti/", "")))).map((e) => ({ ...e, title: scrub(e.title) ?? e.title, detail: scrub(e.detail) }));
    timeline = { dated: keep(timeline.dated), undated: keep(timeline.undated) };
  }
  return { kind: "lawyer", title: `Cronologia della pratica: ${dossier.matter.title}`, csv: timelineCsv(timeline, csvLabels(tr)), proofDocumentIds: [] };
}

/** La scheda scelta per un pacchetto, o null se i dati indicati non esistono (immobile, pratica) o mancano (anno, periodo). */
export async function loadSheet(db: Db, spec: SheetSpec, cap: Level): Promise<LoadedSheet | null> {
  const today = todayInItaly();
  switch (spec.kind) {
    case "notary":
      return spec.assetId ? loadNotaryCsv(db, spec.assetId, { focusCategoryIds: spec.categoryIds, cap }) : null;
    case "agent":
      return spec.assetId ? loadAgentCsv(db, spec.assetId, { cap, focusCategoryIds: spec.categoryIds, includeRights: spec.includeRights }) : null;
    case "technical":
      return spec.assetId ? loadTechnicalCsv(db, spec.assetId, cap) : null;
    case "insurer":
      return loadPoliciesCsv(db, spec.assetId);
    case "accountant":
      return spec.year ? loadAccountantCsv(db, spec.year) : null;
    case "manager": {
      if (!spec.assetId) return null;
      const from = spec.from ?? `${today.slice(0, 4)}-01-01`;
      const to = spec.to ?? today;
      return loadStatementCsv(db, from <= to ? { assetId: spec.assetId, from, to } : { assetId: spec.assetId, from: `${today.slice(0, 4)}-01-01`, to: today });
    }
    case "lawyer":
      return spec.matterId ? loadMatterCsv(db, spec.matterId, cap) : null;
  }
}

/** Documenti di prova che si possono proporre nel pacchetto: quelli entro il tetto scelto (gli altri restano fuori). */
export async function proofDocumentsWithinCap(db: Db, ids: string[], cap: Level): Promise<string[]> {
  if (ids.length === 0) return [];
  const { allowed } = await visibility(db, undefined, cap);
  return ids.filter((id) => allowed.has(id));
}
