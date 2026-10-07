import { asc, eq } from "drizzle-orm";
import { assetEncumbrance, assetProvenance } from "@/platform/db/schema";
import type { Db } from "@/platform/db/types";
import type { EncumbranceRow, NotaryRepository, ProvenanceRow } from "../application/ports";
import type { EncumbranceKind, ProvenanceKind } from "../domain/records";

const toProvenance = (r: typeof assetProvenance.$inferSelect): ProvenanceRow => ({
  id: r.id,
  assetId: r.assetId,
  kind: r.kind as ProvenanceKind,
  occurredOn: r.occurredOn,
  fromPartyId: r.fromPartyId,
  notaryPartyId: r.notaryPartyId,
  deedReference: r.deedReference,
  documentId: r.documentId,
  note: r.note,
});

const toEncumbrance = (r: typeof assetEncumbrance.$inferSelect): EncumbranceRow => ({
  id: r.id,
  assetId: r.assetId,
  kind: r.kind as EncumbranceKind,
  title: r.title,
  registeredOn: r.registeredOn,
  endedOn: r.endedOn,
  beneficiaryPartyId: r.beneficiaryPartyId,
  amountCents: r.amountCents,
  reference: r.reference,
  documentId: r.documentId,
  note: r.note,
});

export function drizzleNotaryRepository(db: Db): NotaryRepository {
  return {
    async provenances(assetId) {
      return (await db.select().from(assetProvenance).where(eq(assetProvenance.assetId, assetId)).orderBy(asc(assetProvenance.occurredOn), asc(assetProvenance.createdAt))).map(toProvenance);
    },
    async insertProvenance(d) {
      const [row] = await db.insert(assetProvenance).values(d).returning({ id: assetProvenance.id });
      return row!.id;
    },
    async updateProvenance(id, d) {
      await db.update(assetProvenance).set(d).where(eq(assetProvenance.id, id));
    },
    async getProvenance(id) {
      const [row] = await db.select().from(assetProvenance).where(eq(assetProvenance.id, id));
      return row ? toProvenance(row) : null;
    },
    async deleteProvenance(id) {
      await db.delete(assetProvenance).where(eq(assetProvenance.id, id));
    },
    async encumbrances(assetId) {
      return (await db.select().from(assetEncumbrance).where(eq(assetEncumbrance.assetId, assetId)).orderBy(asc(assetEncumbrance.registeredOn), asc(assetEncumbrance.createdAt))).map(toEncumbrance);
    },
    async insertEncumbrance(d) {
      const [row] = await db.insert(assetEncumbrance).values(d).returning({ id: assetEncumbrance.id });
      return row!.id;
    },
    async updateEncumbrance(id, d) {
      await db.update(assetEncumbrance).set(d).where(eq(assetEncumbrance.id, id));
    },
    async getEncumbrance(id) {
      const [row] = await db.select().from(assetEncumbrance).where(eq(assetEncumbrance.id, id));
      return row ? toEncumbrance(row) : null;
    },
    async deleteEncumbrance(id) {
      await db.delete(assetEncumbrance).where(eq(assetEncumbrance.id, id));
    },
  };
}
