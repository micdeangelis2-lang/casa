import { sameJson } from "@/shared/json";
import { DEFAULT_LEAD_DAYS } from "../domain/deadline";
import type { DeadlineDeps, DeadlineRow, DerivedDeadline, NewDeadline } from "./ports";
import { materialize } from "./definitions";

/**
 * Allinea le scadenze derivate dalle regole per un bene (come per le voci del dossier): crea le nuove, aggiorna la derivazione
 * di quelle esistenti, segna «da rivedere» quelle che le regole non producono piu'. Non cancella nulla e non tocca
 * responsabile, professionista, preavvisi, stato e prove scelti dal proprietario.
 */
export async function syncDerivedDeadlines(deps: DeadlineDeps, assetId: string, derived: DerivedDeadline[], today: string): Promise<{ created: number; updated: number; staled: number; restored: number; occurrences: number }> {
  const existing = new Map((await deps.repo.derivedFor(assetId)).map((d) => [`${d.ruleKey}/${d.outcomeKey}`, d]));
  const counts = { created: 0, updated: 0, staled: 0, restored: 0, occurrences: 0 };
  const wanted = new Set<string>();

  for (const item of derived) {
    const identity = `${item.ruleKey}/${item.outcomeKey}`;
    wanted.add(identity);
    const fields = {
      title: item.title,
      category: item.category,
      level: item.level,
      legalBasis: item.legalBasis,
      calc: item.calc,
      shiftToBusinessDay: item.shiftToBusinessDay,
      consequences: item.consequences,
      requiredDocuments: item.requiredDocuments,
      proofRequired: item.proofRequired,
      ruleVersionId: item.versionId,
      explanation: item.explanation,
    };
    const row = existing.get(identity);
    let current: DeadlineRow;
    if (!row) {
      const data: NewDeadline = {
        ...fields,
        description: null,
        assetId,
        responsiblePartyId: null,
        professionalPartyId: null,
        matterId: null,
        priority: item.priority,
        leadDays: DEFAULT_LEAD_DAYS[item.priority],
        origin: "rule",
        ruleKey: item.ruleKey,
        outcomeKey: item.outcomeKey,
      };
      const id = await deps.repo.insertDeadline(data);
      current = { ...data, id, stale: false, archived: false };
      counts.created += 1;
    } else {
      current = row;
      const changed = (Object.keys(fields) as (keyof typeof fields)[]).some((k) => !sameJson(fields[k], row[k]));
      if (changed) {
        await deps.repo.updateDeadline(row.id, fields);
        current = { ...row, ...fields };
        counts.updated += 1;
      }
      if (row.stale) {
        await deps.repo.updateDeadline(row.id, { stale: false });
        current = { ...current, stale: false };
        counts.restored += 1;
      }
    }
    counts.occurrences += (await materialize(deps, current, today)).created;
  }
  for (const [identity, row] of existing) {
    if (!wanted.has(identity) && !row.stale) {
      await deps.repo.updateDeadline(row.id, { stale: true });
      counts.staled += 1;
    }
  }
  if (counts.created + counts.updated + counts.staled + counts.restored > 0) {
    await deps.audit.record({ action: "deadline.sync", entityType: "asset", entityId: assetId, diff: { ...counts } });
  }
  return counts;
}
