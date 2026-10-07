"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { evaluateAllDossiers } from "@/modules/dossier";
import { addRuleVersion, cloneRule, createRule, seedExampleRules, setRuleActive, setVersionVerification, RULE_VERIFICATION, type RuleVerification } from "@/modules/rules";
import { isUuid } from "@/lib/ids";
import type { FieldErrors } from "@/shared/result";

export type SaveResult = { errors: FieldErrors } | undefined;

const asOwner = (userId: string) => ({ type: "owner", id: userId }) as const;

/**
 * Crea una regola (ruleId nullo) o ne aggiunge una versione. Pubblicare una regola rivaluta i dossier nella stessa
 * transazione (sezione 5.5): la regola e le voci che ne derivano non possono restare scollegate.
 */
export async function saveRuleAction(ruleId: string | null, payload: unknown): Promise<SaveResult> {
  const owner = await requireOwner();
  if (ruleId !== null && !isUuid(ruleId)) return { errors: { _: ["Regola non trovata"] } };

  const result = await runInUnitOfWork(getDb(), asOwner(owner.userId), async (uow) => {
    const saved = ruleId ? await addRuleVersion(uow, ruleId, payload) : await createRule(uow, payload);
    if (saved.ok) await evaluateAllDossiers(uow);
    return saved;
  });
  if (!result.ok) return { errors: result.errors };

  revalidatePath("/regole");
  revalidatePath("/immobili", "layout");
  redirect(`/regole/${result.value.id}`);
}

export async function cloneRuleAction(ruleId: string): Promise<void> {
  const owner = await requireOwner();
  if (!isUuid(ruleId)) return;
  const result = await runInUnitOfWork(getDb(), asOwner(owner.userId), (uow) => cloneRule(uow, ruleId));
  revalidatePath("/regole");
  if (result.ok) redirect(`/regole/${result.value.id}/modifica`);
}

export async function setRuleActiveAction(ruleId: string, active: boolean): Promise<void> {
  const owner = await requireOwner();
  if (!isUuid(ruleId)) return;
  await runInUnitOfWork(getDb(), asOwner(owner.userId), async (uow) => {
    const done = await setRuleActive(uow, ruleId, active);
    if (done.ok) await evaluateAllDossiers(uow);
  });
  revalidatePath("/regole");
  revalidatePath(`/regole/${ruleId}`);
  revalidatePath("/immobili", "layout");
}

export async function setVerificationAction(ruleId: string, versionId: string, status: string): Promise<void> {
  const owner = await requireOwner();
  if (!isUuid(ruleId) || !isUuid(versionId) || !(RULE_VERIFICATION as readonly string[]).includes(status)) return;
  await runInUnitOfWork(getDb(), asOwner(owner.userId), async (uow) => {
    const done = await setVersionVerification(uow, versionId, status as RuleVerification);
    if (done.ok) await evaluateAllDossiers(uow);
  });
  revalidatePath(`/regole/${ruleId}`);
  revalidatePath("/regole");
  revalidatePath("/immobili", "layout");
}

export type SeedResult = { ok: true; created: number; skipped: number } | { ok: false; message: string };

export async function seedRulesAction(municipalityId: string | null): Promise<SeedResult> {
  const owner = await requireOwner();
  if (municipalityId !== null && !isUuid(municipalityId)) return { ok: false, message: "Comune non valido" };
  const result = await runInUnitOfWork(getDb(), asOwner(owner.userId), async (uow) => {
    const seeded = await seedExampleRules(uow, municipalityId ?? undefined);
    if (seeded.ok) await evaluateAllDossiers(uow);
    return seeded;
  });
  revalidatePath("/regole");
  revalidatePath("/immobili", "layout");
  if (!result.ok) return { ok: false, message: Object.values(result.errors).flat().join("; ") };
  return { ok: true, ...result.value };
}

export async function reevaluateAllAction(): Promise<{ assets: number; changed: number }> {
  const owner = await requireOwner();
  const result = await runInUnitOfWork(getDb(), asOwner(owner.userId), (uow) => evaluateAllDossiers(uow));
  revalidatePath("/immobili", "layout");
  return result;
}
