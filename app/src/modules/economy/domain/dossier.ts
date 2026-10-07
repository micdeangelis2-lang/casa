/**
 * Dossier annuale per il commercialista: regole PURE per scegliere cosa riportare e cosa segnalare come «dato mancante».
 * Nessuna aliquota, nessun calcolo di imposta, nessuna indicazione di deducibilita': riepiloga cio' che il proprietario ha
 * registrato e dice solo cosa NON e' stato registrato (una prova di pagamento, una quota, un dato catastale...).
 */
import type { LedgerEntry } from "./economy";

export const GAP_KINDS = [
  "asset_no_rights",
  "asset_no_cadastral",
  "payment_no_proof",
  "rent_not_collected",
  "premium_not_paid",
  "letting_no_registration",
  "letting_no_contract_document",
  "tax_no_payment",
  "tax_no_expected",
  "return_not_filed",
] as const;
export type GapKind = (typeof GAP_KINDS)[number];

/** Una segnalazione: cosa manca nei dati, dove si corregge e (se c'e') la data e l'importo di riferimento. */
export type DossierGap = {
  kind: GapKind;
  /** Il nome della voce a cui si riferisce (immobile, tributo, locazione, movimento). */
  subject: string;
  assetName: string | null;
  date: string | null;
  amountCents: number | null;
  href: string;
};

export type ProofState = "present" | "missing" | "notTracked";

/** La prova di un movimento: collegata, non collegata, oppure il modulo di origine non ha un campo per la prova. */
export const proofState = (entry: Pick<LedgerEntry, "documentId">): ProofState => (entry.documentId === undefined ? "notTracked" : entry.documentId ? "present" : "missing");

/** Un periodo di validita' (con estremi facoltativi) tocca l'anno? Un estremo assente vale «senza limite». */
export function overlapsYear(validFrom: string | null, validTo: string | null, year: number): boolean {
  return (validFrom === null || validFrom <= `${year}-12-31`) && (validTo === null || validTo >= `${year}-01-01`);
}

/** Dove sta la scheda di origine di un movimento. */
export const AREA_HREF = { taxes: "/tributi", insurance: "/assicurazioni", maintenance: "/manutenzioni", condominium: "/condominio", lettings: "/locazioni" } as const;

/** Ordine stabile delle segnalazioni: per genere (come in GAP_KINDS), poi per immobile e riferimento. */
export function sortGaps(gaps: DossierGap[]): DossierGap[] {
  const order = new Map<GapKind, number>(GAP_KINDS.map((k, i) => [k, i]));
  return [...gaps].sort((a, b) => order.get(a.kind)! - order.get(b.kind)! || (a.assetName ?? "").localeCompare(b.assetName ?? "", "it") || a.subject.localeCompare(b.subject, "it") || (a.date ?? "").localeCompare(b.date ?? ""));
}
