import { and, asc, desc, eq, gte, isNull, lte, type SQL } from "drizzle-orm";
import type { Db } from "@/platform/db/types";
import { insClaim, insClaimEntry, insCoverage, insPolicy, insPolicyAsset, insPremium } from "@/platform/db/schema";
import type { ClaimEntryRow, ClaimRow, CoverageRow, InsuranceRepository, PolicyRow, PremiumRow } from "../application/ports";
import type { ClaimStatus, EntryDirection } from "../domain/insurance";

const toPolicy = (r: typeof insPolicy.$inferSelect): PolicyRow => ({
  id: r.id,
  title: r.title,
  insurerPartyId: r.insurerPartyId,
  agentPartyId: r.agentPartyId,
  policyNumber: r.policyNumber,
  startsOn: r.startsOn,
  endsOn: r.endsOn,
  premiumCents: r.premiumCents,
  note: r.note,
  documentId: r.documentId,
  deadlineId: r.deadlineId,
  archived: r.archivedAt !== null,
});
const toCoverage = (r: typeof insCoverage.$inferSelect): CoverageRow => ({ id: r.id, policyId: r.policyId, title: r.title, sumInsuredCents: r.sumInsuredCents, deductibleCents: r.deductibleCents, note: r.note });
const toPremium = (r: typeof insPremium.$inferSelect): PremiumRow => ({ id: r.id, policyId: r.policyId, dueOn: r.dueOn, amountCents: r.amountCents, paidOn: r.paidOn, documentId: r.documentId, deadlineId: r.deadlineId });
const toClaim = (r: typeof insClaim.$inferSelect): ClaimRow => ({
  id: r.id,
  policyId: r.policyId,
  assetId: r.assetId,
  title: r.title,
  claimNumber: r.claimNumber,
  occurredOn: r.occurredOn,
  reportedOn: r.reportedOn,
  status: r.status as ClaimStatus,
  claimedCents: r.claimedCents,
  receivedCents: r.receivedCents,
  adjusterPartyId: r.adjusterPartyId,
  matterId: r.matterId,
  description: r.description,
  closedOn: r.closedOn,
});
const toEntry = (r: typeof insClaimEntry.$inferSelect): ClaimEntryRow => ({ id: r.id, claimId: r.claimId, entryOn: r.entryOn, direction: r.direction as EntryDirection, summary: r.summary, documentId: r.documentId });

const archivedPatch = (archived: boolean | undefined) => (archived === undefined ? {} : { archivedAt: archived ? new Date() : null });

export function drizzleInsuranceRepository(db: Db): InsuranceRepository {
  return {
    async insertPolicy(d) {
      const { archived, ...rest } = d;
      const [row] = await db.insert(insPolicy).values({ ...rest, ...archivedPatch(archived) }).returning({ id: insPolicy.id });
      return row!.id;
    },
    async updatePolicy(id, d) {
      const { archived, ...rest } = d;
      const rows = await db.update(insPolicy).set({ ...rest, ...archivedPatch(archived) }).where(eq(insPolicy.id, id)).returning({ id: insPolicy.id });
      return rows.length > 0;
    },
    async getPolicy(id) {
      const [row] = await db.select().from(insPolicy).where(eq(insPolicy.id, id));
      return row ? toPolicy(row) : null;
    },
    async listPolicies(includeArchived) {
      const rows = await db.select().from(insPolicy).where(includeArchived ? undefined : isNull(insPolicy.archivedAt)).orderBy(asc(insPolicy.title));
      return rows.map(toPolicy);
    },
    async policyAssets(policyId) {
      return (await db.select().from(insPolicyAsset).where(eq(insPolicyAsset.policyId, policyId))).map((r) => r.assetId);
    },
    async allPolicyAssets() {
      return (await db.select().from(insPolicyAsset)).map((r) => ({ policyId: r.policyId, assetId: r.assetId }));
    },
    async setPolicyAssets(policyId, assetIds) {
      await db.delete(insPolicyAsset).where(eq(insPolicyAsset.policyId, policyId));
      if (assetIds.length > 0) await db.insert(insPolicyAsset).values(assetIds.map((assetId) => ({ policyId, assetId })));
    },

    async coverages(policyId) {
      return (await db.select().from(insCoverage).where(eq(insCoverage.policyId, policyId)).orderBy(asc(insCoverage.createdAt))).map(toCoverage);
    },
    async insertCoverage(d) {
      const [row] = await db.insert(insCoverage).values(d).returning({ id: insCoverage.id });
      return row!.id;
    },
    async getCoverage(id) {
      const [row] = await db.select().from(insCoverage).where(eq(insCoverage.id, id));
      return row ? toCoverage(row) : null;
    },
    async deleteCoverage(id) {
      await db.delete(insCoverage).where(eq(insCoverage.id, id));
    },

    async premiums(policyId) {
      return (await db.select().from(insPremium).where(eq(insPremium.policyId, policyId)).orderBy(asc(insPremium.dueOn))).map(toPremium);
    },
    async allPremiums() {
      return (await db.select().from(insPremium)).map(toPremium);
    },
    async paidPremiumsBetween(from, to) {
      const rows = await db.select().from(insPremium).where(and(gte(insPremium.paidOn, from), lte(insPremium.paidOn, to))).orderBy(asc(insPremium.paidOn));
      return rows.map((r) => ({ ...toPremium(r), paidOn: r.paidOn! }));
    },
    async insertPremium(d) {
      const [row] = await db.insert(insPremium).values(d).returning({ id: insPremium.id });
      return row!.id;
    },
    async getPremium(id) {
      const [row] = await db.select().from(insPremium).where(eq(insPremium.id, id));
      return row ? toPremium(row) : null;
    },
    async updatePremium(id, d) {
      await db.update(insPremium).set(d).where(eq(insPremium.id, id));
    },
    async deletePremium(id) {
      await db.delete(insPremium).where(eq(insPremium.id, id));
    },

    async insertClaim(d) {
      const [row] = await db.insert(insClaim).values(d).returning({ id: insClaim.id });
      return row!.id;
    },
    async updateClaim(id, d) {
      const rows = await db.update(insClaim).set(d).where(eq(insClaim.id, id)).returning({ id: insClaim.id });
      return rows.length > 0;
    },
    async getClaim(id) {
      const [row] = await db.select().from(insClaim).where(eq(insClaim.id, id));
      return row ? toClaim(row) : null;
    },
    async listClaims(filter) {
      const conditions: SQL[] = [];
      if (filter.policyId) conditions.push(eq(insClaim.policyId, filter.policyId));
      return (await db.select().from(insClaim).where(conditions.length > 0 ? and(...conditions) : undefined).orderBy(desc(insClaim.occurredOn))).map(toClaim);
    },
    async entries(claimId) {
      return (await db.select().from(insClaimEntry).where(eq(insClaimEntry.claimId, claimId)).orderBy(asc(insClaimEntry.entryOn), asc(insClaimEntry.createdAt))).map(toEntry);
    },
    async insertEntry(d) {
      const [row] = await db.insert(insClaimEntry).values(d).returning({ id: insClaimEntry.id });
      return row!.id;
    },
    async getEntry(id) {
      const [row] = await db.select().from(insClaimEntry).where(eq(insClaimEntry.id, id));
      return row ? toEntry(row) : null;
    },
    async deleteEntry(id) {
      await db.delete(insClaimEntry).where(eq(insClaimEntry.id, id));
    },
  };
}
