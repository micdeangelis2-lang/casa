import type { AuditRecorder } from "@/platform/audit";
import type { IstatRow } from "../domain/istat";
import type { Territory, TerritoryKind, TerritoryOption } from "../domain/territory";

export type NewTerritory = {
  kind: TerritoryKind;
  parentId: string | null;
  name: string;
  code?: string;
  cadastralCode?: string;
  provinceSigla?: string;
  source: "manual" | "istat";
};

export interface TerritoryRepository {
  get(id: string): Promise<Territory | null>;
  /** Territori con etichetta completa, per id (quelli inesistenti vengono omessi). */
  getMany(ids: string[]): Promise<TerritoryOption[]>;
  insert(input: NewTerritory): Promise<Territory>;
  countByKind(): Promise<Record<string, number>>;
  search(args: { query: string; kinds: TerritoryKind[]; limit: number }): Promise<TerritoryOption[]>;
  /** Importa l'elenco ISTAT in modo idempotente; restituisce quanti territori sono stati creati o aggiornati. */
  upsertIstat(rows: IstatRow[]): Promise<{ territories: number }>;
}

export type TerritoryDeps = { repo: TerritoryRepository; audit: AuditRecorder };
