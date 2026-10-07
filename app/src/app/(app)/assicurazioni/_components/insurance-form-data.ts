import { getTranslations } from "next-intl/server";
import { getDb } from "@/platform/db/client";
import { listAssets } from "@/modules/assets";
import { listParties } from "@/modules/directory";
import { listDocumentOptions } from "@/modules/documents";
import { listMatters } from "@/modules/matters";
import { CLAIM_STATUSES, listPolicies, type ClaimDetail, type PolicyDetail } from "@/modules/insurance";
import type { FormSection, FormValues } from "@/components/simple-form";
import { formatEuro } from "@/lib/format";

const euro = (cents: number | null) => (cents === null ? "" : formatEuro(cents));

export const policyValues = (p?: PolicyDetail): FormValues => ({
  title: p?.title ?? "",
  insurerPartyId: p?.insurerPartyId ?? "",
  agentPartyId: p?.agentPartyId ?? "",
  policyNumber: p?.policyNumber ?? "",
  startsOn: p?.startsOn ?? "",
  endsOn: p?.endsOn ?? "",
  premium: euro(p?.premiumCents ?? null),
  documentId: p?.documentId ?? "",
  assetIds: p?.assets.map((a) => a.id) ?? [],
  note: p?.note ?? "",
  createDeadline: false,
});

export async function policySections(editing: boolean): Promise<FormSection[]> {
  const tf = await getTranslations("insurance.form");
  const db = getDb();
  const [assets, parties, documents] = await Promise.all([listAssets(db), listParties(db), listDocumentOptions(db)]);
  const partyOptions = parties.map((p) => ({ value: p.id, label: p.displayName }));
  return [
    {
      fields: [
        { kind: "text", name: "title", label: tf("title"), maxLength: 200 },
        { kind: "text", name: "policyNumber", label: tf("policyNumber"), maxLength: 80 },
        { kind: "select", name: "insurerPartyId", label: tf("insurer"), options: partyOptions, emptyLabel: tf("none") },
        { kind: "select", name: "agentPartyId", label: tf("agent"), options: partyOptions, emptyLabel: tf("none") },
        { kind: "date", name: "startsOn", label: tf("startsOn") },
        { kind: "date", name: "endsOn", label: tf("endsOn") },
        { kind: "text", name: "premium", label: tf("premium"), hint: tf("premiumHint"), inputMode: "decimal", maxLength: 14 },
        { kind: "select", name: "documentId", label: tf("document"), options: documents, emptyLabel: tf("none") },
      ],
      columns: 2,
    },
    {
      fields: [
        { kind: "multicheck", name: "assetIds", label: tf("assets"), options: assets.map((a) => ({ value: a.id, label: a.name })), emptyText: tf("noAssets") },
        { kind: "textarea", name: "note", label: tf("note"), maxLength: 1000 },
        ...(editing ? [] : ([{ kind: "checkbox", name: "createDeadline", label: tf("createDeadline") }] as const)),
      ],
    },
  ];
}

export const claimValues = (c?: ClaimDetail, preset: { policyId?: string } = {}): FormValues => ({
  policyId: c?.policyId ?? preset.policyId ?? "",
  assetId: c?.assetId ?? "",
  title: c?.title ?? "",
  claimNumber: c?.claimNumber ?? "",
  occurredOn: c?.occurredOn ?? "",
  reportedOn: c?.reportedOn ?? "",
  status: c?.status ?? "open",
  claimed: euro(c?.claimedCents ?? null),
  received: euro(c?.receivedCents ?? null),
  adjusterPartyId: c?.adjusterPartyId ?? "",
  matterId: c?.matterId ?? "",
  description: c?.description ?? "",
});

export async function claimSections(): Promise<FormSection[]> {
  const tf = await getTranslations("insurance.claimForm");
  const ts = await getTranslations("insurance.claimStatus");
  const db = getDb();
  const [policies, assets, parties, matters] = await Promise.all([listPolicies(db, true), listAssets(db), listParties(db), listMatters(db, { includeClosed: true })]);
  return [
    {
      fields: [
        { kind: "select", name: "policyId", label: tf("policy"), options: policies.map((p) => ({ value: p.id, label: p.title })), emptyLabel: tf("choosePolicy") },
        { kind: "text", name: "title", label: tf("title"), maxLength: 200 },
        { kind: "select", name: "assetId", label: tf("asset"), options: assets.map((a) => ({ value: a.id, label: a.name })), emptyLabel: tf("none") },
        { kind: "text", name: "claimNumber", label: tf("claimNumber"), maxLength: 80 },
        { kind: "date", name: "occurredOn", label: tf("occurredOn") },
        { kind: "date", name: "reportedOn", label: tf("reportedOn") },
        { kind: "select", name: "status", label: tf("status"), options: CLAIM_STATUSES.map((s) => ({ value: s, label: ts(s) })) },
        { kind: "select", name: "adjusterPartyId", label: tf("adjuster"), options: parties.map((p) => ({ value: p.id, label: p.displayName })), emptyLabel: tf("none") },
        { kind: "text", name: "claimed", label: tf("claimed"), inputMode: "decimal", maxLength: 14 },
        { kind: "text", name: "received", label: tf("received"), inputMode: "decimal", maxLength: 14 },
        { kind: "select", name: "matterId", label: tf("matter"), options: matters.map((m) => ({ value: m.id, label: m.title })), emptyLabel: tf("none") },
      ],
      columns: 2,
    },
    { fields: [{ kind: "textarea", name: "description", label: tf("description"), maxLength: 2000 }] },
  ];
}
