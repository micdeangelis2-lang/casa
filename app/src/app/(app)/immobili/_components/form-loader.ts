import { getDb } from "@/platform/db/client";
import { getOwnerSession } from "@/platform/auth/owner";
import { listAssets } from "@/modules/assets";
import { listParties } from "@/modules/directory";

/** Opzioni dei selettori del modulo immobile: contatti della rubrica e altri beni collegabili. */
export async function loadAssetFormOptions(excludeAssetId?: string) {
  const db = getDb();
  const [owner, parties, assets] = await Promise.all([getOwnerSession(), listParties(db), listAssets(db)]);
  const ownerParty = owner?.email
    ? parties.find((p) => p.email && p.email.toLowerCase() === owner.email.toLowerCase()) ?? null
    : null;
  return {
    ownerName: owner?.name ?? null,
    ownerPartyId: ownerParty?.id ?? null,
    parties: parties.map((p) => ({ id: p.id, label: p.displayName })),
    otherAssets: assets.filter((a) => a.id !== excludeAssetId).map((a) => ({ id: a.id, label: a.name })),
  };
}
