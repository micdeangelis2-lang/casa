import type { AuditRecorder } from "@/platform/audit";
import { periodState, type PeriodState } from "@/shared/dates";
import { changedKeys } from "@/shared/changed";
import { fail, failGeneral, ok, parseInput, type Result } from "@/shared/result";
import { competenceSchema, type CompetenceInput, type CompetenceRow } from "../domain/competence";

export interface CompetenceRepository {
  list(partyId: string): Promise<CompetenceRow[]>;
  insert(d: Omit<CompetenceRow, "id">): Promise<string>;
  update(id: string, d: Omit<CompetenceRow, "id" | "partyId">): Promise<void>;
  get(id: string): Promise<CompetenceRow | null>;
  delete(id: string): Promise<void>;
  partyExists(partyId: string): Promise<boolean>;
  documentExists(documentId: string): Promise<boolean>;
}

export type CompetenceDeps = { repo: CompetenceRepository; audit: AuditRecorder };

type Id = Result<{ id: string }>;

const competenceData = (v: CompetenceInput): Omit<CompetenceRow, "id" | "partyId"> => ({
  kind: v.kind,
  label: v.label,
  reference: v.reference ?? null,
  issuer: v.issuer ?? null,
  validFrom: v.validFrom ?? null,
  validUntil: v.validUntil ?? null,
  documentId: v.documentId ?? null,
  note: v.note ?? null,
});

/** Registra una competenza di un contatto (dato scritto dal proprietario, non verificato). */
export async function addCompetence(deps: CompetenceDeps, partyId: string, raw: unknown): Promise<Id> {
  const p = parseInput(competenceSchema, raw);
  if (!p.ok) return p;
  if (!(await deps.repo.partyExists(partyId))) return failGeneral("Contatto non trovato");
  const v = p.value;
  if (v.documentId && !(await deps.repo.documentExists(v.documentId))) return fail({ documentId: ["Il documento non esiste"] });
  const id = await deps.repo.insert({ partyId, ...competenceData(v) });
  await deps.audit.record({ action: "directory.competence.add", entityType: "party", entityId: partyId, diff: { competenceId: id, kind: v.kind, withDocument: Boolean(v.documentId) } });
  return ok({ id: partyId });
}

/** Modifica una competenza: stesse regole della registrazione; l'audit riporta solo i nomi dei campi cambiati. */
export async function updateCompetence(deps: CompetenceDeps, competenceId: string, raw: unknown): Promise<Id> {
  const row = await deps.repo.get(competenceId);
  if (!row) return failGeneral("Voce non trovata");
  const p = parseInput(competenceSchema, raw);
  if (!p.ok) return p;
  const v = p.value;
  if (v.documentId && !(await deps.repo.documentExists(v.documentId))) return fail({ documentId: ["Il documento non esiste"] });
  const data = competenceData(v);
  await deps.repo.update(competenceId, data);
  await deps.audit.record({ action: "directory.competence.update", entityType: "party", entityId: row.partyId, diff: { competenceId, changed: changedKeys(row, { ...row, ...data }) } });
  return ok({ id: row.partyId });
}

export async function removeCompetence(deps: CompetenceDeps, competenceId: string): Promise<Id> {
  const row = await deps.repo.get(competenceId);
  if (!row) return failGeneral("Voce non trovata");
  await deps.repo.delete(competenceId);
  await deps.audit.record({ action: "directory.competence.remove", entityType: "party", entityId: row.partyId, diff: { competenceId } });
  return ok({ id: row.partyId });
}

export type CompetenceItem = CompetenceRow & { state: PeriodState };

/** Le competenze di un contatto; lo stato dice solo dove cade la data di fine scritta rispetto a oggi. */
export async function listCompetences(deps: Pick<CompetenceDeps, "repo">, partyId: string, today: string): Promise<CompetenceItem[]> {
  return (await deps.repo.list(partyId)).map((c) => ({ ...c, state: periodState({ startsOn: c.validFrom, endsOn: c.validUntil }, today) }));
}
