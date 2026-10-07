import type { AssetDetail } from "@/modules/assets";

/** Stato del modulo immobile: tutto testo, come lo scrive l'utente. Condiviso tra pagine (server) e modulo (client). */
export type TerritoryChoice = { id: string; label: string };

export type RightRow = {
  key: string;
  holder: string;
  rightType: string;
  quotaNumerator: string;
  quotaDenominator: string;
  validFrom: string;
  validTo: string;
  notes: string;
};

export type CadastralRow = {
  key: string;
  sheet: string;
  parcel: string;
  subunit: string;
  cadastralCategory: string;
  cadastralClass: string;
  consistency: string;
  income: string;
  validFrom: string;
  validTo: string;
  notes: string;
};

/** Caratteristica tecnica: nome (slug), tipo e valore come testo. */
export type AttributeRow = { key: string; name: string; type: string; value: string };

export type LinkRow = { key: string; mainAssetId: string; declaredBasis: string; validationStatus: string };

export type AssetFormState = {
  kind: string;
  name: string;
  territory: TerritoryChoice | null;
  locality: string;
  address: string;
  postalCode: string;
  useType: string;
  inCondominium: boolean;
  notes: string;
  rights: RightRow[];
  cadastral: CadastralRow[];
  links: LinkRow[];
  attributes: AttributeRow[];
};

export const emptyAssetForm = (): AssetFormState => ({
  kind: "dwelling",
  name: "",
  territory: null,
  locality: "",
  address: "",
  postalCode: "",
  useType: "",
  inCondominium: false,
  notes: "",
  rights: [],
  cadastral: [],
  links: [],
  attributes: [],
});

export const newRightRow = (holder = ""): RightRow => ({
  key: crypto.randomUUID(),
  holder,
  rightType: "full",
  quotaNumerator: "1",
  quotaDenominator: "1",
  validFrom: "",
  validTo: "",
  notes: "",
});

export const newCadastralRow = (): CadastralRow => ({
  key: crypto.randomUUID(),
  sheet: "",
  parcel: "",
  subunit: "",
  cadastralCategory: "",
  cadastralClass: "",
  consistency: "",
  income: "",
  validFrom: "",
  validTo: "",
  notes: "",
});

export const newAttributeRow = (): AttributeRow => ({ key: crypto.randomUUID(), name: "", type: "text", value: "" });

export const newLinkRow = (): LinkRow => ({ key: crypto.randomUUID(), mainAssetId: "", declaredBasis: "", validationStatus: "declared" });

const euro = (cents: number | null) =>
  cents === null ? "" : (cents / 100).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Dalla scheda salvata al modulo di modifica. */
export function detailToFormState(detail: AssetDetail & { territoryLabel: string }): AssetFormState {
  return {
    kind: detail.kind,
    name: detail.name,
    territory: { id: detail.territoryId, label: detail.territoryLabel },
    locality: detail.locality ?? "",
    address: detail.address ?? "",
    postalCode: detail.postalCode ?? "",
    useType: detail.useType ?? "",
    inCondominium: detail.inCondominium,
    notes: detail.notes ?? "",
    rights: detail.rights.map((r) => ({
      key: r.id,
      holder: r.holder.id,
      rightType: r.rightType,
      quotaNumerator: String(r.quotaNumerator),
      quotaDenominator: String(r.quotaDenominator),
      validFrom: r.validFrom ?? "",
      validTo: r.validTo ?? "",
      notes: r.notes ?? "",
    })),
    cadastral: detail.cadastral.map((c) => ({
      key: c.id,
      sheet: c.sheet ?? "",
      parcel: c.parcel ?? "",
      subunit: c.subunit ?? "",
      cadastralCategory: c.cadastralCategory ?? "",
      cadastralClass: c.cadastralClass ?? "",
      consistency: c.consistency ?? "",
      income: euro(c.incomeCents),
      validFrom: c.validFrom ?? "",
      validTo: c.validTo ?? "",
      notes: c.notes ?? "",
    })),
    attributes: Object.entries(detail.attributes).map(([name, value]) => ({
      key: name,
      name,
      type: typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "text",
      value: String(value),
    })),
    links: detail.linkedTo.map((l) => ({
      key: l.id,
      mainAssetId: l.asset.id,
      declaredBasis: l.declaredBasis ?? "",
      validationStatus: l.validationStatus,
    })),
  };
}

/** Toglie la chiave di React (usata solo per l'elenco) prima di inviare i dati. */
const withoutKey = <T extends { key: string }>(row: T): Omit<T, "key"> =>
  Object.fromEntries(Object.entries(row).filter(([name]) => name !== "key")) as Omit<T, "key">;

/** Dal modulo al formato atteso dal server (la validazione vera la fa il server). */
export function formStateToPayload(state: AssetFormState): unknown {
  return {
    kind: state.kind,
    name: state.name,
    territoryId: state.territory?.id ?? "",
    locality: state.locality,
    address: state.address,
    postalCode: state.postalCode,
    useType: state.useType,
    inCondominium: state.inCondominium,
    notes: state.notes,
    rights: state.rights.map((r) => ({
      holder: r.holder === "self" ? { type: "self" } : { type: "party", partyId: r.holder },
      rightType: r.rightType,
      quotaNumerator: r.quotaNumerator,
      quotaDenominator: r.quotaDenominator,
      validFrom: r.validFrom,
      validTo: r.validTo,
      notes: r.notes,
    })),
    cadastral: state.cadastral.map(withoutKey),
    links: state.links.map(withoutKey),
    attributes: state.attributes.map((a) => ({ key: a.name, type: a.type, value: a.value })),
  };
}
