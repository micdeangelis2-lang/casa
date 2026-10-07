import type { AuditRecorder } from "@/platform/audit";
import type { AssetDetail, AssetInput, AssetKind, AssetSummary } from "../domain/asset";

/** Dati del bene senza le liste figlie, nel formato pronto per la scrittura. */
export type AssetCore = Omit<AssetInput, "rights" | "cadastral" | "links">;

export type ResolvedRight = Omit<AssetInput["rights"][number], "holder"> & { holderPartyId: string };

export type AssetChildren = {
  rights: ResolvedRight[];
  cadastral: AssetInput["cadastral"];
  links: AssetInput["links"];
};

export interface AssetRepository {
  insert(core: AssetCore): Promise<string>;
  update(id: string, core: AssetCore): Promise<boolean>;
  /** Sostituisce diritti, righe catastali e collegamenti in uscita del bene. */
  replaceChildren(assetId: string, children: AssetChildren): Promise<void>;
  getDetail(id: string): Promise<AssetDetail | null>;
  list(args: { query?: string; kind?: AssetKind; includeArchived?: boolean }): Promise<AssetSummary[]>;
  setArchived(id: string, archived: boolean): Promise<boolean>;
  existingIds(ids: string[]): Promise<Set<string>>;
  /** Beni che dichiarano gia' un collegamento verso `assetId` (per impedire collegamenti reciproci). */
  idsLinkedTo(assetId: string): Promise<Set<string>>;
}

/** Cio' che il modulo si aspetta dagli altri moduli, fornito dal punto di composizione (index.ts). */
export interface AssetCollaborators {
  /** Il territorio e' un Comune o una localita'? Restituisce il tipo, o null se non esiste. */
  territoryKind(id: string): Promise<string | null>;
  /** Etichette complete dei territori, per id. */
  territoryLabels(ids: string[]): Promise<Map<string, string>>;
  /** Id del contatto "proprietario" (creato alla prima richiesta). */
  ownerPartyId(): Promise<string>;
  /** Quali di questi id esistono nella rubrica. */
  existingPartyIds(ids: string[]): Promise<Set<string>>;
}

export type AssetDeps = { repo: AssetRepository; others: AssetCollaborators; audit: AuditRecorder };
