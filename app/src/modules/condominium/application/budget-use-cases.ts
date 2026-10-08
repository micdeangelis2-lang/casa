import { fail, failGeneral, ok, parseInput, type Result } from "@/shared/result";
import { budgetSchema, fiscalYearSchema, installmentPlanSchema, isPaid, paymentSchema } from "../domain/condominium";
import { allocateOwnerParts, installmentDates, splitEvenly } from "../domain/millesimi";
import type { CondoDeps, InstallmentRow } from "./ports";
import { hasErrors, refs, type Id } from "./shared";

// -------------------------------------------------------------------------------------------------- esercizi, preventivi, rate

export async function createFiscalYear(deps: CondoDeps, condoId: string, raw: unknown): Promise<Id> {
  const p = parseInput(fiscalYearSchema, raw);
  if (!p.ok) return p;
  if (!(await deps.repo.getCondominium(condoId))) return failGeneral("Condominio non trovato");
  const id = await deps.repo.insertYear(condoId, p.value);
  await deps.audit.record({ action: "condominium.year.create", entityType: "condominium", entityId: condoId, diff: { yearId: id } });
  return ok({ id: condoId });
}

export async function createBudget(deps: CondoDeps, yearId: string, raw: unknown): Promise<Id> {
  const p = parseInput(budgetSchema, raw);
  if (!p.ok) return p;
  const year = await deps.repo.getYear(yearId);
  if (!year) return failGeneral("Esercizio non trovato");
  if (p.value.millesimalTableId) {
    const table = await deps.repo.getTable(p.value.millesimalTableId);
    if (!table || table.condominiumId !== year.condominiumId) return fail({ millesimalTableId: ["La tabella non è di questo condominio"] });
  }
  const errors = await refs(deps, { documents: [p.value.documentId] });
  if (hasErrors(errors)) return fail(errors);
  const id = await deps.repo.insertBudget(yearId, { kind: p.value.kind, title: p.value.title, totalCents: p.value.total, millesimalTableId: p.value.millesimalTableId ?? null, scope: p.value.scope, note: p.value.note ?? null, documentId: p.value.documentId ?? null });
  await deps.audit.record({ action: "condominium.budget.create", entityType: "condominium", entityId: year.condominiumId, diff: { budgetId: id, kind: p.value.kind, scope: p.value.scope } });
  return ok({ id: year.condominiumId });
}

/**
 * Ripartisce un preventivo tra gli immobili del condominio in proporzione ai millesimi della tabella scelta (resto maggiore) e
 * divide ogni quota in rate. Se il totale e' del solo proprietario (`owner_only`, predefinito) la somma delle quote e' esattamente
 * il totale; se e' del palazzo (`building`) il totale si divide per il totale del palazzo (millesimi del proprietario piu' quelli
 * degli altri registrati, almeno 1000) e il proprietario riceve solo la sua parte. Le cifre sono un'ipotesi di ripartizione
 * calcolata sui dati inseriti: non sostituiscono quelle dell'amministratore.
 */
export async function generateInstallments(deps: CondoDeps, budgetId: string, raw: unknown): Promise<Result<{ id: string; created: number; shareTotalCents: number }>> {
  const p = parseInput(installmentPlanSchema, raw);
  if (!p.ok) return p;
  const budget = await deps.repo.getBudget(budgetId);
  if (!budget) return failGeneral("Preventivo non trovato");
  if (!budget.millesimalTableId) return fail({ _: ["Scegli prima la tabella millesimale del preventivo"] });
  const year = await deps.repo.getYear(budget.fiscalYearId);
  const shares = await deps.repo.shares(budget.millesimalTableId);
  if (shares.length === 0) return fail({ _: ["La tabella millesimale non ha ancora valori"] });
  const existing = await deps.repo.installments(budgetId);
  if (existing.some((i) => i.paidCents > 0)) return fail({ _: ["Ci sono rate già pagate: non si può rigenerare il piano"] });

  // Quota di ogni immobile (su TUTTI i millesimi della tabella), poi in rate. Il totale ripartito e' quello del preventivo.
  const othersMilli = budget.scope === "building" ? (await deps.repo.others(budget.millesimalTableId)).reduce((n, o) => n + o.milli, 0) : 0;
  const parts = allocateOwnerParts(budget.totalCents, shares.map((s) => s.milli), budget.scope, othersMilli);
  const dates = installmentDates(p.value.firstDueOn, p.value.count, p.value.everyMonths);
  const names = new Map((await deps.others.assets()).map((a) => [a.id, a.name]));
  for (const row of existing) if (row.deadlineId) await deps.others.archiveDeadline(row.deadlineId);
  await deps.repo.deleteInstallments(budgetId);

  const rows: Omit<InstallmentRow, "id">[] = [];
  shares.forEach((share, i) => {
    splitEvenly(parts[i]!, p.value.count).forEach((amount, n) => rows.push({ budgetId, assetId: share.assetId, number: n + 1, dueOn: dates[n]!, amountCents: amount, paidCents: 0, paidOn: null, documentId: null, deadlineId: null }));
  });
  const ids = await deps.repo.insertInstallments(rows);

  if (p.value.createDeadlines) {
    for (const [index, row] of rows.entries()) {
      if (row.amountCents === 0) continue;
      const deadlineId = await deps.others.createDeadline({ title: `Rata ${row.number}/${p.value.count} – ${budget.title}${names.get(row.assetId) ? ` (${names.get(row.assetId)})` : ""}`, dueOn: row.dueOn, assetId: row.assetId, level: "condominium", category: "condominium" });
      if (deadlineId) await deps.repo.updateInstallment(ids[index]!, { deadlineId });
    }
  }
  await deps.audit.record({ action: "condominium.installments.generate", entityType: "condominium", entityId: year?.condominiumId ?? budgetId, diff: { budgetId, rows: rows.length, deadlines: p.value.createDeadlines } });
  return ok({ id: year?.condominiumId ?? budgetId, created: rows.length, shareTotalCents: parts.reduce((a, b) => a + b, 0) });
}

export async function recordPayment(deps: CondoDeps, installmentId: string, raw: unknown, today: string): Promise<Id> {
  const p = parseInput(paymentSchema, raw);
  if (!p.ok) return p;
  const installment = await deps.repo.getInstallment(installmentId);
  if (!installment) return failGeneral("Rata non trovata");
  const errors = await refs(deps, { documents: [p.value.documentId] });
  if (hasErrors(errors)) return fail(errors);
  const paidOn = p.value.paidOn ?? today;
  // La prova resta quella gia' collegata se non ne indichi una nuova; senza importo pagato non c'e' prova da tenere.
  const documentId = p.value.paid > 0 ? (p.value.documentId ?? installment.documentId) : null;
  await deps.repo.updateInstallment(installmentId, { paidCents: p.value.paid, paidOn: p.value.paid > 0 ? paidOn : null, documentId });
  if (installment.deadlineId && isPaid({ amountCents: installment.amountCents, paidCents: p.value.paid })) {
    await deps.others.completeDeadline(installment.deadlineId, { completedOn: paidOn, reference: "Rata registrata come pagata" });
  }
  await deps.audit.record({ action: "condominium.installment.pay", entityType: "condominium", entityId: installmentId, diff: { fullyPaid: isPaid({ amountCents: installment.amountCents, paidCents: p.value.paid }), withProof: documentId !== null } });
  return ok({ id: installmentId });
}
