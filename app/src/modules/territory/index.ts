/**
 * Interfaccia pubblica del modulo Territori: gerarchia Stato > Regione > Provincia > Comune > Località,
 * tutta a dati. Gli altri moduli e le route usano solo cio' che e' esportato qui.
 *
 * Convenzione dei moduli: le scritture ricevono una `UnitOfWork` (transazione + audit) e le letture un `Db`.
 */
import type { UnitOfWork } from "@/platform/db/unit-of-work";
import type { Db } from "@/platform/db/types";
import type { IstatRow } from "./domain/istat";
import type { TerritoryKind } from "./domain/territory";
import * as useCases from "./application/use-cases";
import { drizzleTerritoryRepository } from "./infrastructure/drizzle-territory-repository";

export { parseIstatCsv, IstatFormatError, type IstatRow } from "./domain/istat";
export {
  
  TERRITORY_KINDS,
  
  type Territory,
  type TerritoryKind,
  type TerritoryOption,
} from "./domain/territory";

const deps = (uow: UnitOfWork) => ({ repo: drizzleTerritoryRepository(uow.tx), audit: uow.audit });

export const createTerritory = (uow: UnitOfWork, input: unknown) => useCases.createTerritory(deps(uow), input);
export const importIstat = (uow: UnitOfWork, rows: IstatRow[]) => useCases.importIstat(deps(uow), rows);

export const searchTerritories = (db: Db, args: { query: string; kinds?: TerritoryKind[]; limit?: number }) =>
  useCases.searchTerritories({ repo: drizzleTerritoryRepository(db) }, args);

export const getTerritory = (db: Db, id: string) => drizzleTerritoryRepository(db).get(id);
export const describeTerritories = (db: Db, ids: string[]) => drizzleTerritoryRepository(db).getMany(ids);
export const countTerritories = (db: Db) => drizzleTerritoryRepository(db).countByKind();

/** Id del territorio e di tutti i suoi antenati (Localita' > Comune > Provincia > Regione > Stato), dal piu' vicino. */
export async function territoryChainIds(db: Db, id: string): Promise<string[]> {
  const repo = drizzleTerritoryRepository(db);
  const ids: string[] = [];
  for (let current = await repo.get(id); current && ids.length < 8; current = current.parentId ? await repo.get(current.parentId) : null) {
    ids.push(current.id);
  }
  return ids;
}
