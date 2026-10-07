import { optionalDate, optionalText, requiredText, z } from "@/shared/zod";

export const CONFIDENTIALITY = ["ordinary", "reserved", "highly_reserved"] as const;
export type Confidentiality = (typeof CONFIDENTIALITY)[number];

export const VERIFICATION_STATUS = ["draft", "to_verify", "verified_by_owner", "validated_by_professional"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUS)[number];

/** Tetto per file: il caricamento passa dal server (vedi DECISIONS.md, E14). */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

const versionFields = {
  issuedOn: optionalDate,
  validFrom: optionalDate,
  validTo: optionalDate,
  issuerPartyId: z.preprocess((v) => (v === "" ? undefined : v), z.uuid("Scegli l'emittente dalla rubrica").optional()),
  verificationStatus: z.enum(VERIFICATION_STATUS, { error: "Scegli lo stato di verifica" }).default("to_verify"),
  note: optionalText(500),
};

const validityOrder = (v: { validFrom?: string; validTo?: string }, ctx: z.RefinementCtx) => {
  if (v.validFrom && v.validTo && v.validTo < v.validFrom) {
    ctx.addIssue({ code: "custom", path: ["validTo"], message: "La data di fine validità è precedente a quella di inizio" });
  }
};

/** Dati di un documento nuovo (insieme alla prima versione). Il file viaggia a parte. */
export const documentInputSchema = z
  .object({
    title: requiredText("Titolo", 200),
    categoryId: z.uuid("Scegli la categoria"),
    confidentiality: z.enum(CONFIDENTIALITY, { error: "Scegli il livello di riservatezza" }).default("ordinary"),
    notes: optionalText(2000),
    assetIds: z.array(z.uuid("Bene non valido")).max(200).default([]),
    ...versionFields,
  })
  .superRefine(validityOrder);

/** Metadati di una versione (nuova versione, o modifica di quella corrente). */
export const versionInputSchema = z.object(versionFields).superRefine(validityOrder);
export type VersionInput = z.infer<typeof versionInputSchema>;

/** Modifica dei metadati del documento e della versione corrente (il file non cambia). */
export const documentUpdateSchema = z
  .object({
    title: requiredText("Titolo", 200),
    categoryId: z.uuid("Scegli la categoria"),
    confidentiality: z.enum(CONFIDENTIALITY, { error: "Scegli il livello di riservatezza" }),
    notes: optionalText(2000),
    assetIds: z.array(z.uuid("Bene non valido")).max(200).default([]),
    ...versionFields,
  })
  .superRefine(validityOrder);

export type DocumentCategoryView = { id: string; code: string; name: string };

export type VersionView = {
  id: string;
  versionNo: number;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  issuedOn: string | null;
  validFrom: string | null;
  validTo: string | null;
  issuerPartyId: string | null;
  verificationStatus: VerificationStatus;
  note: string | null;
  hasText: boolean;
  createdAt: Date;
};

export type DocumentSummary = {
  id: string;
  title: string;
  categoryId: string;
  confidentiality: Confidentiality;
  archived: boolean;
  /** Dati della versione corrente (la piu' recente). */
  currentVersionId: string;
  versionCount: number;
  issuedOn: string | null;
  validTo: string | null;
  verificationStatus: VerificationStatus;
  mimeType: string;
};

export type DocumentDetail = {
  id: string;
  title: string;
  categoryId: string;
  confidentiality: Confidentiality;
  notes: string | null;
  archived: boolean;
  assetIds: string[];
  /** Dalla piu' recente alla piu' vecchia. */
  versions: VersionView[];
};

/** Tipi di file accettati. Il tipo si decide dai byte, non dall'estensione. */
export type SniffedFile = { mime: string; extension: string };

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  signature.every((b, i) => bytes[offset + i] === b);

const ascii = (bytes: Uint8Array, text: string, offset = 0) =>
  startsWith(bytes, [...text].map((c) => c.charCodeAt(0)), offset);

const ZIP_BASED: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
};

/**
 * Riconosce il tipo dai primi byte. Per i formati basati su zip (docx, xlsx, odt, ods) la firma e' la stessa:
 * si accetta solo se l'estensione dichiarata e' una di quelle ammesse. I `.p7m` (documenti firmati) sono
 * strutture DER che iniziano con 0x30. Restituisce null per qualunque altro tipo.
 */
export function sniffFile(bytes: Uint8Array, filename: string): SniffedFile | null {
  if (bytes.length < 4) return null;
  const ext = filename.toLowerCase().split(".").pop() ?? "";

  if (ascii(bytes, "%PDF-")) return { mime: "application/pdf", extension: "pdf" };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: "image/png", extension: "png" };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", extension: "jpg" };
  if (ascii(bytes, "GIF87a") || ascii(bytes, "GIF89a")) return { mime: "image/gif", extension: "gif" };
  if (ascii(bytes, "RIFF") && ascii(bytes, "WEBP", 8)) return { mime: "image/webp", extension: "webp" };
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])) {
    return { mime: "image/tiff", extension: "tif" };
  }
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) && ZIP_BASED[ext]) return { mime: ZIP_BASED[ext], extension: ext };
  if (ext === "p7m" && bytes[0] === 0x30) return { mime: "application/pkcs7-mime", extension: "p7m" };
  return null;
}

/** Tipi che il browser puo' mostrare in linea senza eseguire nulla. Gli altri si scaricano. */
export const INLINE_MIME_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"] as const;
