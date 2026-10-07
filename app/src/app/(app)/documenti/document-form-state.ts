import type { Confidentiality, VerificationStatus } from "@/modules/documents/client";

/** Valori del modulo documento, tutti stringhe come nei campi (le liste sono ids). */
export type DocumentFormValues = {
  title: string;
  categoryId: string;
  confidentiality: Confidentiality;
  assetIds: string[];
  issuerPartyId: string;
  issuedOn: string;
  validFrom: string;
  validTo: string;
  verificationStatus: VerificationStatus;
  note: string;
  notes: string;
};

export const emptyDocumentForm = (overrides: Partial<DocumentFormValues> = {}): DocumentFormValues => ({
  title: "",
  categoryId: "",
  confidentiality: "ordinary",
  assetIds: [],
  issuerPartyId: "",
  issuedOn: "",
  validFrom: "",
  validTo: "",
  verificationStatus: "to_verify",
  note: "",
  notes: "",
  ...overrides,
});

/** Messaggio per i file troppo grandi, prima di spedirli. */
export const FILE_FIELD = "file";

export function formValuesToFormData(values: DocumentFormValues, file: File | null): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (key === "assetIds") for (const id of value as string[]) data.append("assetIds", id);
    else data.set(key, value as string);
  }
  if (file) data.set(FILE_FIELD, file);
  return data;
}
