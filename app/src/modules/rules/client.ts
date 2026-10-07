/**
 * Parte del modulo Regole utilizzabile nei componenti client: solo costanti, tipi e funzioni pure.
 * L'`index.ts` importa il database e non deve finire nel bundle del browser.
 */
export { type Condition, type ConditionOp, type Primitive, type Trace } from "./domain/condition";
export { fromFlat, toFlat, type FlatCondition, type FlatRow } from "./domain/condition-form";
export {
  RULE_LEVELS,
  RULE_VERIFICATION,
  type DerivedDeadline,
  type Explanation,
  type Outcome,
  type RuleLevel,
  type RuleVerification,
} from "./domain/rule";
