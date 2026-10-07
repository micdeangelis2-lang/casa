import { getDb } from "@/platform/db/client";
import { listAssets } from "@/modules/assets";
import { listParties } from "@/modules/directory";

/** Opzioni dei selettori del modulo immobile: contatti della rubrica e altri beni collegabili. */
export async function loadAssetFormOptions(excludeAssetId?: string) {
  const db = getDb();
  const [parties, assets] = await Promise.all([listParties(db), listAssets(db)]);
  const ownerParty = parties.find((p) => p.roles.includes("owner")) ?? null;
  return {
    ownerPartyId: ownerParty?.id ?? null,
    parties: parties.map((p) => ({ id: p.id, label: p.displayName })),
    otherAssets: assets.filter((a) => a.id !== excludeAssetId).map((a) => ({ id: a.id, label: a.name })),
  };
}
