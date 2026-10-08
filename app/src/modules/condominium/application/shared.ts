import type { FieldErrors, Result } from "@/shared/result";
import type { CondoDeps } from "./ports";

export type Id = Result<{ id: string }>;

export async function refs(deps: CondoDeps, r: { parties?: (string | undefined)[]; documents?: (string | undefined)[]; matter?: string }): Promise<FieldErrors> {
  const errors: FieldErrors = {};
  const wantedParties = (r.parties ?? []).filter((x): x is string => Boolean(x));
  if (wantedParties.length > 0) {
    const known = await deps.others.parties();
    if (wantedParties.some((p) => !known.has(p))) errors.partyId = ["Il contatto non esiste più nella rubrica"];
  }
  const wantedDocuments = (r.documents ?? []).filter((x): x is string => Boolean(x));
  if (wantedDocuments.length > 0) {
    const known = await deps.others.documentTitles();
    if (wantedDocuments.some((d) => !known.has(d))) errors.documentId = ["Il documento non esiste"];
  }
  if (r.matter && !(await deps.others.matterTitles()).has(r.matter)) errors.matterId = ["La pratica non esiste"];
  return errors;
}
export const hasErrors = (e: FieldErrors) => Object.keys(e).length > 0;
