/**
 * «Scheda dell'immobile per il notaio»: raccoglie, da cio' che il proprietario ha GIA' registrato, i dati che un notaio
 * chiede di solito (titolarita' con quote, catasto a storico, documenti per categoria, pertinenze collegate, ipoteche e
 * vincoli solo se registrati) e segnala cio' che non risulta. Non dice se un atto sia possibile ne' se il bene sia regolare:
 * elenca fatti e lacune dei dati. Calcolo puro, provato senza database.
 */

/** Codice (dato seminato) della categoria documentale dei titoli di proprieta'. Se la categoria non c'e', il controllo si salta. */
export const TITLE_CATEGORY_CODE = "title_deed";
/** Categorie documentali mostrate per prime nella scheda (codici dei dati seminati); il proprietario puo' sceglierne altre. */
export const DEFAULT_FOCUS_CATEGORY_CODES = ["title_deed", "cadastral", "building", "energy", "systems", "condominium"] as const;

/**
 * Parole cercate nei titoli di documenti e voci del dossier per ritrovare cio' che l'utente ha scritto su ipoteche e vincoli:
 * RIPIEGO per cio' che non e' registrato come gravame (`asset_encumbrance`); i gravami registrati hanno la precedenza.
 */
export const ENCUMBRANCE_TERMS = ["ipotec", "vincol", "servitu", "prelazion", "pignorament", "sequestr", "diritto di abitazione"] as const;

const DOSSIER_OPEN_STATUSES = ["missing", "requested", "to_verify", "expired"] as const;

export type SheetRight = {
  holder: { id: string; displayName: string };
  rightType: string;
  quotaNumerator: number;
  quotaDenominator: number;
  validFrom: string | null;
  validTo: string | null;
  notes: string | null;
};

export type SheetCadastral = {
  sheet: string | null;
  parcel: string | null;
  subunit: string | null;
  cadastralCategory: string | null;
  cadastralClass: string | null;
  consistency: string | null;
  incomeCents: number | null;
  validFrom: string | null;
  validTo: string | null;
  notes: string | null;
};

export type SheetAssetInput = {
  id: string;
  kind: string;
  name: string;
  territoryLabel: string;
  locality: string | null;
  address: string | null;
  postalCode: string | null;
  useType: string | null;
  inCondominium: boolean;
  notes: string | null;
  rights: SheetRight[];
  cadastral: SheetCadastral[];
  attributes: Record<string, string | number | boolean>;
};

export type SheetParty = { id: string; displayName: string; taxCode: string | null; address: string | null; pec: string | null; email: string | null; phone: string | null };

export type SheetDocument = {
  id: string;
  title: string;
  categoryId: string;
  issuedOn: string | null;
  validTo: string | null;
  verificationStatus: string;
};

/** Titolo di provenienza registrato dal proprietario. */
export type SheetProvenance = {
  id: string;
  kind: string;
  occurredOn: string | null;
  fromName: string | null;
  notaryName: string | null;
  deedReference: string | null;
  documentId: string | null;
  documentTitle: string | null;
  note: string | null;
};

/** Gravame o vincolo registrato dal proprietario. */
export type SheetEncumbranceRecord = {
  id: string;
  kind: string;
  title: string;
  registeredOn: string | null;
  endedOn: string | null;
  beneficiaryName: string | null;
  amountCents: number | null;
  reference: string | null;
  documentId: string | null;
  documentTitle: string | null;
  note: string | null;
};

export type SheetCategory = { id: string; code: string; name: string };

export type SheetDossierItem = { title: string; categoryName: string; status: string; documentCount: number };

export type SheetRelatedInput = {
  id: string;
  name: string;
  kind: string;
  /** `linkedTo`: questo bene dichiara il collegamento; `linkedFrom`: e' l'altro bene a dichiararlo. */
  direction: "linkedTo" | "linkedFrom";
  declaredBasis: string | null;
  validationStatus: string;
  rightsCount: number;
  currentCadastralCount: number;
};

export type SheetInput = {
  today: string;
  asset: SheetAssetInput;
  parties: SheetParty[];
  documents: SheetDocument[];
  categories: SheetCategory[];
  /** Categorie su cui il proprietario vuole il controllo; vuoto = quelle di `DEFAULT_FOCUS_CATEGORY_CODES`. */
  focusCategoryIds?: string[];
  dossierItems: SheetDossierItem[];
  related: SheetRelatedInput[];
  /** Provenienza e gravami registrati come dati (assenti: nessuno registrato). */
  provenances?: SheetProvenance[];
  encumbranceRecords?: SheetEncumbranceRecord[];
};

export type GapCode =
  | "noAddress"
  | "noRights"
  | "noCurrentRights"
  | "quotaPartial"
  | "holderDataMissing"
  | "provenanceNotRegistered"
  | "provenanceNoDocument"
  | "encumbranceNoDocument"
  | "noCadastral"
  | "noCurrentCadastral"
  | "cadastralIncomplete"
  | "categoryEmpty"
  | "documentsToVerify"
  | "documentsExpired"
  | "dossierOpen"
  | "relatedNoRights"
  | "relatedNoCadastral";

export type Gap = { code: GapCode; params: Record<string, string | number> };

export type SheetHolder = SheetRight & { party: SheetParty | null; current: boolean };
export type QuotaTotal = { rightType: string; numerator: number; denominator: number; whole: boolean };

export type SheetDocumentGroup = {
  category: SheetCategory;
  focus: boolean;
  documents: (SheetDocument & { expired: boolean; unverified: boolean })[];
};

export type EncumbranceMention = { source: "document" | "dossier"; title: string; id: string | null; detail: string };

export type NotarySheet = {
  today: string;
  asset: SheetAssetInput;
  holders: SheetHolder[];
  quotaTotals: QuotaTotal[];
  cadastralCurrent: SheetCadastral[];
  cadastralHistory: SheetCadastral[];
  documentGroups: SheetDocumentGroup[];
  documentTotals: { total: number; unverified: number; expired: number };
  /** Titoli di provenienza e gravami REGISTRATI dal proprietario. */
  provenances: SheetProvenance[];
  encumbranceRecords: SheetEncumbranceRecord[];
  /** Ripiego: titoli di documenti o voci del dossier che nominano un gravame e NON sono gia' collegati a un gravame o a una provenienza registrati. */
  encumbrances: EncumbranceMention[];
  dossierOpen: SheetDossierItem[];
  related: SheetRelatedInput[];
  gaps: Gap[];
};

const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b));

/** Somma esatta di quote (frazioni), ridotta ai minimi termini. */
export function sumQuotas(quotas: { quotaNumerator: number; quotaDenominator: number }[]): { numerator: number; denominator: number } {
  let num = 0n;
  let den = 1n;
  for (const q of quotas) {
    num = num * BigInt(q.quotaDenominator) + BigInt(q.quotaNumerator) * den;
    den *= BigInt(q.quotaDenominator);
    const g = gcd(num, den) || 1n;
    num /= g;
    den /= g;
  }
  return { numerator: Number(num), denominator: Number(den) };
}

const isCurrent = (validTo: string | null, today: string) => validTo === null || validTo >= today;

const normalize = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export const mentionsEncumbrance = (title: string): boolean => {
  const n = normalize(title);
  return ENCUMBRANCE_TERMS.some((term) => n.includes(term));
};

const byValidFromDesc = (a: { validFrom: string | null }, b: { validFrom: string | null }) => (b.validFrom ?? "").localeCompare(a.validFrom ?? "");

export function buildNotarySheet(input: SheetInput): NotarySheet {
  const { today, asset } = input;
  const gaps: Gap[] = [];
  const parties = new Map(input.parties.map((p) => [p.id, p]));

  if (!asset.address) gaps.push({ code: "noAddress", params: {} });

  // Titolarita': diritti in corso prima, poi quelli con data di fine.
  const holders: SheetHolder[] = asset.rights
    .map((r) => ({ ...r, party: parties.get(r.holder.id) ?? null, current: isCurrent(r.validTo, today) }))
    .sort((a, b) => Number(b.current) - Number(a.current) || a.rightType.localeCompare(b.rightType) || a.holder.displayName.localeCompare(b.holder.displayName, "it"));
  const currentHolders = holders.filter((h) => h.current);
  if (asset.rights.length === 0) gaps.push({ code: "noRights", params: {} });
  else if (currentHolders.length === 0) gaps.push({ code: "noCurrentRights", params: {} });

  const quotaTotals: QuotaTotal[] = [...new Set(currentHolders.map((h) => h.rightType))].map((rightType) => {
    const sum = sumQuotas(currentHolders.filter((h) => h.rightType === rightType));
    return { rightType, numerator: sum.numerator, denominator: sum.denominator, whole: sum.numerator === sum.denominator };
  });
  for (const total of quotaTotals) if (!total.whole) gaps.push({ code: "quotaPartial", params: { rightType: total.rightType, sum: `${total.numerator}/${total.denominator}` } });

  for (const holder of [...new Map(currentHolders.map((h) => [h.holder.id, h])).values()]) {
    const missing = [!holder.party?.taxCode ? "taxCode" : null, !holder.party?.address ? "address" : null].filter((m): m is string => m !== null);
    if (missing.length > 0) gaps.push({ code: "holderDataMissing", params: { name: holder.holder.displayName, fields: missing.join(",") } });
  }

  // Catasto: righe in corso e storico.
  const cadastralCurrent = asset.cadastral.filter((c) => isCurrent(c.validTo, today)).sort(byValidFromDesc);
  const cadastralHistory = asset.cadastral.filter((c) => !isCurrent(c.validTo, today)).sort(byValidFromDesc);
  if (asset.cadastral.length === 0) gaps.push({ code: "noCadastral", params: {} });
  else if (cadastralCurrent.length === 0) gaps.push({ code: "noCurrentCadastral", params: {} });
  for (const row of cadastralCurrent) {
    const missing = [!row.sheet ? "sheet" : null, !row.parcel ? "parcel" : null, !row.subunit ? "subunit" : null, !row.cadastralCategory ? "category" : null].filter((m): m is string => m !== null);
    if (missing.length > 0) gaps.push({ code: "cadastralIncomplete", params: { fields: missing.join(",") } });
  }

  // Documenti per categoria.
  const focusIds = new Set(
    input.focusCategoryIds && input.focusCategoryIds.length > 0
      ? input.focusCategoryIds
      : input.categories.filter((c) => (DEFAULT_FOCUS_CATEGORY_CODES as readonly string[]).includes(c.code)).map((c) => c.id),
  );
  const documentGroups: SheetDocumentGroup[] = input.categories
    .map((category) => ({
      category,
      focus: focusIds.has(category.id),
      documents: input.documents
        .filter((d) => d.categoryId === category.id)
        .map((d) => ({ ...d, expired: d.validTo !== null && d.validTo < today, unverified: d.verificationStatus === "draft" || d.verificationStatus === "to_verify" }))
        .sort((a, b) => a.title.localeCompare(b.title, "it")),
    }))
    // Prima le categorie scelte, poi quelle che hanno documenti; le altre vuote si omettono.
    .filter((g) => g.focus || g.documents.length > 0);
  const allDocs = documentGroups.flatMap((g) => g.documents);
  const documentTotals = { total: allDocs.length, unverified: allDocs.filter((d) => d.unverified).length, expired: allDocs.filter((d) => d.expired).length };
  for (const group of documentGroups) if (group.focus && group.documents.length === 0) gaps.push({ code: "categoryEmpty", params: { name: group.category.name } });
  if (documentTotals.unverified > 0) gaps.push({ code: "documentsToVerify", params: { count: documentTotals.unverified } });
  if (documentTotals.expired > 0) gaps.push({ code: "documentsExpired", params: { count: documentTotals.expired } });

  // Provenienza: non e' un campo a se' — compare nelle note dei diritti e nei documenti del titolo.
  const titleCategory = input.categories.find((c) => c.code === TITLE_CATEGORY_CODE);
  const hasTitleDocs = titleCategory ? input.documents.some((d) => d.categoryId === titleCategory.id) : false;
  const provenances = input.provenances ?? [];
  const encumbranceRecords = input.encumbranceRecords ?? [];
  if (titleCategory && !hasTitleDocs && !asset.rights.some((r) => r.notes) && provenances.length === 0) gaps.push({ code: "provenanceNotRegistered", params: {} });
  const provenanceNoDocument = provenances.filter((p) => p.documentId === null).length;
  if (provenanceNoDocument > 0) gaps.push({ code: "provenanceNoDocument", params: { count: provenanceNoDocument } });
  const encumbranceNoDocument = encumbranceRecords.filter((e) => e.documentId === null).length;
  if (encumbranceNoDocument > 0) gaps.push({ code: "encumbranceNoDocument", params: { count: encumbranceNoDocument } });

  // Ipoteche e vincoli: i gravami REGISTRATI hanno la precedenza; in piu' (ripiego) si segnalano i titoli di documenti o voci del
  // dossier che nominano un gravame, se non sono gia' il documento di un gravame o di una provenienza registrati.
  const registeredDocumentIds = new Set([...provenances, ...encumbranceRecords].flatMap((r) => (r.documentId ? [r.documentId] : [])));
  const encumbrances: EncumbranceMention[] = [
    ...input.documents.filter((d) => mentionsEncumbrance(d.title) && !registeredDocumentIds.has(d.id)).map((d) => ({ source: "document" as const, title: d.title, id: d.id, detail: d.verificationStatus })),
    ...input.dossierItems.filter((i) => mentionsEncumbrance(i.title)).map((i) => ({ source: "dossier" as const, title: i.title, id: null, detail: i.status })),
  ];

  const dossierOpen = input.dossierItems.filter((i) => (DOSSIER_OPEN_STATUSES as readonly string[]).includes(i.status));
  if (dossierOpen.length > 0) gaps.push({ code: "dossierOpen", params: { count: dossierOpen.length } });

  for (const rel of input.related) {
    if (rel.rightsCount === 0) gaps.push({ code: "relatedNoRights", params: { name: rel.name } });
    if (rel.currentCadastralCount === 0) gaps.push({ code: "relatedNoCadastral", params: { name: rel.name } });
  }

  return { today, asset, holders, quotaTotals, cadastralCurrent, cadastralHistory, documentGroups, documentTotals, provenances, encumbranceRecords, encumbrances, dossierOpen, related: input.related, gaps };
}

/** Indirizzo (relativo) della procedura di condivisione gia' impostata per il notaio: bene e pertinenze, categorie scelte, tetto «riservato». */
export function notaryPackageHref(args: { assetIds: string[]; categoryIds: string[]; contactId?: string | null }): string {
  const params = new URLSearchParams();
  params.set("destinatario", "notary");
  params.set("livello", "reserved");
  for (const id of args.assetIds) params.append("immobile", id);
  for (const id of args.categoryIds) params.append("categoria", id);
  if (args.contactId) params.set("contatto", args.contactId);
  params.set("mostra", "1");
  return `/condivisione/nuovo?${params.toString()}`;
}
