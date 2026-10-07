import { and, asc, eq, ilike, inArray, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { territory } from "@/platform/db/schema";
import type { Db } from "@/platform/db/types";
import type { IstatRow } from "../domain/istat";
import { territoryLabel, type Territory, type TerritoryKind, type TerritoryOption } from "../domain/territory";
import type { NewTerritory, TerritoryRepository } from "../application/ports";

const CHUNK = 500;

function toTerritory(row: typeof territory.$inferSelect): Territory {
  return {
    id: row.id,
    kind: row.kind as TerritoryKind,
    parentId: row.parentId,
    name: row.name,
    code: row.code,
    cadastralCode: row.cadastralCode,
    provinceSigla: row.provinceSigla,
    source: row.source,
    verificationStatus: row.verificationStatus,
  };
}

/** Caratteri speciali di LIKE resi letterali, cosi' la ricerca dell'utente non diventa un pattern. */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

export function drizzleTerritoryRepository(db: Db): TerritoryRepository {
  /** Carica per ogni territorio la catena degli antenati (al massimo 4 livelli) e ne costruisce l'etichetta. */
  async function withLabels(rows: Territory[]): Promise<TerritoryOption[]> {
    const known = new Map<string, Territory>(rows.map((r) => [r.id, r]));
    let missing = [...new Set(rows.map((r) => r.parentId).filter((id): id is string => !!id && !known.has(id)))];
    for (let depth = 0; depth < 4 && missing.length > 0; depth++) {
      const parents = await db.select().from(territory).where(inArray(territory.id, missing));
      for (const p of parents) known.set(p.id, toTerritory(p));
      missing = [
        ...new Set(parents.map((p) => p.parentId).filter((id): id is string => !!id && !known.has(id))),
      ];
    }
    return rows.map((row) => {
      const chain: Territory[] = [];
      for (let t: Territory | undefined = row; t; t = t.parentId ? known.get(t.parentId) : undefined) chain.push(t);
      return { ...row, label: territoryLabel(chain) };
    });
  }

  return {
    async get(id) {
      const [row] = await db.select().from(territory).where(eq(territory.id, id));
      return row ? toTerritory(row) : null;
    },

    async getMany(ids) {
      if (ids.length === 0) return [];
      const rows = await db.select().from(territory).where(inArray(territory.id, ids));
      return withLabels(rows.map(toTerritory));
    },

    async insert(input: NewTerritory) {
      const [row] = await db
        .insert(territory)
        .values({
          kind: input.kind,
          parentId: input.parentId,
          name: input.name,
          code: input.code ?? null,
          cadastralCode: input.cadastralCode ?? null,
          provinceSigla: input.provinceSigla ?? null,
          source: input.source,
        })
        .returning();
      return toTerritory(row!);
    },

    async countByKind() {
      const rows = await db.select({ kind: territory.kind, n: sql<number>`count(*)::int` }).from(territory).groupBy(territory.kind);
      return Object.fromEntries(rows.map((r) => [r.kind, Number(r.n)]));
    },

    async search({ query, kinds, limit }) {
      const pattern = `%${escapeLike(query)}%`;
      const prefix = `${escapeLike(query)}%`;
      const rows = await db
        .select()
        .from(territory)
        .where(and(inArray(territory.kind, kinds), ilike(territory.name, pattern)))
        // Prima i nomi che iniziano con quanto digitato, poi in ordine alfabetico.
        .orderBy(sql`case when ${territory.name} ilike ${prefix} then 0 else 1 end`, asc(territory.name))
        .limit(limit);
      return withLabels(rows.map(toTerritory));
    },

    async upsertIstat(rows: IstatRow[]) {
      let touched = 0;
      const upsert = async (
        values: (typeof territory.$inferInsert)[],
        set: PgUpdateSetSource<typeof territory>,
      ) => {
        for (const part of chunks(values)) {
          await db
            .insert(territory)
            .values(part)
            .onConflictDoUpdate({
              target: [territory.kind, territory.code],
              targetWhere: sql`${territory.code} is not null`,
              // Lo stato di verifica deciso dal proprietario non si tocca mai.
              set: { ...set, updatedAt: new Date() },
            });
          touched += part.length;
        }
      };
      const idsByCode = async (kind: TerritoryKind) => {
        const found = await db
          .select({ id: territory.id, code: territory.code })
          .from(territory)
          .where(eq(territory.kind, kind));
        return new Map(found.map((r) => [r.code ?? "", r.id]));
      };

      await upsert([{ kind: "country", code: "IT", name: "Italia", source: "istat" }], { name: sql`excluded.name` });
      const countryId = (await idsByCode("country")).get("IT")!;

      const regions = new Map(rows.map((r) => [r.regionCode, r.regionName]));
      await upsert(
        [...regions].map(([code, name]) => ({ kind: "region", code, name, parentId: countryId, source: "istat" })),
        { name: sql`excluded.name`, parentId: sql`excluded.parent_id` },
      );
      const regionIds = await idsByCode("region");

      const provinces = new Map(rows.map((r) => [r.provinceCode, r]));
      await upsert(
        [...provinces.values()].map((r) => ({
          kind: "province",
          code: r.provinceCode,
          name: r.provinceName,
          provinceSigla: r.provinceSigla,
          parentId: regionIds.get(r.regionCode)!,
          source: "istat",
        })),
        { name: sql`excluded.name`, provinceSigla: sql`excluded.province_sigla`, parentId: sql`excluded.parent_id` },
      );
      const provinceIds = await idsByCode("province");

      await upsert(
        rows.map((r) => ({
          kind: "municipality",
          code: r.municipalityCode,
          name: r.municipalityName,
          cadastralCode: r.cadastralCode,
          parentId: provinceIds.get(r.provinceCode)!,
          source: "istat",
        })),
        {
          name: sql`excluded.name`,
          cadastralCode: sql`excluded.cadastral_code`,
          parentId: sql`excluded.parent_id`,
        },
      );
      return { territories: touched };
    },
  };
}
