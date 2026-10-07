import { and, asc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { asset, assetLink, cadastralRecord, ownershipRight, party } from "@/platform/db/schema";
import type { Db } from "@/platform/db/types";
import type { AssetDetail, AssetKind, AssetSummary, LinkValidation, RightType, UseType } from "../domain/asset";
import type { AssetCore, AssetRepository } from "../application/ports";

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

function toSummary(row: typeof asset.$inferSelect): AssetSummary {
  return {
    id: row.id,
    kind: row.kind as AssetKind,
    name: row.name,
    territoryId: row.territoryId,
    locality: row.locality,
    address: row.address,
    useType: row.useType as UseType | null,
    archived: row.archivedAt !== null,
  };
}

const coreValues = (core: AssetCore) => ({
  kind: core.kind,
  name: core.name,
  territoryId: core.territoryId,
  locality: core.locality ?? null,
  address: core.address ?? null,
  postalCode: core.postalCode ?? null,
  useType: core.useType ?? null,
  inCondominium: core.inCondominium,
  notes: core.notes ?? null,
  attributes: Object.fromEntries(core.attributes.map((a) => [a.key, a.value])),
});

export function drizzleAssetRepository(db: Db): AssetRepository {
  return {
    async insert(core) {
      const [row] = await db.insert(asset).values(coreValues(core)).returning({ id: asset.id });
      return row!.id;
    },

    async update(id, core) {
      const rows = await db.update(asset).set(coreValues(core)).where(eq(asset.id, id)).returning({ id: asset.id });
      return rows.length > 0;
    },

    async replaceChildren(assetId, { rights, cadastral, links }) {
      await db.delete(ownershipRight).where(eq(ownershipRight.assetId, assetId));
      await db.delete(cadastralRecord).where(eq(cadastralRecord.assetId, assetId));
      await db.delete(assetLink).where(eq(assetLink.ancillaryAssetId, assetId));
      if (rights.length > 0) {
        await db.insert(ownershipRight).values(
          rights.map((r, position) => ({
            assetId,
            position,
            holderPartyId: r.holderPartyId,
            rightType: r.rightType,
            quotaNumerator: r.quotaNumerator,
            quotaDenominator: r.quotaDenominator,
            validFrom: r.validFrom ?? null,
            validTo: r.validTo ?? null,
            notes: r.notes ?? null,
          })),
        );
      }
      if (cadastral.length > 0) {
        await db.insert(cadastralRecord).values(
          cadastral.map((c, position) => ({
            assetId,
            position,
            sheet: c.sheet ?? null,
            parcel: c.parcel ?? null,
            subunit: c.subunit ?? null,
            cadastralCategory: c.cadastralCategory ?? null,
            cadastralClass: c.cadastralClass ?? null,
            consistency: c.consistency ?? null,
            incomeCents: c.incomeCents ?? null,
            validFrom: c.validFrom ?? null,
            validTo: c.validTo ?? null,
            notes: c.notes ?? null,
          })),
        );
      }
      if (links.length > 0) {
        await db.insert(assetLink).values(
          links.map((l, position) => ({
            ancillaryAssetId: assetId,
            position,
            mainAssetId: l.mainAssetId,
            declaredBasis: l.declaredBasis ?? null,
            validationStatus: l.validationStatus,
          })),
        );
      }
    },

    async getDetail(id) {
      const [row] = await db.select().from(asset).where(eq(asset.id, id));
      if (!row) return null;

      const rights = await db
        .select({ right: ownershipRight, holderName: party.displayName })
        .from(ownershipRight)
        .innerJoin(party, eq(party.id, ownershipRight.holderPartyId))
        .where(eq(ownershipRight.assetId, id))
        .orderBy(asc(ownershipRight.position));
      const cadastral = await db.select().from(cadastralRecord).where(eq(cadastralRecord.assetId, id)).orderBy(asc(cadastralRecord.position));

      const linkedTo = await db
        .select({ link: assetLink, other: asset })
        .from(assetLink)
        .innerJoin(asset, eq(asset.id, assetLink.mainAssetId))
        .where(eq(assetLink.ancillaryAssetId, id))
        .orderBy(asc(assetLink.position));
      const linkedFrom = await db
        .select({ link: assetLink, other: asset })
        .from(assetLink)
        .innerJoin(asset, eq(asset.id, assetLink.ancillaryAssetId))
        .where(eq(assetLink.mainAssetId, id))
        .orderBy(asc(assetLink.createdAt), asc(assetLink.position));

      const mapLink = ({ link, other }: (typeof linkedTo)[number]) => ({
        id: link.id,
        asset: { id: other.id, name: other.name, kind: other.kind as AssetKind },
        declaredBasis: link.declaredBasis,
        validationStatus: link.validationStatus as LinkValidation,
      });

      const detail: AssetDetail = {
        ...toSummary(row),
        postalCode: row.postalCode,
        inCondominium: row.inCondominium,
        attributes: row.attributes as AssetDetail["attributes"],
        notes: row.notes,
        rights: rights.map(({ right, holderName }) => ({
          id: right.id,
          holder: { id: right.holderPartyId, displayName: holderName },
          rightType: right.rightType as RightType,
          quotaNumerator: right.quotaNumerator,
          quotaDenominator: right.quotaDenominator,
          validFrom: right.validFrom,
          validTo: right.validTo,
          notes: right.notes,
        })),
        cadastral: cadastral.map((c) => ({
          id: c.id,
          sheet: c.sheet,
          parcel: c.parcel,
          subunit: c.subunit,
          cadastralCategory: c.cadastralCategory,
          cadastralClass: c.cadastralClass,
          consistency: c.consistency,
          incomeCents: c.incomeCents,
          validFrom: c.validFrom,
          validTo: c.validTo,
          notes: c.notes,
        })),
        linkedTo: linkedTo.map(mapLink),
        linkedFrom: linkedFrom.map(mapLink),
      };
      return detail;
    },

    async list({ query, kind, includeArchived }) {
      const conditions: (SQL | undefined)[] = [];
      if (!includeArchived) conditions.push(isNull(asset.archivedAt));
      if (kind) conditions.push(eq(asset.kind, kind));
      if (query?.trim()) {
        const pattern = `%${escapeLike(query.trim())}%`;
        conditions.push(or(ilike(asset.name, pattern), ilike(asset.address, pattern), ilike(asset.locality, pattern)));
      }
      const rows = await db
        .select()
        .from(asset)
        .where(and(...conditions))
        .orderBy(sql`lower(${asset.name})`, asc(asset.createdAt));
      return rows.map(toSummary);
    },

    async setArchived(id, archived) {
      const rows = await db
        .update(asset)
        .set({ archivedAt: archived ? new Date() : null })
        .where(eq(asset.id, id))
        .returning({ id: asset.id });
      return rows.length > 0;
    },

    async existingIds(ids) {
      if (ids.length === 0) return new Set();
      const rows = await db.select({ id: asset.id }).from(asset).where(inArray(asset.id, ids));
      return new Set(rows.map((r) => r.id));
    },

    async idsLinkedTo(assetId) {
      const rows = await db
        .select({ id: assetLink.ancillaryAssetId })
        .from(assetLink)
        .where(eq(assetLink.mainAssetId, assetId));
      return new Set(rows.map((r) => r.id));
    },
  };
}
