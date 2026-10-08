import { fail, failGeneral, ok, parseInput } from "@/shared/result";
import { ENTRY_KINDS, invoiceSchema, progressSchema, type EntryKind } from "../domain/maintenance";
import { hasErrors, refs, type Id } from "./common";
import type { InvoiceRow, MaintenanceDeps, ProgressRow, QuoteRow } from "./ports";

// -------------------------------------------------------------------------------------------------- fatture e avanzamenti

export async function addInvoice(deps: MaintenanceDeps, workId: string, raw: unknown): Promise<Id> {
  const p = parseInput(invoiceSchema, raw);
  if (!p.ok) return p;
  if (!(await deps.repo.getWork(workId))) return failGeneral("Intervento non trovato");
  const errors = await refs(deps, { documents: [p.value.documentId] });
  if (hasErrors(errors)) return fail(errors);
  const v = p.value;
  const id = await deps.repo.insertInvoice({ workId, number: v.number ?? null, issuedOn: v.issuedOn, amountCents: v.amount, paidOn: v.paidOn ?? null, documentId: v.documentId ?? null, note: v.note ?? null });
  await deps.audit.record({ action: "maintenance.invoice.add", entityType: "maint_work", entityId: workId, diff: { invoiceId: id, paid: Boolean(v.paidOn) } });
  return ok({ id: workId });
}

/** Segna una fattura come pagata (con la data) o di nuovo da pagare (data nulla). */
export async function setInvoicePaid(deps: MaintenanceDeps, invoiceId: string, paidOn: string | null): Promise<Id> {
  if (paidOn !== null && !/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) return fail({ paidOn: ["Data non valida"] });
  const invoice = await deps.repo.getInvoice(invoiceId);
  if (!invoice) return failGeneral("Fattura non trovata");
  await deps.repo.updateInvoice(invoiceId, { paidOn });
  await deps.audit.record({ action: "maintenance.invoice.paid", entityType: "maint_work", entityId: invoice.workId, diff: { invoiceId, paid: paidOn !== null } });
  return ok({ id: invoice.workId });
}

export async function addProgress(deps: MaintenanceDeps, workId: string, raw: unknown, today: string): Promise<Id> {
  const p = parseInput(progressSchema, raw);
  if (!p.ok) return p;
  if (!(await deps.repo.getWork(workId))) return failGeneral("Intervento non trovato");
  const id = await deps.repo.insertProgress({ workId, recordedOn: p.value.recordedOn ?? today, percent: p.value.percent ?? null, note: p.value.note });
  await deps.audit.record({ action: "maintenance.progress.add", entityType: "maint_work", entityId: workId, diff: { progressId: id, withPercent: p.value.percent !== undefined } });
  return ok({ id: workId });
}

/** Toglie una voce registrata per errore (preventivo, fattura o avanzamento). */
export async function removeEntry(deps: MaintenanceDeps, kind: string, entryId: string): Promise<Id> {
  if (!(ENTRY_KINDS as readonly string[]).includes(kind)) return failGeneral("Tipo di voce non valido");
  const entryKind = kind as EntryKind;
  const row: QuoteRow | InvoiceRow | ProgressRow | null = entryKind === "quote" ? await deps.repo.getQuote(entryId) : entryKind === "invoice" ? await deps.repo.getInvoice(entryId) : await deps.repo.getProgress(entryId);
  if (!row) return failGeneral("Voce non trovata");
  if (entryKind === "quote") await deps.repo.deleteQuote(entryId);
  else if (entryKind === "invoice") await deps.repo.deleteInvoice(entryId);
  else await deps.repo.deleteProgress(entryId);
  await deps.audit.record({ action: "maintenance.entry.remove", entityType: "maint_work", entityId: row.workId, diff: { kind: entryKind, entryId } });
  return ok({ id: row.workId });
}
