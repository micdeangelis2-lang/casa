import { fail, failGeneral, ok, zodIssuesToErrors, type FieldErrors, type Result } from "@/shared/result";
import { assetInputSchema, declaredValueSchema, type AssetDetail, type AssetInput } from "../domain/asset";
import type { AssetChildren, AssetCore, AssetDeps, AssetRepository } from "./ports";

const GENERIC = { territory: "Il Comune scelto non esiste", municipalityOrLocality: "Scegli un Comune o una località" };

type Prepared = { core: AssetCore; children: AssetChildren };

/** Controlli che richiedono di consultare il database o altri moduli; la validazione dei campi e' gia' fatta da Zod. */
async function prepare(deps: AssetDeps, input: AssetInput, selfAssetId?: string): Promise<Result<Prepared>> {
  const errors: FieldErrors = {};

  const territoryKind = await deps.others.territoryKind(input.territoryId);
  if (!territoryKind) errors.territoryId = [GENERIC.territory];
  else if (territoryKind !== "municipality" && territoryKind !== "locality") errors.territoryId = [GENERIC.municipalityOrLocality];

  const partyIds = input.rights.flatMap((r) => (r.holder.type === "party" ? [r.holder.partyId] : []));
  if (partyIds.length > 0) {
    const existing = await deps.others.existingPartyIds([...new Set(partyIds)]);
    input.rights.forEach((r, i) => {
      if (r.holder.type === "party" && !existing.has(r.holder.partyId)) errors[`rights.${i}.holder`] = ["Il titolare non esiste più nella rubrica"];
    });
  }

  if (input.links.length > 0) {
    const targets = input.links.map((l) => l.mainAssetId);
    const existing = await deps.repo.existingIds(targets);
    const reverse = selfAssetId ? await deps.repo.idsLinkedTo(selfAssetId) : new Set<string>();
    input.links.forEach((l, i) => {
      if (l.mainAssetId === selfAssetId) errors[`links.${i}.mainAssetId`] = ["Un bene non può essere collegato a se stesso"];
      else if (!existing.has(l.mainAssetId)) errors[`links.${i}.mainAssetId`] = ["Il bene scelto non esiste"];
      else if (reverse.has(l.mainAssetId)) errors[`links.${i}.mainAssetId`] = ["Questo bene è già collegato a te: un collegamento reciproco non ha senso"];
    });
  }

  if (Object.keys(errors).length > 0) return fail(errors);

  const needsSelf = input.rights.some((r) => r.holder.type === "self");
  const ownerId = needsSelf ? await deps.others.ownerPartyId() : "";
  const { rights, cadastral, links, ...core } = input;
  return ok({
    core,
    children: {
      rights: rights.map(({ holder, ...right }) => ({
        ...right,
        holderPartyId: holder.type === "self" ? ownerId : holder.partyId,
      })),
      cadastral,
      links,
    },
  });
}

export async function createAsset(deps: AssetDeps, rawInput: unknown): Promise<Result<{ id: string }>> {
  const parsed = assetInputSchema.safeParse(rawInput);
  if (!parsed.success) return fail(zodIssuesToErrors(parsed.error));
  const prepared = await prepare(deps, parsed.data);
  if (!prepared.ok) return prepared;

  const id = await deps.repo.insert(prepared.value.core);
  await deps.repo.replaceChildren(id, prepared.value.children);
  await deps.audit.record({
    action: "asset.create",
    entityType: "asset",
    entityId: id,
    diff: {
      kind: parsed.data.kind,
      name: parsed.data.name,
      territoryId: parsed.data.territoryId,
      rights: parsed.data.rights.length,
      cadastralRecords: parsed.data.cadastral.length,
      links: parsed.data.links.length,
      attributes: parsed.data.attributes.length,
    },
  });
  return ok({ id });
}

const CORE_FIELDS = ["kind", "name", "territoryId", "locality", "address", "postalCode", "useType", "inCondominium", "notes"] as const;

/** Firma stabile di una lista figlia, per sapere se e' cambiata senza registrare nell'audit i valori. */
const signature = (value: unknown) => JSON.stringify(value);

export async function updateAsset(deps: AssetDeps, id: string, rawInput: unknown): Promise<Result<{ id: string }>> {
  const parsed = assetInputSchema.safeParse(rawInput);
  if (!parsed.success) return fail(zodIssuesToErrors(parsed.error));
  const before = await deps.repo.getDetail(id);
  if (!before) return failGeneral("Bene non trovato");
  const prepared = await prepare(deps, parsed.data, id);
  if (!prepared.ok) return prepared;

  const changed = CORE_FIELDS.filter((f) => (before[f] ?? null) !== (prepared.value.core[f] ?? null));
  const sameRights =
    signature(before.rights.map((r) => [r.holder.id, r.rightType, r.quotaNumerator, r.quotaDenominator, r.validFrom, r.validTo, r.notes])) ===
    signature(prepared.value.children.rights.map((r) => [r.holderPartyId, r.rightType, r.quotaNumerator, r.quotaDenominator, r.validFrom ?? null, r.validTo ?? null, r.notes ?? null]));
  const sameCadastral =
    signature(before.cadastral.map((c) => [c.sheet, c.parcel, c.subunit, c.cadastralCategory, c.cadastralClass, c.consistency, c.incomeCents, c.validFrom, c.validTo, c.notes])) ===
    signature(prepared.value.children.cadastral.map((c) => [c.sheet ?? null, c.parcel ?? null, c.subunit ?? null, c.cadastralCategory ?? null, c.cadastralClass ?? null, c.consistency ?? null, c.incomeCents ?? null, c.validFrom ?? null, c.validTo ?? null, c.notes ?? null]));
  const sameLinks =
    signature(before.linkedTo.map((l) => [l.asset.id, l.declaredBasis, l.validationStatus]).sort()) ===
    signature(prepared.value.children.links.map((l) => [l.mainAssetId, l.declaredBasis ?? null, l.validationStatus]).sort());

  const sameAttributes =
    signature(Object.entries(before.attributes).sort(([a], [b]) => a.localeCompare(b))) ===
    signature(prepared.value.core.attributes.map((a) => [a.key, a.value]).sort(([a], [b]) => String(a).localeCompare(String(b))));

  await deps.repo.update(id, prepared.value.core);
  await deps.repo.replaceChildren(id, prepared.value.children);
  await deps.audit.record({
    action: "asset.update",
    entityType: "asset",
    entityId: id,
    diff: {
      changed,
      rightsChanged: !sameRights,
      cadastralChanged: !sameCadastral,
      linksChanged: !sameLinks,
      attributesChanged: !sameAttributes,
    },
  });
  return ok({ id });
}

export async function setAssetArchived(deps: AssetDeps, id: string, archived: boolean): Promise<Result<{ id: string }>> {
  if (!(await deps.repo.setArchived(id, archived))) return failGeneral("Bene non trovato");
  await deps.audit.record({ action: archived ? "asset.archive" : "asset.restore", entityType: "asset", entityId: id, diff: {} });
  return ok({ id });
}

/** Il valore dichiarato dal proprietario (campo vuoto = nessun valore dichiarato). L'audit registra solo se e' stato scritto o tolto. */
export async function setAssetDeclaredValue(deps: AssetDeps, id: string, rawInput: unknown): Promise<Result<{ id: string }>> {
  const parsed = declaredValueSchema.safeParse(rawInput);
  if (!parsed.success) return fail(zodIssuesToErrors(parsed.error));
  const cents = parsed.data.declaredValue ?? null;
  if (!(await deps.repo.setDeclaredValue(id, cents))) return failGeneral("Bene non trovato");
  await deps.audit.record({ action: "asset.declared_value", entityType: "asset", entityId: id, diff: { cleared: cents === null } });
  return ok({ id });
}

export type AssetListItem = Awaited<ReturnType<AssetRepository["list"]>>[number] & { territoryLabel: string };

export async function listAssets(
  deps: Pick<AssetDeps, "repo" | "others">,
  args: { query?: string; kind?: AssetInput["kind"]; includeArchived?: boolean },
): Promise<AssetListItem[]> {
  const rows = await deps.repo.list(args);
  const labels = await deps.others.territoryLabels([...new Set(rows.map((r) => r.territoryId))]);
  return rows.map((r) => ({ ...r, territoryLabel: labels.get(r.territoryId) ?? "" }));
}

export async function getAssetDetail(
  deps: Pick<AssetDeps, "repo" | "others">,
  id: string,
): Promise<(AssetDetail & { territoryLabel: string }) | null> {
  const detail = await deps.repo.getDetail(id);
  if (!detail) return null;
  const labels = await deps.others.territoryLabels([detail.territoryId]);
  return { ...detail, territoryLabel: labels.get(detail.territoryId) ?? "" };
}
