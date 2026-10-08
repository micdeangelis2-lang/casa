import { fail, failGeneral, ok, parseInput, type FieldErrors, type Result } from "@/shared/result";
import { condominiumInputSchema, membershipSchema, millesimalTableSchema, otherSharesSchema, sharesSchema } from "../domain/condominium";
import { parseMilli, tableTotals } from "../domain/millesimi";
import type { CondoDeps } from "./ports";
import { hasErrors, refs, type Id } from "./shared";

// -------------------------------------------------------------------------------------------------- condominio e membri

export async function createCondominium(deps: CondoDeps, raw: unknown): Promise<Id> {
  const p = parseInput(condominiumInputSchema, raw);
  if (!p.ok) return p;
  const errors = await refs(deps, { parties: [p.value.administratorPartyId] });
  if (hasErrors(errors)) return fail({ administratorPartyId: errors.partyId! });
  const id = await deps.repo.insertCondominium({ name: p.value.name, address: p.value.address ?? null, taxCode: p.value.taxCode ?? null, administratorPartyId: p.value.administratorPartyId ?? null, notes: p.value.notes ?? null, archived: false });
  await deps.audit.record({ action: "condominium.create", entityType: "condominium", entityId: id, diff: {} });
  return ok({ id });
}

export async function updateCondominium(deps: CondoDeps, id: string, raw: unknown): Promise<Id> {
  const p = parseInput(condominiumInputSchema, raw);
  if (!p.ok) return p;
  if (!(await deps.repo.getCondominium(id))) return failGeneral("Condominio non trovato");
  const errors = await refs(deps, { parties: [p.value.administratorPartyId] });
  if (hasErrors(errors)) return fail({ administratorPartyId: errors.partyId! });
  await deps.repo.updateCondominium(id, { name: p.value.name, address: p.value.address ?? null, taxCode: p.value.taxCode ?? null, administratorPartyId: p.value.administratorPartyId ?? null, notes: p.value.notes ?? null });
  await deps.audit.record({ action: "condominium.update", entityType: "condominium", entityId: id, diff: {} });
  return ok({ id });
}

export async function setCondominiumArchived(deps: CondoDeps, id: string, archived: boolean): Promise<Id> {
  if (!(await deps.repo.updateCondominium(id, { archived }))) return failGeneral("Condominio non trovato");
  await deps.audit.record({ action: archived ? "condominium.archive" : "condominium.restore", entityType: "condominium", entityId: id, diff: {} });
  return ok({ id });
}

export async function addMember(deps: CondoDeps, condoId: string, raw: unknown): Promise<Id> {
  const p = parseInput(membershipSchema, raw);
  if (!p.ok) return p;
  if (!(await deps.repo.getCondominium(condoId))) return failGeneral("Condominio non trovato");
  if (!(await deps.others.assets()).some((a) => a.id === p.value.assetId)) return fail({ assetId: ["L'immobile non esiste"] });
  const other = await deps.repo.condominiumOfAsset(p.value.assetId);
  if (other) return fail({ assetId: [other === condoId ? "Questo immobile fa già parte del condominio" : "Questo immobile fa già parte di un altro condominio"] });
  await deps.repo.addMember(condoId, p.value.assetId, p.value.unitLabel ?? null);
  await deps.audit.record({ action: "condominium.member.add", entityType: "condominium", entityId: condoId, diff: { assetId: p.value.assetId } });
  return ok({ id: condoId });
}

export async function removeMember(deps: CondoDeps, condoId: string, assetId: string): Promise<Id> {
  if (!(await deps.repo.getCondominium(condoId))) return failGeneral("Condominio non trovato");
  await deps.repo.removeMember(condoId, assetId);
  await deps.audit.record({ action: "condominium.member.remove", entityType: "condominium", entityId: condoId, diff: { assetId } });
  return ok({ id: condoId });
}

// -------------------------------------------------------------------------------------------------- millesimi

export async function createTable(deps: CondoDeps, condoId: string, raw: unknown): Promise<Id> {
  const p = parseInput(millesimalTableSchema, raw);
  if (!p.ok) return p;
  if (!(await deps.repo.getCondominium(condoId))) return failGeneral("Condominio non trovato");
  const id = await deps.repo.insertTable(condoId, { name: p.value.name, note: p.value.note ?? null });
  await deps.audit.record({ action: "condominium.table.create", entityType: "condominium", entityId: condoId, diff: { tableId: id } });
  return ok({ id: condoId });
}

/** Sostituisce i valori di una tabella. Gli immobili devono far parte del condominio. La somma non e' imposta: si mostra. */
export async function saveShares(deps: CondoDeps, tableId: string, raw: unknown): Promise<Result<{ id: string; total: number; differsFromThousand: boolean }>> {
  const p = parseInput(sharesSchema, raw);
  if (!p.ok) return p;
  const table = await deps.repo.getTable(tableId);
  if (!table) return failGeneral("Tabella non trovata");
  const members = new Set((await deps.repo.members(table.condominiumId)).map((m) => m.assetId));
  const errors: FieldErrors = {};
  const rows: { assetId: string; milli: number }[] = [];
  p.value.forEach((s, i) => {
    if (s.value === "") return;
    const milli = parseMilli(s.value);
    if (milli === null) (errors[`shares.${i}`] ??= []).push("Millesimi non validi (es. 48,25)");
    else if (!members.has(s.assetId)) (errors[`shares.${i}`] ??= []).push("L'immobile non fa parte del condominio");
    else rows.push({ assetId: s.assetId, milli });
  });
  if (hasErrors(errors)) return fail(errors);
  await deps.repo.replaceShares(tableId, rows);
  const totals = tableTotals(rows.map((r) => r.milli));
  await deps.audit.record({ action: "condominium.shares.save", entityType: "condominium", entityId: table.condominiumId, diff: { tableId, rows: rows.length, differsFromThousand: totals.differsFromThousand } });
  return ok({ id: table.condominiumId, ...totals });
}

/**
 * Sostituisce i millesimi delle unita' degli ALTRI condomini di una tabella (una riga per voce). Servono al totale del palazzo
 * dei preventivi «del palazzo». Righe senza nome e senza valore si ignorano; la somma con quella del proprietario non e' imposta.
 */
export async function saveOtherShares(deps: CondoDeps, tableId: string, raw: unknown): Promise<Result<{ id: string; total: number }>> {
  const p = parseInput(otherSharesSchema, raw);
  if (!p.ok) return p;
  const table = await deps.repo.getTable(tableId);
  if (!table) return failGeneral("Tabella non trovata");
  const errors: FieldErrors = {};
  const rows: { label: string; milli: number }[] = [];
  p.value.forEach((s, i) => {
    if (s.value === "" && s.label === "") return;
    const milli = s.value === "" ? null : parseMilli(s.value);
    if (milli === null) (errors[`others.${i}`] ??= []).push("Millesimi non validi (es. 48,25)");
    else if (s.label === "") (errors[`others.${i}`] ??= []).push("Scrivi il nome della voce (per esempio «Altri condomini»)");
    else rows.push({ label: s.label, milli });
  });
  if (hasErrors(errors)) return fail(errors);
  await deps.repo.replaceOthers(tableId, rows);
  await deps.audit.record({ action: "condominium.others.save", entityType: "condominium", entityId: table.condominiumId, diff: { tableId, rows: rows.length } });
  return ok({ id: table.condominiumId, total: rows.reduce((n, r) => n + r.milli, 0) });
}
