import { fail, failGeneral, ok, zodIssuesToErrors, type Result } from "@/shared/result";
import { completionSchema } from "../domain/deadline";
import type { DeadlineDeps } from "./ports";

async function loadOccurrence(deps: DeadlineDeps, occurrenceId: string) {
  const occurrence = await deps.repo.getOccurrence(occurrenceId);
  if (!occurrence) return null;
  const deadline = await deps.repo.getDeadline(occurrence.deadlineId);
  return deadline ? { occurrence, deadline } : null;
}

export async function addOccurrence(deps: DeadlineDeps, deadlineId: string, dueOn: string): Promise<Result<{ id: string }>> {
  const deadline = await deps.repo.getDeadline(deadlineId);
  if (!deadline) return failGeneral("Scadenza non trovata");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) return fail({ dueOn: ["Data non valida"] });
  const id = await deps.repo.insertOccurrence(deadlineId, dueOn);
  if (!id) return fail({ dueOn: ["Questa data c'è già"] });
  await deps.audit.record({ action: "deadline.occurrence.add", entityType: "deadline", entityId: deadlineId, diff: { dueOn } });
  return ok({ id });
}

/**
 * Chiude una data. Se la scadenza richiede una prova, serve un documento o un riferimento. Chi la attesta (proprietario,
 * verifica automatica, professionista) e' registrato e mostrato: sono tre cose diverse.
 */
export async function completeOccurrence(deps: DeadlineDeps, occurrenceId: string, raw: unknown, today: string): Promise<Result<{ id: string }>> {
  const loaded = await loadOccurrence(deps, occurrenceId);
  if (!loaded) return failGeneral("Data non trovata");
  const parsed = completionSchema.safeParse(raw);
  if (!parsed.success) return fail(zodIssuesToErrors(parsed.error));
  const { occurrence, deadline } = loaded;
  if (occurrence.status === "done") return failGeneral("Questa data è già completata");

  const c = parsed.data;
  if (deadline.proofRequired && !c.documentId && !c.reference) return fail({ reference: ["Per chiudere questa scadenza serve una prova: un documento o un riferimento"] });
  if (c.documentId && !(await deps.others.documentTitles([c.documentId])).has(c.documentId)) return fail({ documentId: ["Il documento non esiste"] });
  if (c.completionKind === "professional_validated" && !deadline.professionalPartyId) {
    return fail({ completionKind: ["Per «validata da un professionista» indica prima il professionista nella scadenza"] });
  }

  await deps.repo.updateOccurrence(occurrenceId, { status: "done", completedOn: c.completedOn ?? today, completionKind: c.completionKind, note: c.note ?? occurrence.note });
  if (c.documentId || c.reference) await deps.repo.addProof(occurrenceId, { documentId: c.documentId, reference: c.reference });
  await deps.audit.record({
    action: "deadline.occurrence.complete",
    entityType: "deadline",
    entityId: deadline.id,
    diff: { occurrenceId, dueOn: occurrence.dueOn, completionKind: c.completionKind, proof: Boolean(c.documentId || c.reference) },
  });
  return ok({ id: deadline.id });
}

/** Chiude tutte le date ancora aperte di una scadenza (es. la rata di un condominio risulta pagata). */
export async function completeOpenOccurrences(deps: DeadlineDeps, deadlineId: string, raw: { completedOn: string; reference: string }, today: string): Promise<Result<{ id: string; completed: number }>> {
  const deadline = await deps.repo.getDeadline(deadlineId);
  if (!deadline) return failGeneral("Scadenza non trovata");
  let completed = 0;
  for (const o of await deps.repo.occurrencesOf(deadlineId)) {
    if (o.status !== "open") continue;
    const done = await completeOccurrence(deps, o.id, { completedOn: raw.completedOn, completionKind: "owner", reference: raw.reference }, today);
    if (done.ok) completed += 1;
  }
  return ok({ id: deadlineId, completed });
}

export async function addProof(deps: DeadlineDeps, occurrenceId: string, raw: { documentId?: string; reference?: string }): Promise<Result<{ id: string }>> {
  const loaded = await loadOccurrence(deps, occurrenceId);
  if (!loaded) return failGeneral("Data non trovata");
  if (!raw.documentId && !raw.reference?.trim()) return fail({ reference: ["Indica un documento o un riferimento"] });
  if (raw.documentId && !(await deps.others.documentTitles([raw.documentId])).has(raw.documentId)) return fail({ documentId: ["Il documento non esiste"] });
  await deps.repo.addProof(occurrenceId, { documentId: raw.documentId, reference: raw.reference?.trim().slice(0, 300) });
  await deps.audit.record({ action: "deadline.proof.add", entityType: "deadline", entityId: loaded.deadline.id, diff: { occurrenceId } });
  return ok({ id: loaded.deadline.id });
}

export async function reopenOccurrence(deps: DeadlineDeps, occurrenceId: string): Promise<Result<{ id: string }>> {
  const loaded = await loadOccurrence(deps, occurrenceId);
  if (!loaded) return failGeneral("Data non trovata");
  await deps.repo.updateOccurrence(occurrenceId, { status: "open", completedOn: null, completionKind: null });
  await deps.audit.record({ action: "deadline.occurrence.reopen", entityType: "deadline", entityId: loaded.deadline.id, diff: { occurrenceId } });
  return ok({ id: loaded.deadline.id });
}

export async function cancelOccurrence(deps: DeadlineDeps, occurrenceId: string): Promise<Result<{ id: string }>> {
  const loaded = await loadOccurrence(deps, occurrenceId);
  if (!loaded) return failGeneral("Data non trovata");
  await deps.repo.updateOccurrence(occurrenceId, { status: "cancelled" });
  await deps.audit.record({ action: "deadline.occurrence.cancel", entityType: "deadline", entityId: loaded.deadline.id, diff: { occurrenceId } });
  return ok({ id: loaded.deadline.id });
}

/** Rinvio: sospende gli avvisi fino a una data futura. La scadenza resta com'e', e se e' passata resta in ritardo. */
export async function snoozeOccurrence(deps: DeadlineDeps, occurrenceId: string, until: string, today: string): Promise<Result<{ id: string }>> {
  const loaded = await loadOccurrence(deps, occurrenceId);
  if (!loaded) return failGeneral("Data non trovata");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || until <= today) return fail({ snoozeUntil: ["Scegli una data futura"] });
  await deps.repo.updateOccurrence(occurrenceId, { snoozedUntil: until });
  await deps.audit.record({ action: "deadline.occurrence.snooze", entityType: "deadline", entityId: loaded.deadline.id, diff: { occurrenceId, until } });
  return ok({ id: loaded.deadline.id });
}
