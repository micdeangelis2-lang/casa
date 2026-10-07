import { changedKeys } from "@/shared/changed";
import { fail, failGeneral, ok, parseInput, type FieldErrors, type Result } from "@/shared/result";
import { COMPENSATION_LABEL, MANDATE_PREFIX, mandateSchema, mandateState, type MandateInput, type MandateLine } from "../domain/management";
import type { MandateDeps, MandateReadDeps } from "./ports";

/**
 * I mandati di gestione sono dati veri (`management_mandate`): il gestore dalla rubrica, le date, il compenso come testo scritto
 * dal proprietario e, se serve, un documento. La scadenza di fine mandato e' solo il promemoria collegato: rinominarla o archiviarla
 * non cambia il mandato.
 */

type Resolved = { managerName: string; assetName: string | null };

/** Controlla i riferimenti (gestore, immobile, documento) e restituisce i nomi che servono al promemoria collegato. */
async function resolveRefs(deps: MandateDeps, v: MandateInput): Promise<Result<Resolved>> {
  const errors: FieldErrors = {};
  const parties = await deps.others.partyNames();
  const managerName = parties.get(v.managerPartyId);
  if (!managerName) errors.managerPartyId = ["Il contatto non esiste più nella rubrica"];
  let assetName: string | null = null;
  if (v.assetId) {
    assetName = (await deps.others.assetNames()).get(v.assetId) ?? null;
    if (!assetName) errors.assetId = ["L'immobile non esiste"];
  }
  if (v.documentId && !(await deps.others.documentTitles([v.documentId])).has(v.documentId)) errors.documentId = ["Il documento non esiste"];
  if (Object.keys(errors).length > 0) return fail(errors);
  return ok({ managerName: managerName!, assetName });
}

/** Titolo e descrizione del promemoria di fine mandato. */
const reminderTexts = (v: MandateInput, r: Resolved) => ({
  title: `${MANDATE_PREFIX}: ${r.managerName}${r.assetName ? ` (${r.assetName})` : ""}`,
  description: [v.compensation ? `${COMPENSATION_LABEL}${v.compensation}` : null, v.note ?? null].filter(Boolean).join("\n"),
});

const mandateData = (v: MandateInput) => ({
  assetId: v.assetId ?? null,
  managerPartyId: v.managerPartyId,
  startsOn: v.startsOn ?? null,
  endsOn: v.endsOn,
  compensation: v.compensation ?? null,
  documentId: v.documentId ?? null,
  note: v.note ?? null,
});

/** Registra un mandato e la scadenza di fine collegata. Restituisce l'id del mandato. */
export async function createMandate(deps: MandateDeps, raw: unknown): Promise<Result<{ id: string }>> {
  const p = parseInput(mandateSchema, raw);
  if (!p.ok) return p;
  const v = p.value;
  const resolved = await resolveRefs(deps, v);
  if (!resolved.ok) return resolved;

  const deadlineId = await deps.others.createEndDeadline({ ...reminderTexts(v, resolved.value), assetId: v.assetId ?? null, managerPartyId: v.managerPartyId, endsOn: v.endsOn });
  if (!deadlineId) return failGeneral("Non è stato possibile registrare il mandato");
  const id = await deps.repo.insert({ ...mandateData(v), deadlineId, archived: false });
  await deps.audit.record({ action: "management.mandate.create", entityType: "management_mandate", entityId: id, diff: { hasCompensation: Boolean(v.compensation), hasAsset: Boolean(v.assetId), deadlineId } });
  return ok({ id });
}

/**
 * Modifica un mandato (gestore, immobile, date, compenso, documento, note): stesse regole della registrazione. La scadenza di
 * fine collegata segue (titolo, descrizione e, se la data di fine cambia, la data ancora aperta).
 */
export async function updateMandate(deps: MandateDeps, id: string, raw: unknown): Promise<Result<{ id: string }>> {
  const row = await deps.repo.get(id);
  if (!row) return failGeneral("Mandato non trovato");
  const p = parseInput(mandateSchema, raw);
  if (!p.ok) return p;
  const v = p.value;
  const resolved = await resolveRefs(deps, v);
  if (!resolved.ok) return resolved;
  const data = mandateData(v);
  await deps.repo.update(id, data);
  if (row.deadlineId) await deps.others.updateEndDeadline({ deadlineId: row.deadlineId, ...reminderTexts(v, resolved.value), assetId: data.assetId, managerPartyId: data.managerPartyId, previousEndsOn: row.endsOn, endsOn: v.endsOn });
  await deps.audit.record({ action: "management.mandate.update", entityType: "management_mandate", entityId: id, diff: { changed: changedKeys(row, { ...row, ...data }) } });
  return ok({ id });
}

/** Archivia un mandato (o lo ripristina); la scadenza collegata segue. */
export async function setMandateArchived(deps: MandateDeps, id: string, archived: boolean): Promise<Result<{ id: string }>> {
  const mandate = await deps.repo.get(id);
  if (!mandate) return failGeneral("Mandato non trovato");
  await deps.repo.update(id, { archived });
  if (mandate.deadlineId) await deps.others.archiveDeadline(mandate.deadlineId, archived);
  await deps.audit.record({ action: archived ? "management.mandate.archive" : "management.mandate.restore", entityType: "management_mandate", entityId: id, diff: {} });
  return ok({ id });
}

/** I mandati non archiviati (di un immobile, piu' quelli per tutti gli immobili), con lo stato dalla data di fine scritta. */
export async function listMandates(deps: MandateReadDeps, today: string, assetId?: string): Promise<MandateLine[]> {
  const [rows, parties, assets, titles] = await Promise.all([deps.repo.list({ includeArchived: false }), deps.others.partyNames(), deps.others.assetNames(), deps.others.documentTitles()]);
  return rows
    .filter((m) => !assetId || m.assetId === assetId || m.assetId === null)
    .map((m): MandateLine => {
      const managerName = m.managerPartyId ? (parties.get(m.managerPartyId) ?? null) : null;
      const assetName = m.assetId ? (assets.get(m.assetId) ?? null) : null;
      return {
        id: m.id,
        managerPartyId: m.managerPartyId,
        assetId: m.assetId,
        documentId: m.documentId,
        note: m.note,
        title: `${MANDATE_PREFIX}${managerName ? `: ${managerName}` : ""}${assetName ? ` (${assetName})` : ""}`,
        managerName,
        assetName,
        startsOn: m.startsOn,
        endsOn: m.endsOn,
        compensation: m.compensation,
        deadlineId: m.deadlineId,
        documentTitle: m.documentId ? (titles.get(m.documentId) ?? null) : null,
        state: mandateState(m.endsOn, today),
      };
    })
    .sort((a, b) => (a.endsOn ?? "9999").localeCompare(b.endsOn ?? "9999"));
}
