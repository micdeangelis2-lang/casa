/**
 * Interfaccia pubblica del modulo «Da controllare»: legge i dati degli altri moduli e ne ricava un elenco di cose che meritano
 * uno sguardo (date superate, scadenze vicine, pagamenti senza prova, voci senza documento, backup mancante). Sola lettura, nessuno
 * schema proprio. Dice solo cio' che risulta dai dati inseriti: non giudica se una situazione sia irregolare.
 */
import type { Db } from "@/platform/db/types";
import { todayInItaly } from "@/platform/clock";
import { listAssets } from "@/modules/assets";
import { backupSettingsFromEnv, listBackupRuns } from "@/modules/backup";
import { getCondominiumDetail, listCondominiums } from "@/modules/condominium";
import { listOccurrences } from "@/modules/deadlines";
import { listDocuments } from "@/modules/documents";
import { getDossier } from "@/modules/dossier";
import { listPolicies, policiesByAsset } from "@/modules/insurance";
import { DEFAULT_REVIEW_MONTHS, reviewRules } from "@/modules/offices";
import { getLettingDetail, listLettings } from "@/modules/lettings";
import { getWorkDetail, listWarranties, listWorks } from "@/modules/maintenance";
import { listObligations, listReturns } from "@/modules/taxes";
import { DEADLINE_SOON_DAYS, computeFindings, type Finding, type Sources } from "./domain/findings";

export { ATTENTION_AREAS, countBySeverity, type AttentionArea, type Finding, type Severity, type Sources } from "./domain/findings";

/** Raccoglie i dati dai moduli (letture, senza scrivere nulla). */
export async function gatherSources(db: Db, today = todayInItaly()): Promise<Sources> {
  const [overdue, upcoming, documents, obligations, returns, condoList, works, warranties, policies, lettingList, assets, runs, byAsset, review] = await Promise.all([
    listOccurrences(db, "overdue", {}, today),
    listOccurrences(db, "upcoming", {}, today, { windowDays: DEADLINE_SOON_DAYS }),
    listDocuments(db, {}),
    listObligations(db, {}, today),
    listReturns(db, {}, today),
    listCondominiums(db),
    listWorks(db, { includeClosed: true }),
    listWarranties(db, {}, today),
    listPolicies(db, false, today),
    listLettings(db, {}, today),
    listAssets(db),
    listBackupRuns(db, 20),
    policiesByAsset(db, today),
    // L'eta' massima dell'ultimo controllo e' l'impostazione predefinita dell'app (12 mesi), non un termine di legge.
    reviewRules(db, { today }),
  ]);

  const condominiums = await Promise.all(
    condoList.map(async (c) => {
      const detail = (await getCondominiumDetail(db, c.id))!;
      const late = detail.years.flatMap((y) => y.budgets.flatMap((b) => b.installments)).filter((i) => !i.paid && i.dueOn < today);
      return {
        id: c.id,
        name: c.name,
        unpaidOverdue: { count: late.length, cents: late.reduce((n, i) => n + (i.amountCents - i.paidCents), 0), oldestDueOn: late.map((i) => i.dueOn).sort()[0] ?? null },
        contracts: detail.contracts.map((x) => ({ title: x.title, validTo: x.validTo })),
      };
    }),
  );

  const worksWithQuotes = await Promise.all(
    works.map(async (w) => ({
      id: w.id,
      title: w.title,
      unpaidCents: Math.max(0, w.invoicedCents - w.paidCents),
      expiredQuotes: w.status === "planned" || w.status === "quoted" ? ((await getWorkDetail(db, w.id, today))?.quotes.filter((q) => q.expired).length ?? 0) : 0,
    })),
  );

  const lettings = await Promise.all(
    lettingList.map(async (l) => {
      const detail = (await getLettingDetail(db, l.id, today))!;
      return {
        id: l.id,
        assetId: l.assetId,
        type: l.type,
        title: l.title,
        status: l.status,
        startsOn: l.startsOn,
        endsOn: l.endsOn,
        overdueRents: l.overdueRents,
        reports: detail.reports.map((r) => ({ title: r.title, dueOn: r.dueOn, overdue: r.state === "overdue" })),
        codes: detail.codes.map((c) => ({ label: c.label, validUntil: c.validUntil, state: c.state })),
      };
    }),
  );

  const dossiers = (
    await Promise.all(
      assets.map(async (a) => {
        const view = await getDossier(db, a.id, today);
        return view ? { assetId: a.id, assetName: a.name, missing: view.summary.byStatus.missing, stale: view.staleCount } : null;
      }),
    )
  ).filter((d): d is NonNullable<typeof d> => d !== null);

  const lastGood = runs.filter((r) => (r.status === "completed" || r.status === "warning") && r.finishedAt).sort((a, b) => b.finishedAt!.getTime() - a.finishedAt!.getTime())[0];
  const newest = runs.filter((r) => r.status !== "running").sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];

  return {
    today,
    overdueDeadlines: overdue.length,
    soonDeadlines: upcoming.length,
    documents: documents.map((d) => ({ id: d.id, title: d.title, validTo: d.validTo })),
    obligations: obligations
      .filter((o) => o.state !== "closed")
      .map((o) => ({ id: o.id, title: `${o.typeName} ${o.year}${o.label ? ` – ${o.label}` : ""}`, assetName: o.assetName, overdue: o.overdue, dueOn: o.dueOn, paymentsWithoutProof: o.paymentsWithoutProof })),
    returns: returns.map((r) => ({ id: r.id, title: `${r.title} ${r.year}`, overdue: r.state === "overdue", dueOn: r.dueOn })),
    condominiums,
    works: worksWithQuotes,
    warranties: warranties.map((w) => ({ id: w.id, title: w.title, state: w.state, endsOn: w.endsOn })),
    policies: policies.map((p) => ({ id: p.id, title: p.title, state: p.state, endsOn: p.endsOn, nextPremium: p.nextPremium })),
    lettings,
    dossiers,
    assetPolicies: byAsset.rows.map((r) => ({ assetId: r.assetId, assetName: r.assetName, status: r.status, count: r.policies.length })),
    rulesReview: { count: review ? review.counts.unverified + review.counts.no_check_date + review.counts.stale : 0, maxAgeMonths: review?.maxAgeMonths ?? DEFAULT_REVIEW_MONTHS },
    backup: {
      configured: Boolean(backupSettingsFromEnv().publicKey),
      lastSuccessOn: lastGood?.finishedAt ? lastGood.finishedAt.toISOString().slice(0, 10) : null,
      lastFailed: newest?.status === "failed",
    },
  };
}

/** Cio' che merita uno sguardo oggi, prima le priorita' alte. */
export async function getAttention(db: Db, today = todayInItaly()): Promise<Finding[]> {
  return computeFindings(await gatherSources(db, today));
}
