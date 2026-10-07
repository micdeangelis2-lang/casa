import { csvDocument } from "@/shared/csv";
import { optionalText, requiredText, z } from "@/shared/zod";

/** Destinatari tipici di un pacchetto (sezione 10 del prompt). Il pacchetto lo invia il proprietario a mano. */
export const RECIPIENT_TYPES = ["administrator", "technician", "lawyer", "notary", "accountant", "insurer", "tenant", "manager", "agent", "other"] as const;
export type RecipientType = (typeof RECIPIENT_TYPES)[number];

/** Dal meno al piu' riservato. */
export const CONFIDENTIALITY_LEVELS = ["ordinary", "reserved", "highly_reserved"] as const;
export type ConfidentialityLevel = (typeof CONFIDENTIALITY_LEVELS)[number];

/** Vero se un documento e' piu' riservato del tetto scelto. */
export const exceedsCap = (documentLevel: ConfidentialityLevel, cap: ConfidentialityLevel): boolean => CONFIDENTIALITY_LEVELS.indexOf(documentLevel) > CONFIDENTIALITY_LEVELS.indexOf(cap);

export const packageInputSchema = z.object({
  recipientType: z.enum(RECIPIENT_TYPES, { error: "Scegli il tipo di destinatario" }),
  recipientName: requiredText("Destinatario", 160),
  confidentialityCap: z.enum(CONFIDENTIALITY_LEVELS, { error: "Scegli il livello massimo di riservatezza" }),
  note: optionalText(500),
  documents: z
    .array(z.object({ documentId: z.uuid("Documento non valido"), overrideAboveCap: z.boolean().default(false) }))
    .min(1, "Scegli almeno un documento")
    .max(500, "Troppi documenti in un solo pacchetto (massimo 500)"),
});

/** Nome di file sicuro per l'archivio: niente percorsi, niente caratteri strani, lunghezza limitata. */
export function safeFileName(original: string): string {
  const cleaned = original
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._]+/, "")
    .slice(-80);
  return cleaned === "" ? "documento" : cleaned;
}

export type PackageItemInfo = {
  path: string;
  title: string;
  categoryName: string;
  confidentiality: ConfidentialityLevel;
  issuerName: string | null;
  issuedOn: string | null;
  validFrom: string | null;
  validTo: string | null;
  verificationStatus: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  overrideAboveCap: boolean;
  assetNames: string[];
};

export const MANIFEST_FORMAT = "gestione-immobili-package";
export const MANIFEST_VERSION = 1;

export type ManifestInput = {
  createdAt: string;
  recipientType: RecipientType;
  recipientName: string;
  confidentialityCap: ConfidentialityLevel;
  note: string | null;
  items: PackageItemInfo[];
};

export const buildManifest = (m: ManifestInput) =>
  JSON.stringify(
    {
      format: MANIFEST_FORMAT,
      formatVersion: MANIFEST_VERSION,
      createdAt: m.createdAt,
      recipient: { type: m.recipientType, name: m.recipientName },
      confidentialityCap: m.confidentialityCap,
      note: m.note,
      files: m.items.map((i) => ({
        path: i.path,
        title: i.title,
        category: i.categoryName,
        confidentiality: i.confidentiality,
        issuer: i.issuerName,
        issuedOn: i.issuedOn,
        validFrom: i.validFrom,
        validTo: i.validTo,
        verificationStatus: i.verificationStatus,
        mimeType: i.mimeType,
        sizeBytes: i.sizeBytes,
        sha256: i.sha256,
        includedAboveCap: i.overrideAboveCap,
        assets: i.assetNames,
      })),
    },
    null,
    2,
  );

/** Elenco CSV (separatore «;», con BOM: si apre bene in Excel in italiano). */
export function buildCsv(items: PackageItemInfo[]): string {
  const header = ["File", "Titolo", "Categoria", "Immobili", "Riservatezza", "Emesso da", "Data di emissione", "Valido dal", "Valido fino al", "Stato di verifica", "Dimensione (byte)", "SHA-256"];
  const rows = items.map((i) => [i.path, i.title, i.categoryName, i.assetNames.join(" / "), i.confidentiality, i.issuerName, i.issuedOn, i.validFrom, i.validTo, i.verificationStatus, i.sizeBytes, i.sha256]);
  return csvDocument([header, ...rows], { alwaysQuote: true });
}

const escapeHtml = (value: string | null) => (value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const dateIt = (value: string | null) => (value ? value.split("-").reverse().join("/") : "");

export type IndexLabels = {
  recipient: Record<RecipientType, string>;
  confidentiality: Record<ConfidentialityLevel, string>;
  verification: Record<string, string>;
};

/**
 * Indice leggibile del pacchetto (HTML senza script). Linguaggio neutro: dice cosa c'e' nel pacchetto e di chi e' la
 * responsabilita', senza attestare la conformita' di nulla.
 */
export function buildIndexHtml(m: ManifestInput, labels: IndexLabels): string {
  const rows = m.items
    .map(
      (i) => `<tr>
<td><a href="${escapeHtml(i.path)}">${escapeHtml(i.title)}</a></td>
<td>${escapeHtml(i.categoryName)}</td>
<td>${escapeHtml(i.assetNames.join(", "))}</td>
<td>${escapeHtml(i.issuerName)}</td>
<td>${dateIt(i.issuedOn)}</td>
<td>${dateIt(i.validFrom)}${i.validFrom && i.validTo ? " – " : ""}${dateIt(i.validTo)}</td>
<td>${escapeHtml(labels.confidentiality[i.confidentiality])}${i.overrideAboveCap ? " (incluso oltre il livello scelto)" : ""}</td>
<td>${escapeHtml(labels.verification[i.verificationStatus] ?? i.verificationStatus)}</td>
<td class="hash">${escapeHtml(i.sha256)}</td>
</tr>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pacchetto di documenti</title>
<style>
body{font-family:system-ui,sans-serif;margin:2rem;color:#111;line-height:1.5}
table{border-collapse:collapse;width:100%;font-size:.9rem}
th,td{border:1px solid #bbb;padding:.4rem .6rem;text-align:left;vertical-align:top}
th{background:#f2f2f2}
.hash{font-family:ui-monospace,monospace;font-size:.7rem;word-break:break-all}
.note{border:1px solid #bbb;padding:.75rem 1rem;background:#fafafa}
</style>
</head>
<body>
<h1>Pacchetto di documenti</h1>
<p><strong>Destinatario:</strong> ${escapeHtml(m.recipientName)} (${escapeHtml(labels.recipient[m.recipientType])})<br>
<strong>Preparato il:</strong> ${escapeHtml(dateIt(m.createdAt.slice(0, 10)))}<br>
<strong>Livello massimo di riservatezza scelto:</strong> ${escapeHtml(labels.confidentiality[m.confidentialityCap])}<br>
<strong>Documenti:</strong> ${m.items.length}</p>
${m.note ? `<p><strong>Nota del proprietario:</strong> ${escapeHtml(m.note)}</p>` : ""}
<p class="note">Questo pacchetto è stato preparato dal proprietario con i documenti che ha caricato. Non attesta la conformità del bene né la correttezza o la completezza dei documenti: lo stato di verifica indicato è quello assegnato dal proprietario. Per ogni decisione serve il parere di un professionista.</p>
<table>
<thead><tr><th>Documento</th><th>Categoria</th><th>Immobili</th><th>Emesso da</th><th>Emissione</th><th>Validità</th><th>Riservatezza</th><th>Verifica</th><th>SHA-256</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
<p>L'impronta SHA-256 permette di controllare che il file non sia stato modificato. L'elenco completo, in formato leggibile da programmi, è in <a href="manifest.json">manifest.json</a> e <a href="elenco.csv">elenco.csv</a>.</p>
</body>
</html>
`;
}
