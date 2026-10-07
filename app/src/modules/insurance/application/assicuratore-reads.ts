import { groupPoliciesByAsset, policiesWithoutAsset, sheetChecks, type AssetPolicyRow, type OverviewPolicy, type SheetCheck } from "../domain/assicuratore-overview";
import { getClaimDetail, getPolicyDetail, listClaims, listPolicies, type ClaimDetail, type ClaimItem, type PolicyDetail } from "./use-cases";
import type { InsuranceReadDeps } from "./ports";

// ------------------------------------------------------------------------ polizze per bene

export type PoliciesByAsset = { rows: AssetPolicyRow[]; withoutAsset: OverviewPolicy[] };

/** Per ogni bene non archiviato le polizze (non archiviate) collegate, con le garanzie copiate a mano. Nessuna interpretazione. */
export async function policiesByAsset(deps: InsuranceReadDeps, today: string): Promise<PoliciesByAsset> {
  const [policies, assets] = await Promise.all([listPolicies(deps, false, today), deps.others.assets()]);
  const overview: OverviewPolicy[] = await Promise.all(
    policies.map(async (p) => ({
      id: p.id,
      title: p.title,
      insurerName: p.insurerName,
      policyNumber: p.policyNumber,
      startsOn: p.startsOn,
      endsOn: p.endsOn,
      state: p.state,
      premiumCents: p.premiumCents,
      assetIds: p.assets.map((a) => a.id),
      openClaims: p.openClaims,
      coverages: (await deps.repo.coverages(p.id)).map((c) => ({ title: c.title, sumInsuredCents: c.sumInsuredCents, deductibleCents: c.deductibleCents })),
    })),
  );
  return { rows: groupPoliciesByAsset(assets, overview), withoutAsset: policiesWithoutAsset(overview) };
}

// ------------------------------------------------------------------------ scheda sinistro per il perito

/** Cio' che serve dagli altri moduli: lo fornisce `index.ts`, il caso d'uso non li importa. */
export type SheetAssetFacts = {
  id: string;
  name: string;
  kindKey: string;
  address: string | null;
  locality: string | null;
  territoryLabel: string;
  postalCode: string | null;
  useKey: string | null;
  attributes: { key: string; value: string | number | boolean }[];
  cadastral: { sheet: string | null; parcel: string | null; subunit: string | null; category: string | null; consistency: string | null }[];
  holders: { name: string; rightKey: string; quota: string }[];
};
export type SheetWork = { id: string; title: string; status: string; completedOn: string | null; startedOn: string | null; scheduledOn: string | null; supplierName: string | null; acceptedQuotesCents: number; invoicedCents: number; paidCents: number };
export type SheetDocument = { id: string; title: string; categoryName: string; issuedOn: string | null; isImage: boolean };

export interface ClaimSheetCollaborators {
  asset(id: string): Promise<SheetAssetFacts | null>;
  worksOf(assetId: string): Promise<SheetWork[]>;
  documentsOf(assetId: string): Promise<SheetDocument[]>;
}

export type ClaimSheet = {
  claim: ClaimDetail;
  policy: PolicyDetail;
  assets: (SheetAssetFacts & { works: SheetWork[]; documents: SheetDocument[] })[];
  /** Altri sinistri registrati sullo stesso bene (o, senza bene, sulla stessa polizza): storico con importi scritti dal proprietario. */
  otherClaims: ClaimItem[];
  checks: SheetCheck[];
};

export async function getClaimSheet(deps: InsuranceReadDeps, others: ClaimSheetCollaborators, claimId: string, today: string): Promise<ClaimSheet | null> {
  const claim = await getClaimDetail(deps, claimId);
  if (!claim) return null;
  const policy = await getPolicyDetail(deps, claim.policyId, today);
  if (!policy) return null;
  const assetIds = claim.assetId ? [claim.assetId] : policy.assets.map((a) => a.id);
  const assets = (
    await Promise.all(
      assetIds.map(async (id) => {
        const facts = await others.asset(id);
        if (!facts) return null;
        const [works, documents] = await Promise.all([others.worksOf(id), others.documentsOf(id)]);
        return { ...facts, works, documents };
      }),
    )
  ).filter((a): a is NonNullable<typeof a> => a !== null);
  const all = await listClaims(deps, { includeClosed: true });
  const otherClaims = all.filter((c) => c.id !== claim.id && (claim.assetId ? c.assetId === claim.assetId : c.policyId === claim.policyId)).sort((a, b) => b.occurredOn.localeCompare(a.occurredOn));
  const documentIds = new Set(assets.flatMap((a) => a.documents.map((d) => d.id)));
  for (const e of claim.entries) if (e.documentId) documentIds.add(e.documentId);
  const checks = sheetChecks({
    reportedOn: claim.reportedOn,
    claimNumber: claim.claimNumber,
    description: claim.description,
    claimedCents: claim.claimedCents,
    adjusterName: claim.adjusterName,
    policyNumber: policy.policyNumber,
    coverageCount: policy.coverages.length,
    entryCount: claim.entries.length,
    documentCount: documentIds.size,
    photoCount: assets.reduce((n, a) => n + a.documents.filter((d) => d.isImage).length, 0),
    workCount: assets.reduce((n, a) => n + a.works.length, 0),
  });
  return { claim, policy, assets, otherClaims, checks };
}
