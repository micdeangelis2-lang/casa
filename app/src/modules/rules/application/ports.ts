import type { AuditRecorder } from "@/platform/audit";
import type { RuleVerification, RuleVersionInput, RuleWithVersions } from "../domain/rule";

export interface RuleRepository {
  keyExists(key: string): Promise<boolean>;
  insertRule(key: string): Promise<string>;
  /** Aggiunge una versione con il numero successivo. */
  insertVersion(ruleId: string, input: RuleVersionInput, supersedesVersionId: string | null): Promise<{ id: string; versionNo: number }>;
  setVerification(versionId: string, status: RuleVerification): Promise<{ ruleId: string } | null>;
  setActive(ruleId: string, active: boolean): Promise<boolean>;
  /** Una regola con tutte le versioni, dalla piu' recente. */
  get(ruleId: string): Promise<RuleWithVersions | null>;
  /** Tutte le regole con le loro versioni (a questa scala bastano in memoria). */
  list(): Promise<RuleWithVersions[]>;
}

/** Cio' che serve dagli altri moduli e dalle tassonomie a dati. */
export interface RuleCollaborators {
  territoryKind(id: string): Promise<string | null>;
  territoryLabels(ids: string[]): Promise<Map<string, string>>;
  /** Codici validi delle categorie del dossier e delle categorie documentali. */
  categoryCodes(): Promise<{ dossier: Set<string>; document: Set<string> }>;
}

export type RuleDeps = { repo: RuleRepository; others: RuleCollaborators; audit: AuditRecorder };
export type RuleReadDeps = Pick<RuleDeps, "repo" | "others">;
