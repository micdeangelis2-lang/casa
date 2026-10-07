import { getTranslations } from "next-intl/server";
import { getDb } from "@/platform/db/client";
import { listAssets } from "@/modules/assets";
import { listParties } from "@/modules/directory";
import { listDocumentOptions } from "@/modules/documents";
import { LETTING_STATUSES, LETTING_TYPES, isContractType, type LettingDetail, type LettingType } from "@/modules/lettings";
import type { FormSection, FormValues } from "@/components/simple-form";
import { formatEuro } from "@/lib/format";

const euro = (cents: number | null) => (cents === null ? "" : formatEuro(cents));

export const lettingValues = (l?: LettingDetail, preset: { assetId?: string } = {}): FormValues => ({
  type: l?.type ?? "",
  assetId: l?.assetId ?? preset.assetId ?? "",
  title: l?.title ?? "",
  status: l?.status ?? "active",
  startsOn: l?.startsOn ?? "",
  endsOn: l?.endsOn ?? "",
  managerPartyId: l?.managerPartyId ?? "",
  monthlyRent: euro(l?.monthlyRentCents ?? null),
  deposit: euro(l?.depositCents ?? null),
  depositReceivedOn: l?.depositReceivedOn ?? "",
  depositReturnedOn: l?.depositReturnedOn ?? "",
  depositReturned: euro(l?.depositReturnedCents ?? null),
  registeredOn: l?.registeredOn ?? "",
  registrationNumber: l?.registrationNumber ?? "",
  registrationOffice: l?.registrationOffice ?? "",
  contractDocumentId: l?.contractDocumentId ?? "",
  note: l?.note ?? "",
  createDeadline: false,
});

/**
 * Il modulo di una locazione o attivita'. Il tipo si sceglie per primo; i campi del contratto (canone, cauzione,
 * registrazione) compaiono solo per i tipi di durata.
 */
export async function lettingSections(editing: boolean): Promise<FormSection[]> {
  const tf = await getTranslations("lettings.form");
  const tl = await getTranslations("lettings");
  const db = getDb();
  const [assets, parties, documents] = await Promise.all([listAssets(db), listParties(db), listDocumentOptions(db)]);
  const contractTypes = LETTING_TYPES.filter((t: LettingType) => isContractType(t));
  const showContract = { name: "type", in: [...contractTypes] };
  return [
    {
      intro: tf("intro"),
      fields: [
        { kind: "select", name: "type", label: tf("type"), options: LETTING_TYPES.map((t) => ({ value: t, label: tl(`types.${t}`) })), emptyLabel: tf("chooseType") },
        { kind: "select", name: "assetId", label: tf("asset"), options: assets.map((a) => ({ value: a.id, label: a.name })), emptyLabel: tf("chooseAsset") },
        { kind: "text", name: "title", label: tf("title"), hint: tf("titleHint"), maxLength: 200 },
        { kind: "select", name: "status", label: tf("status"), options: LETTING_STATUSES.map((s) => ({ value: s, label: tl(`status.${s}`) })) },
        { kind: "date", name: "startsOn", label: tf("startsOn") },
        { kind: "date", name: "endsOn", label: tf("endsOn") },
        { kind: "select", name: "managerPartyId", label: tf("manager"), options: parties.map((p) => ({ value: p.id, label: p.displayName })), emptyLabel: tf("none") },
      ],
      columns: 2,
    },
    {
      fields: [
        { kind: "text", name: "monthlyRent", label: tf("monthlyRent"), inputMode: "decimal", maxLength: 14, showIf: showContract },
        { kind: "text", name: "deposit", label: tf("deposit"), inputMode: "decimal", maxLength: 14, showIf: showContract },
        { kind: "date", name: "depositReceivedOn", label: tf("depositReceivedOn"), showIf: showContract },
        { kind: "date", name: "depositReturnedOn", label: tf("depositReturnedOn"), showIf: showContract },
        { kind: "text", name: "depositReturned", label: tf("depositReturned"), inputMode: "decimal", maxLength: 14, showIf: showContract },
        { kind: "date", name: "registeredOn", label: tf("registeredOn"), showIf: showContract },
        { kind: "text", name: "registrationNumber", label: tf("registrationNumber"), maxLength: 60, showIf: showContract },
        { kind: "text", name: "registrationOffice", label: tf("registrationOffice"), maxLength: 120, showIf: showContract },
        { kind: "select", name: "contractDocumentId", label: tf("contractDocument"), options: documents, emptyLabel: tf("none"), showIf: showContract },
      ],
      columns: 2,
    },
    {
      fields: [
        { kind: "textarea", name: "note", label: tf("note"), maxLength: 2000 },
        ...(editing ? [] : ([{ kind: "checkbox", name: "createDeadline", label: tf("createDeadline") }] as const)),
      ],
    },
  ];
}
