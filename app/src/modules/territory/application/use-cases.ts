import { fail, failGeneral, ok, zodIssuesToErrors, type Result } from "@/shared/result";
import type { IstatRow } from "../domain/istat";
import {
  createTerritorySchema,
  PARENT_KIND,
  TERRITORY_KINDS,
  type Territory,
  type TerritoryKind,
  type TerritoryOption,
} from "../domain/territory";
import type { TerritoryDeps } from "./ports";

const KIND_LABEL: Record<TerritoryKind, string> = {
  country: "Stato",
  region: "Regione",
  province: "Provincia",
  municipality: "Comune",
  locality: "Località",
};

export async function createTerritory(deps: TerritoryDeps, input: unknown): Promise<Result<Territory>> {
  const parsed = createTerritorySchema.safeParse(input);
  if (!parsed.success) return fail(zodIssuesToErrors(parsed.error));
  const data = parsed.data;

  const parent = await deps.repo.get(data.parentId);
  if (!parent) return fail({ parentId: ["Il territorio di livello superiore non esiste"] });
  const expected = PARENT_KIND[data.kind];
  if (parent.kind !== expected) {
    return fail({
      parentId: [`Un ${KIND_LABEL[data.kind].toLowerCase()} deve stare dentro un territorio di tipo "${KIND_LABEL[expected!]}"`],
    });
  }

  const created = await deps.repo.insert({
    kind: data.kind,
    parentId: data.parentId,
    name: data.name,
    code: data.code,
    cadastralCode: data.kind === "municipality" ? data.cadastralCode : undefined,
    source: "manual",
  });
  await deps.audit.record({
    action: "territory.create",
    entityType: "territory",
    entityId: created.id,
    diff: { kind: created.kind, name: created.name, parentId: created.parentId, code: created.code },
  });
  return ok(created);
}

export async function searchTerritories(
  deps: Pick<TerritoryDeps, "repo">,
  args: { query: string; kinds?: TerritoryKind[]; limit?: number },
): Promise<TerritoryOption[]> {
  const query = args.query.trim();
  if (query.length < 2) return [];
  const requested: TerritoryKind[] = args.kinds?.length ? args.kinds : ["municipality"];
  return deps.repo.search({
    query,
    kinds: requested.filter((k) => TERRITORY_KINDS.includes(k)),
    limit: Math.min(args.limit ?? 20, 50),
  });
}

export async function importIstat(deps: TerritoryDeps, rows: IstatRow[]): Promise<Result<{ territories: number }>> {
  if (rows.length === 0) return failGeneral("Nessun Comune da importare");
  const result = await deps.repo.upsertIstat(rows);
  await deps.audit.record({
    action: "territory.import_istat",
    entityType: "territory",
    entityId: "istat",
    diff: { municipalities: rows.length, territoriesTouched: result.territories, source: "ISTAT elenco comuni" },
  });
  return ok(result);
}
