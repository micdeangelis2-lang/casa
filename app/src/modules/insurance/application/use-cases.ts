import { periodState, type PeriodState } from "@/shared/dates";
import { fail, failGeneral, ok, parseInput, type FieldErrors, type Result } from "@/shared/result";
import { CLAIM_STATUSES, claimEntrySchema, claimSchema, coverageSchema, isClaimOpen, policySchema, premiumOverdue, premiumPaidSchema, premiumSchema, type ClaimInput, type ClaimStatus } from "../domain/insurance";
import type { ClaimEntryRow, ClaimRow, CoverageRow, InsuranceDeps, InsuranceReadDeps, PolicyRow, PremiumRow } from "./ports";

type Id = Result<{ id: string }>;
const hasErrors = (e: FieldErrors) => Object.keys(e).length > 0;

async function refs(deps: InsuranceDeps, r: { assetIds?: (string | undefined)[]; parties?: (string | undefined)[]; documents?: (string | undefined)[]; matter?: string; policyId?: string }): Promise<FieldErrors> {
  const errors: FieldErrors = {};
  const wantedAssets = (r.assetIds ?? []).filter((x): x is string => Boolean(x));
  if (wantedAssets.length > 0) {
    const known = new Set((await deps.others.assets()).map((a) => a.id));
    if (wantedAssets.some((a) => !known.has(a))) errors.assetIds = ["Uno degli immobili non esiste"];
  }
  const wantedParties = (r.parties ?? []).filter((x): x is string => Boolean(x));
  if (wantedParties.length > 0) {
    const known = await deps.others.parties();
    if (wantedParties.some((p) => !known.has(p))) errors.partyId = ["Il contatto non esiste più nella rubrica"];
  }
  const wantedDocuments = (r.documents ?? []).filter((x): x is string => Boolean(x));
  if (wantedDocuments.length > 0) {
    const known = await deps.others.documentTitles();
    if (wantedDocuments.some((d) => !known.has(d))) errors.documentId = ["Il documento non esiste"];
  }
  if (r.matter && !(await deps.others.matterTitles()).has(r.matter)) errors.matterId = ["La pratica non esiste"];
  if (r.policyId && !(await deps.repo.getPolicy(r.policyId))) errors.policyId = ["La polizza non esiste"];
  return errors;
}

/** Il campo del modulo si chiama come i dati: si riportano sotto il nome giusto gli errori che `refs` chiama in modo generico. */
const rename = (errors: FieldErrors, from: string, to: string): FieldErrors => Object.fromEntries(Object.entries(errors).map(([k, v]) => [k === from ? to : k, v]));

// -------------------------------------------------------------------------------------------------- polizze

export async function createPolicy(deps: InsuranceDeps, raw: unknown): Promise<Id> {
  const p = parseInput(policySchema, raw);
  if (!p.ok) return p;
  const v = { ...p.value, assetIds: [...new Set(p.value.assetIds)] };
  const errors = await refs(deps, { assetIds: v.assetIds, parties: [v.insurerPartyId, v.agentPartyId], documents: [v.documentId] });
  if (hasErrors(errors)) return fail(rename(errors, "partyId", "insurerPartyId"));
  if (v.createDeadline && !v.endsOn) return fail({ endsOn: ["Per creare il promemoria serve la data di fine"] });
  const id = await deps.repo.insertPolicy({
    title: v.title,
    insurerPartyId: v.insurerPartyId ?? null,
    agentPartyId: v.agentPartyId ?? null,
    policyNumber: v.policyNumber ?? null,
    startsOn: v.startsOn ?? null,
    endsOn: v.endsOn ?? null,
    premiumCents: v.premium ?? null,
    note: v.note ?? null,
    documentId: v.documentId ?? null,
    deadlineId: null,
    archived: false,
  });
  await deps.repo.setPolicyAssets(id, v.assetIds);
  let deadlineCreated = false;
  if (v.createDeadline && v.endsOn) {
    const deadlineId = await deps.others.createDeadline({ title: `Rinnovo della polizza: ${v.title}`, dueOn: v.endsOn, assetId: v.assetIds.length === 1 ? v.assetIds[0] : undefined, proofRequired: false });
    if (deadlineId) {
      await deps.repo.updatePolicy(id, { deadlineId });
      deadlineCreated = true;
    }
  }
  await deps.audit.record({ action: "insurance.policy.create", entityType: "ins_policy", entityId: id, diff: { assets: v.assetIds.length, deadlineCreated } });
  return ok({ id });
}

export async function updatePolicy(deps: InsuranceDeps, id: string, raw: unknown): Promise<Id> {
  const p = parseInput(policySchema, raw);
  if (!p.ok) return p;
  if (!(await deps.repo.getPolicy(id))) return failGeneral("Polizza non trovata");
  const v = { ...p.value, assetIds: [...new Set(p.value.assetIds)] };
  const errors = await refs(deps, { assetIds: v.assetIds, parties: [v.insurerPartyId, v.agentPartyId], documents: [v.documentId] });
  if (hasErrors(errors)) return fail(rename(errors, "partyId", "insurerPartyId"));
  await deps.repo.updatePolicy(id, { title: v.title, insurerPartyId: v.insurerPartyId ?? null, agentPartyId: v.agentPartyId ?? null, policyNumber: v.policyNumber ?? null, startsOn: v.startsOn ?? null, endsOn: v.endsOn ?? null, premiumCents: v.premium ?? null, note: v.note ?? null, documentId: v.documentId ?? null });
  await deps.repo.setPolicyAssets(id, v.assetIds);
  await deps.audit.record({ action: "insurance.policy.update", entityType: "ins_policy", entityId: id, diff: { assets: v.assetIds.length } });
  return ok({ id });
}

export async function setPolicyArchived(deps: InsuranceDeps, id: string, archived: boolean): Promise<Id> {
  const policy = await deps.repo.getPolicy(id);
  if (!policy) return failGeneral("Polizza non trovata");
  await deps.repo.updatePolicy(id, { archived });
  if (policy.deadlineId) await deps.others.archiveDeadline(policy.deadlineId, archived);
  await deps.audit.record({ action: archived ? "insurance.policy.archive" : "insurance.policy.restore", entityType: "ins_policy", entityId: id, diff: {} });
  return ok({ id });
}

/** Crea il promemoria di rinnovo di una polizza che ha una data di fine e non ce l'ha ancora. */
export async function createPolicyDeadline(deps: InsuranceDeps, id: string): Promise<Id> {
  const policy = await deps.repo.getPolicy(id);
  if (!policy) return failGeneral("Polizza non trovata");
  if (policy.deadlineId) return failGeneral("La polizza ha già un promemoria");
  if (!policy.endsOn) return fail({ endsOn: ["Per creare il promemoria serve la data di fine: aggiungila dalla modifica"] });
  const assetIds = await deps.repo.policyAssets(id);
  const deadlineId = await deps.others.createDeadline({ title: `Rinnovo della polizza: ${policy.title}`, dueOn: policy.endsOn, assetId: assetIds.length === 1 ? assetIds[0] : undefined, proofRequired: false });
  if (!deadlineId) return failGeneral("Non è stato possibile creare il promemoria");
  await deps.repo.updatePolicy(id, { deadlineId });
  await deps.audit.record({ action: "insurance.policy.deadline", entityType: "ins_policy", entityId: id, diff: {} });
  return ok({ id });
}

// -------------------------------------------------------------------------------------------------- garanzie e premi

export async function addCoverage(deps: InsuranceDeps, policyId: string, raw: unknown): Promise<Id> {
  const p = parseInput(coverageSchema, raw);
  if (!p.ok) return p;
  if (!(await deps.repo.getPolicy(policyId))) return failGeneral("Polizza non trovata");
  const id = await deps.repo.insertCoverage({ policyId, title: p.value.title, sumInsuredCents: p.value.sumInsured ?? null, deductibleCents: p.value.deductible ?? null, note: p.value.note ?? null });
  await deps.audit.record({ action: "insurance.coverage.add", entityType: "ins_policy", entityId: policyId, diff: { coverageId: id } });
  return ok({ id: policyId });
}

export async function removeCoverage(deps: InsuranceDeps, coverageId: string): Promise<Id> {
  const coverage = await deps.repo.getCoverage(coverageId);
  if (!coverage) return failGeneral("Garanzia non trovata");
  await deps.repo.deleteCoverage(coverageId);
  await deps.audit.record({ action: "insurance.coverage.remove", entityType: "ins_policy", entityId: coverage.policyId, diff: { coverageId } });
  return ok({ id: coverage.policyId });
}

export async function addPremium(deps: InsuranceDeps, policyId: string, raw: unknown): Promise<Id> {
  const p = parseInput(premiumSchema, raw);
  if (!p.ok) return p;
  const policy = await deps.repo.getPolicy(policyId);
  if (!policy) return failGeneral("Polizza non trovata");
  const v = p.value;
  const errors = await refs(deps, { documents: [v.documentId] });
  if (hasErrors(errors)) return fail(errors);
  const id = await deps.repo.insertPremium({ policyId, dueOn: v.dueOn, amountCents: v.amount, paidOn: v.paidOn ?? null, documentId: v.documentId ?? null, deadlineId: null });
  let deadlineCreated = false;
  if (v.createDeadline && !v.paidOn) {
    const assetIds = await deps.repo.policyAssets(policyId);
    const deadlineId = await deps.others.createDeadline({ title: `Premio della polizza: ${policy.title}`, dueOn: v.dueOn, assetId: assetIds.length === 1 ? assetIds[0] : undefined, proofRequired: true });
    if (deadlineId) {
      await deps.repo.updatePremium(id, { deadlineId });
      deadlineCreated = true;
    }
  }
  await deps.audit.record({ action: "insurance.premium.add", entityType: "ins_policy", entityId: policyId, diff: { premiumId: id, paid: Boolean(v.paidOn), deadlineCreated } });
  return ok({ id: policyId });
}

/** Segna un premio come pagato (con la data e, se c'e', la ricevuta); la scadenza collegata si chiude. */
export async function setPremiumPaid(deps: InsuranceDeps, premiumId: string, raw: unknown): Promise<Id> {
  const p = parseInput(premiumPaidSchema, raw);
  if (!p.ok) return p;
  const premium = await deps.repo.getPremium(premiumId);
  if (!premium) return failGeneral("Premio non trovato");
  const errors = await refs(deps, { documents: [p.value.documentId] });
  if (hasErrors(errors)) return fail(errors);
  await deps.repo.updatePremium(premiumId, { paidOn: p.value.paidOn, documentId: p.value.documentId ?? premium.documentId });
  if (premium.deadlineId) await deps.others.completeDeadline(premium.deadlineId, { completedOn: p.value.paidOn, reference: "Premio segnato come pagato" });
  await deps.audit.record({ action: "insurance.premium.paid", entityType: "ins_policy", entityId: premium.policyId, diff: { premiumId, withProof: Boolean(p.value.documentId ?? premium.documentId) } });
  return ok({ id: premium.policyId });
}

export async function removePremium(deps: InsuranceDeps, premiumId: string): Promise<Id> {
  const premium = await deps.repo.getPremium(premiumId);
  if (!premium) return failGeneral("Premio non trovato");
  await deps.repo.deletePremium(premiumId);
  if (premium.deadlineId) await deps.others.archiveDeadline(premium.deadlineId, true);
  await deps.audit.record({ action: "insurance.premium.remove", entityType: "ins_policy", entityId: premium.policyId, diff: { premiumId } });
  return ok({ id: premium.policyId });
}

// -------------------------------------------------------------------------------------------------- sinistri

function claimData(v: ClaimInput, closedOn: string | null): Omit<ClaimRow, "id"> {
  return {
    policyId: v.policyId,
    assetId: v.assetId ?? null,
    title: v.title,
    claimNumber: v.claimNumber ?? null,
    occurredOn: v.occurredOn,
    reportedOn: v.reportedOn ?? null,
    status: v.status,
    claimedCents: v.claimed ?? null,
    receivedCents: v.received ?? null,
    adjusterPartyId: v.adjusterPartyId ?? null,
    matterId: v.matterId ?? null,
    description: v.description ?? null,
    closedOn,
  };
}

const closedOnFor = (status: ClaimStatus, current: string | null, today: string): string | null => (isClaimOpen(status) ? null : (current ?? today));

export async function createClaim(deps: InsuranceDeps, raw: unknown, today: string): Promise<Id> {
  const p = parseInput(claimSchema, raw);
  if (!p.ok) return p;
  const v = p.value;
  const errors = await refs(deps, { policyId: v.policyId, assetIds: [v.assetId], parties: [v.adjusterPartyId], matter: v.matterId });
  if (hasErrors(errors)) return fail(rename(rename(errors, "partyId", "adjusterPartyId"), "assetIds", "assetId"));
  const id = await deps.repo.insertClaim(claimData(v, closedOnFor(v.status, null, today)));
  await deps.audit.record({ action: "insurance.claim.create", entityType: "ins_claim", entityId: id, diff: { status: v.status } });
  return ok({ id });
}

export async function updateClaim(deps: InsuranceDeps, id: string, raw: unknown, today: string): Promise<Id> {
  const p = parseInput(claimSchema, raw);
  if (!p.ok) return p;
  const current = await deps.repo.getClaim(id);
  if (!current) return failGeneral("Sinistro non trovato");
  const v = p.value;
  const errors = await refs(deps, { policyId: v.policyId, assetIds: [v.assetId], parties: [v.adjusterPartyId], matter: v.matterId });
  if (hasErrors(errors)) return fail(rename(rename(errors, "partyId", "adjusterPartyId"), "assetIds", "assetId"));
  await deps.repo.updateClaim(id, claimData(v, closedOnFor(v.status, current.closedOn, today)));
  await deps.audit.record({ action: "insurance.claim.update", entityType: "ins_claim", entityId: id, diff: { statusFrom: current.status, statusTo: v.status } });
  return ok({ id });
}

/** Cambia solo lo stato del sinistro (la data di chiusura si compila da sola quando passa a liquidato o chiuso). */
export async function setClaimStatus(deps: InsuranceDeps, id: string, status: string, today: string): Promise<Id> {
  if (!(CLAIM_STATUSES as readonly string[]).includes(status)) return fail({ status: ["Stato non valido"] });
  const claim = await deps.repo.getClaim(id);
  if (!claim) return failGeneral("Sinistro non trovato");
  const next = status as ClaimStatus;
  await deps.repo.updateClaim(id, { status: next, closedOn: closedOnFor(next, claim.closedOn, today) });
  await deps.audit.record({ action: "insurance.claim.status", entityType: "ins_claim", entityId: id, diff: { statusFrom: claim.status, statusTo: next } });
  return ok({ id });
}

export async function addClaimEntry(deps: InsuranceDeps, claimId: string, raw: unknown, today: string): Promise<Id> {
  const p = parseInput(claimEntrySchema, raw);
  if (!p.ok) return p;
  if (!(await deps.repo.getClaim(claimId))) return failGeneral("Sinistro non trovato");
  const errors = await refs(deps, { documents: [p.value.documentId] });
  if (hasErrors(errors)) return fail(errors);
  const id = await deps.repo.insertEntry({ claimId, entryOn: p.value.entryOn ?? today, direction: p.value.direction, summary: p.value.summary, documentId: p.value.documentId ?? null });
  await deps.audit.record({ action: "insurance.claim.entry", entityType: "ins_claim", entityId: claimId, diff: { entryId: id, direction: p.value.direction } });
  return ok({ id: claimId });
}

export async function removeClaimEntry(deps: InsuranceDeps, entryId: string): Promise<Id> {
  const entry = await deps.repo.getEntry(entryId);
  if (!entry) return failGeneral("Voce non trovata");
  await deps.repo.deleteEntry(entryId);
  await deps.audit.record({ action: "insurance.claim.entry.remove", entityType: "ins_claim", entityId: entry.claimId, diff: { entryId } });
  return ok({ id: entry.claimId });
}

// -------------------------------------------------------------------------------------------------- letture

/**
 * I premi pagati in un periodo, uno per riga. Una polizza che riguarda UN solo immobile assegna il premio a quell'immobile;
 * con piu' immobili (o nessuno) il premio non si ripartisce (nessuna ripartizione inventata): `assetId` e' nullo.
 */
export async function premiumLedger(deps: InsuranceReadDeps, from: string, to: string) {
  const [rows, policies, links] = await Promise.all([deps.repo.paidPremiumsBetween(from, to), deps.repo.listPolicies(true), deps.repo.allPolicyAssets()]);
  return rows.map((r) => {
    const assets = links.filter((l) => l.policyId === r.policyId).map((l) => l.assetId);
    return { id: r.id, refId: r.policyId, date: r.paidOn, amountCents: r.amountCents, documentId: r.documentId, assetId: assets.length === 1 ? assets[0]! : null, label: `Premio: ${policies.find((p) => p.id === r.policyId)?.title ?? "polizza"}` };
  });
}

export type PolicyItem = PolicyRow & {
  insurerName: string | null;
  agentName: string | null;
  assets: { id: string; name: string }[];
  state: PeriodState;
  openClaims: number;
  nextPremium: { dueOn: string; amountCents: number; overdue: boolean } | null;
};

export async function listPolicies(deps: InsuranceReadDeps, includeArchived: boolean, today: string): Promise<PolicyItem[]> {
  const [rows, assets, parties, links, premiums, claims] = await Promise.all([deps.repo.listPolicies(includeArchived), deps.others.assets(), deps.others.parties(), deps.repo.allPolicyAssets(), deps.repo.allPremiums(), deps.repo.listClaims({})]);
  const assetName = new Map(assets.map((a) => [a.id, a.name]));
  return rows.map((p) => {
    const unpaid = premiums.filter((x) => x.policyId === p.id && x.paidOn === null).sort((a, b) => a.dueOn.localeCompare(b.dueOn))[0];
    return {
      ...p,
      insurerName: p.insurerPartyId ? (parties.get(p.insurerPartyId) ?? null) : null,
      agentName: p.agentPartyId ? (parties.get(p.agentPartyId) ?? null) : null,
      assets: links.filter((l) => l.policyId === p.id).map((l) => ({ id: l.assetId, name: assetName.get(l.assetId) ?? "" })),
      state: periodState(p, today),
      openClaims: claims.filter((c) => c.policyId === p.id && isClaimOpen(c.status)).length,
      nextPremium: unpaid ? { dueOn: unpaid.dueOn, amountCents: unpaid.amountCents, overdue: premiumOverdue(unpaid, today) } : null,
    };
  });
}

export type PolicyDetail = PolicyItem & {
  documentTitle: string | null;
  coverages: CoverageRow[];
  premiums: (PremiumRow & { documentTitle: string | null; overdue: boolean })[];
  claims: ClaimItem[];
};

export async function getPolicyDetail(deps: InsuranceReadDeps, id: string, today: string): Promise<PolicyDetail | null> {
  const policy = (await listPolicies(deps, true, today)).find((p) => p.id === id);
  if (!policy) return null;
  const [titles, coverages, premiums, claims] = await Promise.all([deps.others.documentTitles(), deps.repo.coverages(id), deps.repo.premiums(id), listClaims(deps, { policyId: id, includeClosed: true })]);
  return {
    ...policy,
    documentTitle: policy.documentId ? (titles.get(policy.documentId) ?? null) : null,
    coverages,
    premiums: premiums.map((x) => ({ ...x, documentTitle: x.documentId ? (titles.get(x.documentId) ?? null) : null, overdue: premiumOverdue(x, today) })),
    claims,
  };
}

export type ClaimItem = ClaimRow & { policyTitle: string; assetName: string | null; adjusterName: string | null; matterTitle: string | null; open: boolean };

export async function listClaims(deps: InsuranceReadDeps, filter: { policyId?: string; includeClosed?: boolean }): Promise<ClaimItem[]> {
  const [rows, policies, assets, parties, matters] = await Promise.all([deps.repo.listClaims({ policyId: filter.policyId }), deps.repo.listPolicies(true), deps.others.assets(), deps.others.parties(), deps.others.matterTitles()]);
  return rows
    .filter((c) => filter.includeClosed || isClaimOpen(c.status))
    .map((c) => ({
      ...c,
      policyTitle: policies.find((p) => p.id === c.policyId)?.title ?? "",
      assetName: c.assetId ? (assets.find((a) => a.id === c.assetId)?.name ?? null) : null,
      adjusterName: c.adjusterPartyId ? (parties.get(c.adjusterPartyId) ?? null) : null,
      matterTitle: c.matterId ? (matters.get(c.matterId) ?? null) : null,
      open: isClaimOpen(c.status),
    }));
}

export type ClaimDetail = ClaimItem & { entries: (ClaimEntryRow & { documentTitle: string | null })[] };

export async function getClaimDetail(deps: InsuranceReadDeps, id: string): Promise<ClaimDetail | null> {
  const claim = (await listClaims(deps, { includeClosed: true })).find((c) => c.id === id);
  if (!claim) return null;
  const [entries, titles] = await Promise.all([deps.repo.entries(id), deps.others.documentTitles()]);
  return { ...claim, entries: entries.map((e) => ({ ...e, documentTitle: e.documentId ? (titles.get(e.documentId) ?? null) : null })) };
}
