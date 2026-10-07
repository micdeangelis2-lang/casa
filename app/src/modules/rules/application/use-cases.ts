import { randomBytes } from "node:crypto";
import { sameJson } from "@/shared/json";
import { fail, failGeneral, ok, zodIssuesToErrors, type FieldErrors, type Result } from "@/shared/result";
import {
  ruleKeyFrom,
  ruleVersionInputSchema,
  type RuleLevel,
  type RuleVerification,
  type RuleVersion,
  type RuleVersionInput,
  type RuleWithVersions,
} from "../domain/rule";
import { exampleRules } from "../domain/seed";
import type { RuleDeps, RuleReadDeps } from "./ports";

/** Il territorio di una versione deve essere coerente col suo livello normativo. */
const TERRITORY_KINDS_BY_LEVEL: Partial<Record<RuleLevel, { kinds: string[]; message: string }>> = {
  national: { kinds: ["country"], message: "Una regola nazionale non ha un territorio (lascia «Ovunque»)" },
  regional: { kinds: ["region", "province"], message: "Una regola regionale vale per una Regione o una Provincia" },
  municipal: { kinds: ["municipality", "locality"], message: "Una regola comunale vale per un Comune o una località" },
};

async function checkReferences(deps: RuleDeps, input: RuleVersionInput): Promise<FieldErrors> {
  const errors: FieldErrors = {};
  const rule = TERRITORY_KINDS_BY_LEVEL[input.level];
  if (input.territoryId) {
    const kind = await deps.others.territoryKind(input.territoryId);
    if (!kind) errors.territoryId = ["Il territorio scelto non esiste"];
    else if (rule && !rule.kinds.includes(kind)) errors.territoryId = [rule.message];
  } else if (input.level === "regional" || input.level === "municipal") {
    errors.territoryId = [input.level === "regional" ? "Scegli la Regione o la Provincia" : "Scegli il Comune o la località"];
  }

  const codes = await deps.others.categoryCodes();
  input.outcomes.forEach((o, i) => {
    if (o.type !== "checklist") return;
    if (!codes.dossier.has(o.dossierCategory)) (errors[`outcomes.${i}.dossierCategory`] ??= []).push("La categoria del dossier non esiste");
    if (o.expectedDocumentCategory && !codes.document.has(o.expectedDocumentCategory)) {
      (errors[`outcomes.${i}.expectedDocumentCategory`] ??= []).push("La categoria documentale non esiste");
    }
  });
  return errors;
}

async function parse(deps: RuleDeps, raw: unknown): Promise<Result<RuleVersionInput>> {
  const parsed = ruleVersionInputSchema.safeParse(raw);
  if (!parsed.success) return fail(zodIssuesToErrors(parsed.error));
  const errors = await checkReferences(deps, parsed.data);
  return Object.keys(errors).length > 0 ? fail(errors) : ok(parsed.data);
}

async function freshKey(deps: RuleDeps, title: string): Promise<string> {
  for (;;) {
    const key = ruleKeyFrom(title, randomBytes(2).toString("hex"));
    if (!(await deps.repo.keyExists(key))) return key;
  }
}

export async function createRule(deps: RuleDeps, raw: unknown, options: { key?: string } = {}): Promise<Result<{ id: string; key: string }>> {
  const input = await parse(deps, raw);
  if (!input.ok) return input;
  const key = options.key ?? (await freshKey(deps, input.value.title));
  if (options.key && (await deps.repo.keyExists(key))) return failGeneral("Esiste già una regola con questo codice");

  const id = await deps.repo.insertRule(key);
  await deps.repo.insertVersion(id, input.value, null);
  await deps.audit.record({
    action: "rule.create",
    entityType: "rule",
    entityId: id,
    diff: { key, level: input.value.level, versionNo: 1, outcomes: input.value.outcomes.length },
  });
  return ok({ id, key });
}

const FIELDS = ["title", "description", "level", "territoryId", "validFrom", "validTo", "appliesWhen", "outcomes", "sourceText", "sourceUrl"] as const;
const same = sameJson;

/** Modificare una regola crea una NUOVA versione: la precedente resta com'era (con la sua spiegazione e la sua fonte). */
export async function addRuleVersion(deps: RuleDeps, ruleId: string, raw: unknown): Promise<Result<{ id: string; versionNo: number }>> {
  const rule = await deps.repo.get(ruleId);
  if (!rule) return failGeneral("Regola non trovata");
  const input = await parse(deps, raw);
  if (!input.ok) return input;

  const latest = rule.versions[0]!;
  const changed = FIELDS.filter((f) => !same(latest[f], input.value[f]));
  const created = await deps.repo.insertVersion(ruleId, input.value, latest.id);
  await deps.audit.record({
    action: "rule.version.add",
    entityType: "rule",
    entityId: ruleId,
    diff: { key: rule.key, versionNo: created.versionNo, changed },
  });
  return ok({ id: ruleId, versionNo: created.versionNo });
}

/** Una copia indipendente (nuova identita') partendo dalla versione piu' recente, come bozza. */
export async function cloneRule(deps: RuleDeps, ruleId: string): Promise<Result<{ id: string; key: string }>> {
  const rule = await deps.repo.get(ruleId);
  if (!rule) return failGeneral("Regola non trovata");
  const v = rule.versions[0]!;
  const copy = {
    title: `${v.title} (copia)`.slice(0, 200),
    description: v.description ?? undefined,
    level: v.level,
    territoryId: v.territoryId ?? undefined,
    validFrom: v.validFrom ?? undefined,
    validTo: v.validTo ?? undefined,
    appliesWhen: v.appliesWhen,
    outcomes: v.outcomes,
    sourceText: v.sourceText,
    sourceUrl: v.sourceUrl ?? undefined,
    verificationStatus: "draft",
    changeNote: `Copia di ${rule.key}, versione ${v.versionNo}`,
  };
  const created = await createRule(deps, copy);
  if (created.ok) {
    await deps.audit.record({ action: "rule.clone", entityType: "rule", entityId: created.value.id, diff: { from: rule.key, fromVersionNo: v.versionNo } });
  }
  return created;
}

/** Lo stato di verifica e' una revisione: non crea una versione ma resta nell'audit. */
export async function setVersionVerification(deps: RuleDeps, versionId: string, status: RuleVerification): Promise<Result<{ id: string }>> {
  const done = await deps.repo.setVerification(versionId, status);
  if (!done) return failGeneral("Versione non trovata");
  await deps.audit.record({ action: "rule.verify", entityType: "rule", entityId: done.ruleId, diff: { versionId, status } });
  return ok({ id: done.ruleId });
}

export async function setRuleActive(deps: RuleDeps, ruleId: string, active: boolean): Promise<Result<{ id: string }>> {
  if (!(await deps.repo.setActive(ruleId, active))) return failGeneral("Regola non trovata");
  await deps.audit.record({ action: active ? "rule.activate" : "rule.deactivate", entityType: "rule", entityId: ruleId, diff: {} });
  return ok({ id: ruleId });
}

export type RuleListItem = {
  id: string;
  key: string;
  active: boolean;
  versionCount: number;
  current: RuleVersion;
  territoryLabel: string | null;
};

export async function listRules(deps: RuleReadDeps): Promise<RuleListItem[]> {
  const rules = await deps.repo.list();
  const labels = await deps.others.territoryLabels([...new Set(rules.flatMap((r) => (r.versions[0]?.territoryId ? [r.versions[0].territoryId] : [])))]);
  return rules.map((r) => ({
    id: r.id,
    key: r.key,
    active: r.active,
    versionCount: r.versions.length,
    current: r.versions[0]!,
    territoryLabel: r.versions[0]!.territoryId ? (labels.get(r.versions[0]!.territoryId) ?? null) : null,
  }));
}

export type RuleDetail = RuleWithVersions & { territoryLabels: Record<string, string> };

export async function getRule(deps: RuleReadDeps, ruleId: string): Promise<RuleDetail | null> {
  const rule = await deps.repo.get(ruleId);
  if (!rule) return null;
  const ids = [...new Set(rule.versions.flatMap((v) => (v.territoryId ? [v.territoryId] : [])))];
  return { ...rule, territoryLabels: Object.fromEntries(await deps.others.territoryLabels(ids)) };
}

/** Carica le regole di esempio (idempotente: una regola con lo stesso codice non si tocca). */
export async function seedExampleRules(deps: RuleDeps, municipalityId: string | undefined): Promise<Result<{ created: number; skipped: number }>> {
  let created = 0;
  let skipped = 0;
  for (const seed of exampleRules({ municipalityId })) {
    if (await deps.repo.keyExists(seed.key)) {
      skipped += 1;
      continue;
    }
    const result = await createRule(deps, seed.input, { key: seed.key });
    if (!result.ok) return result;
    created += 1;
  }
  await deps.audit.record({ action: "rule.seed", entityType: "rule", entityId: "seed", diff: { created, skipped } });
  return ok({ created, skipped });
}
