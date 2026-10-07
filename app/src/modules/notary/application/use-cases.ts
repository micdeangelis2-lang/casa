import { changedKeys } from "@/shared/changed";
import { fail, failGeneral, ok, parseInput, type FieldErrors, type Result } from "@/shared/result";
import { encumbranceSchema, provenanceSchema, type EncumbranceInput, type ProvenanceInput } from "../domain/records";
import type { EncumbranceRow, NotaryDeps, NotaryReadDeps, ProvenanceRow } from "./ports";

type Id = Result<{ id: string }>;
const hasErrors = (e: FieldErrors) => Object.keys(e).length > 0;

async function refs(deps: NotaryDeps, r: { assetId: string; parties: (string | undefined)[]; documentId?: string }): Promise<FieldErrors> {
  const errors: FieldErrors = {};
  if (!(await deps.others.assetExists(r.assetId))) errors.assetId = ["L'immobile non esiste"];
  const wanted = r.parties.filter((x): x is string => Boolean(x));
  if (wanted.length > 0) {
    const known = await deps.others.partyNames();
    if (wanted.some((p) => !known.has(p))) errors.partyId = ["Il contatto non esiste più nella rubrica"];
  }
  if (r.documentId && !(await deps.others.documentTitles([r.documentId])).has(r.documentId)) errors.documentId = ["Il documento non esiste"];
  return errors;
}

const provenanceData = (v: ProvenanceInput): Omit<ProvenanceRow, "id" | "assetId"> => ({
  kind: v.kind,
  occurredOn: v.occurredOn ?? null,
  fromPartyId: v.fromPartyId ?? null,
  notaryPartyId: v.notaryPartyId ?? null,
  deedReference: v.deedReference ?? null,
  documentId: v.documentId ?? null,
  note: v.note ?? null,
});

const encumbranceData = (v: EncumbranceInput): Omit<EncumbranceRow, "id" | "assetId"> => ({
  kind: v.kind,
  title: v.title,
  registeredOn: v.registeredOn ?? null,
  endedOn: v.endedOn ?? null,
  beneficiaryPartyId: v.beneficiaryPartyId ?? null,
  amountCents: v.amount ?? null,
  reference: v.reference ?? null,
  documentId: v.documentId ?? null,
  note: v.note ?? null,
});

/** Registra un titolo di provenienza dell'immobile (dato inserito dal proprietario, non verificato). */
export async function addProvenance(deps: NotaryDeps, raw: unknown): Promise<Id> {
  const p = parseInput(provenanceSchema, raw);
  if (!p.ok) return p;
  const v = p.value;
  const errors = await refs(deps, { assetId: v.assetId, parties: [v.fromPartyId, v.notaryPartyId], documentId: v.documentId });
  if (hasErrors(errors)) return fail(errors);
  const id = await deps.repo.insertProvenance({ assetId: v.assetId, ...provenanceData(v) });
  await deps.audit.record({ action: "notary.provenance.add", entityType: "asset", entityId: v.assetId, diff: { provenanceId: id, kind: v.kind, withDocument: Boolean(v.documentId) } });
  return ok({ id: v.assetId });
}

/** Modifica un titolo di provenienza: stesse regole della registrazione; l'audit riporta solo i nomi dei campi cambiati. */
export async function updateProvenance(deps: NotaryDeps, provenanceId: string, raw: unknown): Promise<Id> {
  const row = await deps.repo.getProvenance(provenanceId);
  if (!row) return failGeneral("Voce non trovata");
  const p = parseInput(provenanceSchema, raw);
  if (!p.ok) return p;
  const v = p.value;
  if (v.assetId !== row.assetId) return failGeneral("Voce non trovata");
  const errors = await refs(deps, { assetId: v.assetId, parties: [v.fromPartyId, v.notaryPartyId], documentId: v.documentId });
  if (hasErrors(errors)) return fail(errors);
  const data = provenanceData(v);
  await deps.repo.updateProvenance(provenanceId, data);
  await deps.audit.record({ action: "notary.provenance.update", entityType: "asset", entityId: row.assetId, diff: { provenanceId, changed: changedKeys(row, { ...row, ...data }) } });
  return ok({ id: row.assetId });
}

export async function removeProvenance(deps: NotaryDeps, provenanceId: string): Promise<Id> {
  const row = await deps.repo.getProvenance(provenanceId);
  if (!row) return failGeneral("Voce non trovata");
  await deps.repo.deleteProvenance(provenanceId);
  await deps.audit.record({ action: "notary.provenance.remove", entityType: "asset", entityId: row.assetId, diff: { provenanceId } });
  return ok({ id: row.assetId });
}

/** Registra un gravame o vincolo dell'immobile (dato inserito dal proprietario: l'app non consulta registri). */
export async function addEncumbrance(deps: NotaryDeps, raw: unknown): Promise<Id> {
  const p = parseInput(encumbranceSchema, raw);
  if (!p.ok) return p;
  const v = p.value;
  const errors = await refs(deps, { assetId: v.assetId, parties: [v.beneficiaryPartyId], documentId: v.documentId });
  if (hasErrors(errors)) return fail(errors);
  const id = await deps.repo.insertEncumbrance({ assetId: v.assetId, ...encumbranceData(v) });
  await deps.audit.record({ action: "notary.encumbrance.add", entityType: "asset", entityId: v.assetId, diff: { encumbranceId: id, kind: v.kind, withDocument: Boolean(v.documentId) } });
  return ok({ id: v.assetId });
}

/** Modifica un gravame o vincolo: stesse regole della registrazione; l'audit riporta solo i nomi dei campi cambiati. */
export async function updateEncumbrance(deps: NotaryDeps, encumbranceId: string, raw: unknown): Promise<Id> {
  const row = await deps.repo.getEncumbrance(encumbranceId);
  if (!row) return failGeneral("Voce non trovata");
  const p = parseInput(encumbranceSchema, raw);
  if (!p.ok) return p;
  const v = p.value;
  if (v.assetId !== row.assetId) return failGeneral("Voce non trovata");
  const errors = await refs(deps, { assetId: v.assetId, parties: [v.beneficiaryPartyId], documentId: v.documentId });
  if (hasErrors(errors)) return fail(errors);
  const data = encumbranceData(v);
  await deps.repo.updateEncumbrance(encumbranceId, data);
  await deps.audit.record({ action: "notary.encumbrance.update", entityType: "asset", entityId: row.assetId, diff: { encumbranceId, changed: changedKeys(row, { ...row, ...data }) } });
  return ok({ id: row.assetId });
}

export async function removeEncumbrance(deps: NotaryDeps, encumbranceId: string): Promise<Id> {
  const row = await deps.repo.getEncumbrance(encumbranceId);
  if (!row) return failGeneral("Voce non trovata");
  await deps.repo.deleteEncumbrance(encumbranceId);
  await deps.audit.record({ action: "notary.encumbrance.remove", entityType: "asset", entityId: row.assetId, diff: { encumbranceId } });
  return ok({ id: row.assetId });
}

export type ProvenanceItem = ProvenanceRow & { fromName: string | null; notaryName: string | null; documentTitle: string | null };
export type EncumbranceItem = EncumbranceRow & { beneficiaryName: string | null; documentTitle: string | null };

export async function listProvenances(deps: NotaryReadDeps, assetId: string): Promise<ProvenanceItem[]> {
  const [rows, parties, titles] = await Promise.all([deps.repo.provenances(assetId), deps.others.partyNames(), deps.others.documentTitles()]);
  return rows.map((r) => ({ ...r, fromName: r.fromPartyId ? (parties.get(r.fromPartyId) ?? null) : null, notaryName: r.notaryPartyId ? (parties.get(r.notaryPartyId) ?? null) : null, documentTitle: r.documentId ? (titles.get(r.documentId) ?? null) : null }));
}

export async function listEncumbrances(deps: NotaryReadDeps, assetId: string): Promise<EncumbranceItem[]> {
  const [rows, parties, titles] = await Promise.all([deps.repo.encumbrances(assetId), deps.others.partyNames(), deps.others.documentTitles()]);
  return rows.map((r) => ({ ...r, beneficiaryName: r.beneficiaryPartyId ? (parties.get(r.beneficiaryPartyId) ?? null) : null, documentTitle: r.documentId ? (titles.get(r.documentId) ?? null) : null }));
}
