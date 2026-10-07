import { asc, desc, eq, max } from "drizzle-orm";
import { rule, ruleVersion } from "@/platform/db/schema";
import type { Db } from "@/platform/db/types";
import type { Condition } from "../domain/condition";
import type { Outcome, RuleLevel, RuleVerification, RuleVersion, RuleWithVersions } from "../domain/rule";
import type { RuleRepository } from "../application/ports";

const toVersion = (row: typeof ruleVersion.$inferSelect): RuleVersion => ({
  id: row.id,
  versionNo: row.versionNo,
  title: row.title,
  description: row.description,
  level: row.level as RuleLevel,
  territoryId: row.territoryId,
  validFrom: row.validFrom,
  validTo: row.validTo,
  appliesWhen: (row.appliesWhen ?? null) as Condition | null,
  outcomes: row.outcomes as Outcome[],
  sourceText: row.sourceText,
  sourceUrl: row.sourceUrl,
  verificationStatus: row.verificationStatus as RuleVerification,
  changeNote: row.changeNote,
  createdAt: row.createdAt,
});

export function drizzleRuleRepository(db: Db): RuleRepository {
  const withVersions = async (rules: (typeof rule.$inferSelect)[]): Promise<RuleWithVersions[]> => {
    if (rules.length === 0) return [];
    const versions = await db.select().from(ruleVersion).orderBy(desc(ruleVersion.versionNo));
    return rules.map((r) => ({
      id: r.id,
      key: r.key,
      active: r.active,
      versions: versions.filter((v) => v.ruleId === r.id).map(toVersion),
    }));
  };

  return {
    async keyExists(key) {
      const rows = await db.select({ id: rule.id }).from(rule).where(eq(rule.key, key));
      return rows.length > 0;
    },

    async insertRule(key) {
      const [row] = await db.insert(rule).values({ key }).returning({ id: rule.id });
      return row!.id;
    },

    async insertVersion(ruleId, input, supersedesVersionId) {
      const [current] = await db.select({ n: max(ruleVersion.versionNo) }).from(ruleVersion).where(eq(ruleVersion.ruleId, ruleId));
      const versionNo = (current?.n ?? 0) + 1;
      const [row] = await db
        .insert(ruleVersion)
        .values({
          ruleId,
          versionNo,
          title: input.title,
          description: input.description ?? null,
          level: input.level,
          territoryId: input.territoryId ?? null,
          validFrom: input.validFrom ?? null,
          validTo: input.validTo ?? null,
          appliesWhen: input.appliesWhen,
          outcomes: input.outcomes,
          sourceText: input.sourceText,
          sourceUrl: input.sourceUrl ?? null,
          verificationStatus: input.verificationStatus,
          changeNote: input.changeNote ?? null,
          supersedesVersionId,
        })
        .returning({ id: ruleVersion.id });
      return { id: row!.id, versionNo };
    },

    async setVerification(versionId, status) {
      const rows = await db.update(ruleVersion).set({ verificationStatus: status }).where(eq(ruleVersion.id, versionId)).returning({ ruleId: ruleVersion.ruleId });
      return rows[0] ?? null;
    },

    async setActive(ruleId, active) {
      const rows = await db.update(rule).set({ active }).where(eq(rule.id, ruleId)).returning({ id: rule.id });
      return rows.length > 0;
    },

    async get(ruleId) {
      const [row] = await db.select().from(rule).where(eq(rule.id, ruleId));
      if (!row) return null;
      const versions = await db.select().from(ruleVersion).where(eq(ruleVersion.ruleId, ruleId)).orderBy(desc(ruleVersion.versionNo));
      return { id: row.id, key: row.key, active: row.active, versions: versions.map(toVersion) };
    },

    async list() {
      return withVersions(await db.select().from(rule).orderBy(asc(rule.createdAt)));
    },
  };
}
