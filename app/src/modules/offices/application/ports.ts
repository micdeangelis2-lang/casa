import type { AuditRecorder } from "@/platform/audit";
import type { RuleVerification } from "@/modules/rules";

export type FormTemplateRow = {
  id: string;
  officePartyId: string;
  name: string;
  checklist: string[];
  source: string | null;
  verifiedOn: string | null;
  verificationStatus: RuleVerification;
  note: string | null;
  archived: boolean;
};

export interface FormTemplateRepository {
  list(filter: { officePartyId?: string; includeArchived: boolean }): Promise<FormTemplateRow[]>;
  get(id: string): Promise<FormTemplateRow | null>;
  insert(d: Omit<FormTemplateRow, "id">): Promise<string>;
  update(id: string, d: Partial<Omit<FormTemplateRow, "id">>): Promise<void>;
}

export interface FormTemplateCollaborators {
  /** Il contatto e' un ufficio pubblico della rubrica? Restituisce il nome, o null se non esiste o non e' un ufficio. */
  officeName(partyId: string): Promise<string | null>;
}

export type FormTemplateDeps = { repo: FormTemplateRepository; others: FormTemplateCollaborators; audit: AuditRecorder };
export type FormTemplateReadDeps = Pick<FormTemplateDeps, "repo">;
