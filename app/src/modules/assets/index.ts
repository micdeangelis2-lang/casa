/**
 * Interfaccia pubblica del modulo Beni: immobili e pertinenze come record dello stesso tipo, con titolarita',
 * dati catastali storicizzati e collegamenti dichiarati. Le scritture ricevono una `UnitOfWork`, le letture un `Db`.
 */
import type { UnitOfWork } from "@/platform/db/unit-of-work";
import type { Db } from "@/platform/db/types";
import { describeTerritories, getTerritory } from "@/modules/territory";
import { ensureOwnerParty, getParty } from "@/modules/directory";
import type { AssetKind } from "./domain/asset";
import type { AssetCollaborators } from "./application/ports";
import * as useCases from "./application/use-cases";
import { drizzleAssetRepository } from "./infrastructure/drizzle-asset-repository";

export {
  ASSET_KINDS,
  RIGHT_TYPES,
  USE_TYPES,
  
  
  
  
  parseEuroToCents,
  type AssetDetail,
  type AssetKind,
  type AssetSummary,
  type AttributeValue,
  type LinkValidation,
  type RightType,
  type UseType,
} from "./domain/asset";
export type { AssetListItem } from "./application/use-cases";

/** Collega i moduli vicini: il modulo Beni li usa solo attraverso queste funzioni. */
function collaborators(db: Db, owner?: { displayName: string; email?: string }, uow?: UnitOfWork): AssetCollaborators {
  return {
    territoryKind: async (id) => (await getTerritory(db, id))?.kind ?? null,
    territoryLabels: async (ids) => new Map((await describeTerritories(db, ids)).map((t) => [t.id, t.label])),
    ownerPartyId: async () => {
      if (!uow || !owner) throw new Error("Per registrare il proprietario serve un'unita' di lavoro");
      return (await ensureOwnerParty(uow, owner)).id;
    },
    existingPartyIds: async (ids) => {
      const found = await Promise.all(ids.map((id) => getParty(db, id)));
      return new Set(found.flatMap((p) => (p ? [p.id] : [])));
    },
  };
}

const writeDeps = (uow: UnitOfWork, owner: { displayName: string; email?: string }) => ({
  repo: drizzleAssetRepository(uow.tx),
  others: collaborators(uow.tx, owner, uow),
  audit: uow.audit,
});

type Owner = { displayName: string; email?: string };

export const createAsset = (uow: UnitOfWork, owner: Owner, input: unknown) => useCases.createAsset(writeDeps(uow, owner), input);
/** Convalida a secco dei campi di un bene (nessuna scrittura, nessuna lettura del database). */
export const validateAssetInput = (input: unknown) => useCases.validateAsset(input);
export const updateAsset = (uow: UnitOfWork, owner: Owner, id: string, input: unknown) =>
  useCases.updateAsset(writeDeps(uow, owner), id, input);
export const setAssetDeclaredValue = (uow: UnitOfWork, id: string, input: unknown) =>
  useCases.setAssetDeclaredValue(writeDeps(uow, { displayName: "" }), id, input);
export const setAssetArchived = (uow: UnitOfWork, id: string, archived: boolean) =>
  useCases.setAssetArchived(writeDeps(uow, { displayName: "" }), id, archived);

const readDeps = (db: Db) => ({ repo: drizzleAssetRepository(db), others: collaborators(db) });

export const listAssets = (db: Db, args: { query?: string; kind?: AssetKind; includeArchived?: boolean } = {}) =>
  useCases.listAssets(readDeps(db), args);
export const getAssetDetail = (db: Db, id: string) => useCases.getAssetDetail(readDeps(db), id);
