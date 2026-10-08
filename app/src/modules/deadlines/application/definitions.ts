import { addDays, yearOf } from "@/shared/dates";
import { occurrencesBetween, shiftToBusinessDay } from "@/shared/calc";
import { fail, failGeneral, ok, parseInput, zodIssuesToErrors, type FieldErrors, type Result } from "@/shared/result";
import { holidaySet } from "../domain/holidays";
import { DEFAULT_LEAD_DAYS, deadlineInputSchema, type DeadlineInput, type Priority } from "../domain/deadline";
import type { DeadlineDeps, DeadlineRow, NewDeadline } from "./ports";

/** Le date si calcolano da oggi in avanti: non si inventano ritardi per date passate prima che la scadenza esistesse. */
const HORIZON_DAYS = 400;

const toNew = (input: DeadlineInput): NewDeadline => ({
  title: input.title,
  description: input.description ?? null,
  category: input.category,
  level: input.level,
  legalBasis: input.legalBasis ?? null,
  assetId: input.assetId ?? null,
  responsiblePartyId: input.responsiblePartyId ?? null,
  professionalPartyId: input.professionalPartyId ?? null,
  matterId: input.matterId ?? null,
  calc: input.calc,
  shiftToBusinessDay: input.shiftToBusinessDay,
  priority: input.priority,
  consequences: input.consequences ?? null,
  requiredDocuments: input.requiredDocuments ?? null,
  leadDays: input.leadDays ?? DEFAULT_LEAD_DAYS[input.priority],
  proofRequired: input.proofRequired,
  origin: "manual",
  ruleKey: null,
  outcomeKey: null,
  ruleVersionId: null,
  explanation: null,
});

async function checkReferences(deps: DeadlineDeps, input: { assetId?: string; responsiblePartyId?: string; professionalPartyId?: string; matterId?: string }): Promise<FieldErrors> {
  const errors: FieldErrors = {};
  if (input.assetId && !(await deps.others.assetNames()).has(input.assetId)) errors.assetId = ["L'immobile non esiste più"];
  const parties = await deps.others.partyNames();
  if (input.responsiblePartyId && !parties.has(input.responsiblePartyId)) errors.responsiblePartyId = ["Il contatto non esiste più nella rubrica"];
  if (input.professionalPartyId && !parties.has(input.professionalPartyId)) errors.professionalPartyId = ["Il contatto non esiste più nella rubrica"];
  if (input.matterId && !(await deps.others.matterIds()).has(input.matterId)) errors.matterId = ["La pratica non esiste più"];
  return errors;
}

/**
 * Calcola le date di una scadenza da oggi in avanti e le inserisce (idempotente). Se la regola di calcolo e' cambiata,
 * annulla le date FUTURE ancora aperte che non produce piu'; le date passate non si toccano (le decide il proprietario).
 */
export async function materialize(deps: DeadlineDeps, deadline: DeadlineRow, today: string): Promise<{ created: number; cancelled: number }> {
  if (deadline.calc.type === "manual" || deadline.archived) return { created: 0, cancelled: 0 };
  const info = deadline.assetId ? await deps.others.assetInfo(deadline.assetId) : null;
  if (deadline.assetId && !info) return { created: 0, cancelled: 0 };
  const to = addDays(today, HORIZON_DAYS);

  let dates = occurrencesBetween(deadline.calc, { attributes: info?.attributes ?? {} }, today, to);
  if (deadline.shiftToBusinessDay) {
    const holidays = holidaySet(yearOf(today), yearOf(to) + 1, await deps.repo.holidayRulesFor(info?.territoryChain ?? []));
    dates = dates.map((d) => shiftToBusinessDay(d, holidays));
  }
  const unique = [...new Set(dates)].sort();
  let created = 0;
  for (const dueOn of unique) if (await deps.repo.insertOccurrence(deadline.id, dueOn)) created += 1;
  const cancelled = await deps.repo.cancelOpenAfter(deadline.id, today, unique);
  return { created, cancelled };
}

/** Convalida a secco dei campi di una scadenza (le stesse regole di `createDeadline`, senza consultare il database e senza scrivere). */
export const validateDeadline = (input: unknown): Result<DeadlineInput> => parseInput(deadlineInputSchema, input);

export async function createDeadline(deps: DeadlineDeps, raw: unknown, today: string): Promise<Result<{ id: string }>> {
  const parsed = deadlineInputSchema.safeParse(raw);
  if (!parsed.success) return fail(zodIssuesToErrors(parsed.error));
  const errors = await checkReferences(deps, parsed.data);
  if (Object.keys(errors).length > 0) return fail(errors);

  const data = toNew(parsed.data);
  const id = await deps.repo.insertDeadline(data);
  if (parsed.data.calc.type === "manual") await deps.repo.insertOccurrence(id, parsed.data.firstDueOn!);
  else await materialize(deps, { ...data, id, stale: false, archived: false }, today);
  await deps.audit.record({
    action: "deadline.create",
    entityType: "deadline",
    entityId: id,
    diff: { category: data.category, level: data.level, calc: data.calc.type, assetId: data.assetId },
  });
  return ok({ id });
}

export async function updateDeadline(deps: DeadlineDeps, id: string, raw: unknown, today: string): Promise<Result<{ id: string }>> {
  const current = await deps.repo.getDeadline(id);
  if (!current) return failGeneral("Scadenza non trovata");
  if (current.origin === "rule") return failGeneral("Questa scadenza viene da una regola: cambiala dalla regola");
  const parsed = deadlineInputSchema.safeParse(raw);
  if (!parsed.success) return fail(zodIssuesToErrors(parsed.error));
  const errors = await checkReferences(deps, parsed.data);
  if (Object.keys(errors).length > 0) return fail(errors);

  const data = toNew(parsed.data);
  const changed = (["title", "description", "category", "level", "legalBasis", "assetId", "responsiblePartyId", "professionalPartyId", "matterId", "calc", "shiftToBusinessDay", "priority", "consequences", "requiredDocuments", "leadDays", "proofRequired"] as const).filter(
    (f) => JSON.stringify(data[f]) !== JSON.stringify(current[f]),
  );
  await deps.repo.updateDeadline(id, data);
  await materialize(deps, { ...data, id, stale: current.stale, archived: current.archived }, today);
  await deps.audit.record({ action: "deadline.update", entityType: "deadline", entityId: id, diff: { changed } });
  return ok({ id });
}

/** Una scadenza da regola: titolo, calcolo e base sono della regola; responsabile, professionista, priorita' e preavvisi sono del proprietario. */
export async function updateOwnerFields(deps: DeadlineDeps, id: string, raw: { responsiblePartyId?: string; professionalPartyId?: string; matterId?: string; priority?: Priority; leadDays?: number[] }): Promise<Result<{ id: string }>> {
  const current = await deps.repo.getDeadline(id);
  if (!current) return failGeneral("Scadenza non trovata");
  const errors = await checkReferences(deps, raw);
  if (Object.keys(errors).length > 0) return fail(errors);
  await deps.repo.updateDeadline(id, {
    responsiblePartyId: raw.responsiblePartyId ?? null,
    professionalPartyId: raw.professionalPartyId ?? null,
    matterId: raw.matterId ?? null,
    priority: raw.priority ?? current.priority,
    leadDays: raw.leadDays ?? current.leadDays,
  });
  await deps.audit.record({ action: "deadline.update", entityType: "deadline", entityId: id, diff: { changed: ["responsiblePartyId", "professionalPartyId", "matterId", "priority", "leadDays"] } });
  return ok({ id });
}

export async function setDeadlineArchived(deps: DeadlineDeps, id: string, archived: boolean): Promise<Result<{ id: string }>> {
  if (!(await deps.repo.setArchived(id, archived))) return failGeneral("Scadenza non trovata");
  await deps.audit.record({ action: archived ? "deadline.archive" : "deadline.restore", entityType: "deadline", entityId: id, diff: {} });
  return ok({ id });
}
