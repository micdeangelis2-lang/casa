import { z } from "@/shared/zod";

/**
 * Formato dell'archivio (backup ed esportazione completa): un file ZIP con
 *   manifest.json            descrizione, versione dello schema, righe e impronte per tabella
 *   data/<tabella>.ndjson    una riga JSON per record
 *   files/<chiave>           i file originali, con la stessa chiave che hanno nello storage
 *   LEGGIMI.txt              come leggerlo senza l'app
 * Il backup cifra l'intero ZIP; l'esportazione completa e' in chiaro e non contiene credenziali.
 */
export const ARCHIVE_FORMAT = "gestione-immobili-archive";
export const ARCHIVE_FORMAT_VERSION = 1;

/** Tabelle dell'applicazione nell'ordine in cui si possono reinserire (le chiavi esterne puntano sempre indietro). */
export const BUSINESS_TABLES = [
  "territory",
  "party",
  "asset",
  "ownership_right",
  "asset_link",
  "cadastral_record",
  "document_category",
  "file_object",
  "document",
  "document_version",
  "document_asset",
  "party_competence",
  "asset_provenance",
  "asset_encumbrance",
  "dossier_category",
  "rule",
  "rule_version",
  "dossier_item",
  "dossier_item_document",
  "holiday_rule",
  "matter",
  "deadline",
  "deadline_occurrence",
  "deadline_proof",
  "notification",
  "app_setting",
  "matter_assignment",
  "matter_document_request",
  "matter_event",
  "professional_opinion",
  "matter_document",
  "engagement",
  "matter_deliverable",
  "office_form_template",
  "share_package",
  "share_package_item",
  "share_log",
  "condominium",
  "condo_membership",
  "millesimal_table",
  "millesimal_share",
  "condo_unit_other",
  "condo_fiscal_year",
  "condo_budget",
  "condo_installment",
  "condo_meeting",
  "condo_agenda_item",
  "condo_agenda_document",
  "condo_proxy",
  "condo_resolution",
  "condo_work",
  "condo_work_entry",
  "condo_claim",
  "condo_contract",
  "condo_document",
  "tax_type",
  "tax_obligation",
  "tax_payment",
  "tax_return",
  "plant",
  "plant_document",
  "maint_work",
  "maint_quote",
  "maint_invoice",
  "maint_progress",
  "maint_warranty",
  "maint_inspection_plan",
  "ins_policy",
  "ins_policy_asset",
  "ins_coverage",
  "ins_premium",
  "ins_claim",
  "ins_claim_entry",
  "ins_claim_document",
  "letting",
  "letting_party",
  "letting_rent",
  "letting_rent_payment",
  "letting_code",
  "letting_report",
  "management_mandate",
  "listing_engagement",
  "listing_event",
  "audit_log",
] as const;

/**
 * Credenziali del proprietario (password, segreto TOTP, passkey). Solo nel backup cifrato: servono a ripristinare
 * l'accesso. Mai nell'esportazione completa, che e' in chiaro.
 */
export const AUTH_TABLES = ["user", "account", "passkey", "two_factor"] as const;

/**
 * Tabelle volutamente fuori dall'archivio, ognuna col suo motivo. Un test confronta questo elenco con lo schema
 * reale: una tabella nuova che non sta in nessuno dei tre elenchi fa fallire i test (cosi' non si dimentica nulla).
 */
export const EXCLUDED_TABLES = {
  session: "sessioni di accesso: dopo un ripristino si rifa' l'accesso",
  verification: "codici temporanei",
  rate_limit: "contatori dei limiti di frequenza",
  backup_run: "storico dei backup dell'ambiente corrente",
} as const;

/**
 * Tabelle che le migrazioni popolano da sole (dati di partenza). Un database appena migrato le ha gia' piene:
 * non contano come "dati" e, nel ripristino, si svuotano prima perche' vale quello che c'e' nell'archivio.
 * Un test verifica che un database nuovo non abbia altre tabelle piene.
 */
export const SEEDED_TABLES: readonly string[] = ["document_category", "dossier_category", "holiday_rule"];


/** Tabelle da archiviare, nell'ordine di reinserimento. */
export const tablesFor = (includeAuth: boolean): readonly string[] => (includeAuth ? [...AUTH_TABLES, ...BUSINESS_TABLES] : BUSINESS_TABLES);

export const manifestSchema = z.object({
  format: z.literal(ARCHIVE_FORMAT),
  formatVersion: z.number().int().min(1),
  createdAt: z.string(),
  /** Include le credenziali del proprietario (solo i backup cifrati). */
  includesAuth: z.boolean(),
  /** Impronte delle migrazioni applicate: un ripristino richiede lo stesso schema. */
  schema: z.object({ migrations: z.array(z.string()) }),
  tables: z.record(z.string(), z.object({ rows: z.number().int().min(0), sha256: z.string() })),
  /** File originali: chiave nello storage -> dimensione e impronta. */
  files: z.record(z.string(), z.object({ sizeBytes: z.number().int().min(0), sha256: z.string() })),
  /** File indicati dal database ma assenti dallo storage al momento del backup. */
  missingFiles: z.array(z.string()),
  /** Ultima riga dell'audit contenuta nell'archivio (null se l'audit e' vuoto). */
  auditHead: z.object({ seq: z.number().int(), hash: z.string() }).nullable(),
});
export type Manifest = z.infer<typeof manifestSchema>;

export const manifestPath = "manifest.json";
export const tablePath = (table: string) => `data/${table}.ndjson`;
export const filePath = (storageKey: string) => `files/${storageKey}`;

export const readmeText = `GESTIONE IMMOBILI - ARCHIVIO DEI DATI

Questo file ZIP contiene tutti i dati dell'applicazione in formati aperti, leggibili senza l'applicazione.

  manifest.json          descrizione dell'archivio: versione del formato, data, righe e impronte SHA-256 di ogni tabella
  data/<tabella>.ndjson  i dati: una riga JSON per ogni record (UTF-8). Le date sono in formato ISO 8601.
  files/<chiave>         i documenti originali. La chiave e' quella indicata in data/file_object.ndjson,
                         che li collega ai documenti (data/document_version.ndjson) e ai beni (data/document_asset.ndjson).

Come ritrovare un documento: data/document.ndjson (titolo, categoria) -> data/document_version.ndjson
(nome del file originale, date, emittente) -> data/file_object.ndjson (chiave del file) -> files/<chiave>.

L'impronta SHA-256 di ogni file e' in data/file_object.ndjson; quella di ogni tabella e' nel manifest.
`;
