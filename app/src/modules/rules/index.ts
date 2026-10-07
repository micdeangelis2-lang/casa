/**
 * Interfaccia pubblica del modulo Regole: regole versionate (dati, non codice), condizioni validate, valutazione
 * spiegabile sui fatti di un bene. Le scritture ricevono una `UnitOfWork`, le letture un `Db`.
 * Il motore e' puro (`evaluateRules`): non legge il database, riceve regole e fatti.
 */
import type { UnitOfWork } from "@/platform/db/unit-of-work";
import type { Db } from "@/platform/db/types";
import { documentCategory, dossierCategory } from "@/platform/db/schema";
import { describeTerritories, getTerritory } from "@/modules/territory";
import type { RuleCollaborators } from "./application/ports";
import * as useCases from "./application/use-cases";
import type { RuleVerification } from "./domain/rule";
import { drizzleRuleRepository } from "./infrastructure/drizzle-rule-repository";

export {
  RULE_LEVELS,
  RULE_VERIFICATION,
  effectiveVersion,
  evaluateRules,
  type DerivedChecklistItem,
  type DerivedDeadline,
  type DerivedNotice,
  type Evaluation,
  type Explanation,
  type Outcome,
  type RuleLevel,
  type RuleVerification,
  type RuleVersion,
  type RuleWithVersions,
} from "./domain/rule";
export { type Condition, type ConditionOp, type Facts, type Primitive, type Trace } from "./domain/condition";
export type { RuleDetail, RuleListItem } from "./application/use-cases";

/** Tassonomie a dati lette direttamente: il modulo Regole non puo' dipendere da Dossier (sarebbe un ciclo). */
function collaborators(db: Db): RuleCollaborators {
  return {
    territoryKind: async (id) => (await getTerritory(db, id))?.kind ?? null,
    territoryLabels: async (ids) => new Map((await describeTerritories(db, ids)).map((t) => [t.id, t.label])),
    categoryCodes: async () => ({
      dossier: new Set((await db.select({ code: dossierCategory.code }).from(dossierCategory)).map((c) => c.code)),
      document: new Set((await db.select({ code: documentCategory.code }).from(documentCategory)).map((c) => c.code)),
    }),
  };
}

const writeDeps = (uow: UnitOfWork) => ({ repo: drizzleRuleRepository(uow.tx), others: collaborators(uow.tx), audit: uow.audit });
const readDeps = (db: Db) => ({ repo: drizzleRuleRepository(db), others: collaborators(db) });

export const createRule = (uow: UnitOfWork, input: unknown) => useCases.createRule(writeDeps(uow), input);
export const addRuleVersion = (uow: UnitOfWork, ruleId: string, input: unknown) => useCases.addRuleVersion(writeDeps(uow), ruleId, input);
export const cloneRule = (uow: UnitOfWork, ruleId: string) => useCases.cloneRule(writeDeps(uow), ruleId);
export const setVersionVerification = (uow: UnitOfWork, versionId: string, status: RuleVerification) =>
  useCases.setVersionVerification(writeDeps(uow), versionId, status);
export const setRuleActive = (uow: UnitOfWork, ruleId: string, active: boolean) => useCases.setRuleActive(writeDeps(uow), ruleId, active);
export const seedExampleRules = (uow: UnitOfWork, municipalityId?: string) => useCases.seedExampleRules(writeDeps(uow), municipalityId);

export const listRules = (db: Db) => useCases.listRules(readDeps(db));
export const getRule = (db: Db, id: string) => useCases.getRule(readDeps(db), id);
/** Tutte le regole attive con le versioni: input del motore di valutazione. */
export const loadActiveRules = async (db: Db) => (await drizzleRuleRepository(db).list()).filter((r) => r.active);
