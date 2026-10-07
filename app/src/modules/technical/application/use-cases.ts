import { buildBrief, type BriefSource, type TechnicalBrief } from "../domain/brief";

/** Letture dei moduli vicini di cui la scheda ha bisogno (fornite dall'index del modulo). */
export interface TechnicalCollaborators {
  /** Tutto cio' che risulta per il bene, gia' ridotto ai campi della scheda; nullo se il bene non esiste. */
  source(assetId: string): Promise<BriefSource | null>;
}

export type TechnicalReadDeps = { others: TechnicalCollaborators };

/** Scheda per il tecnico di un bene, alla data indicata. Sola lettura. */
export async function getTechnicalBrief(deps: TechnicalReadDeps, assetId: string, today: string): Promise<TechnicalBrief | null> {
  const source = await deps.others.source(assetId);
  return source ? buildBrief(source, today) : null;
}
