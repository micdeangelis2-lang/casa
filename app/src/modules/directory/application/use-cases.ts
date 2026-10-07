import { fail, failGeneral, ok, zodIssuesToErrors, type Result } from "@/shared/result";
import { partyInputSchema, type Party, type PartyInput, type PartyRole } from "../domain/party";
import type { DirectoryDeps, PartyRepository } from "./ports";

/** Campi che cambiano tra due versioni di un contatto, per l'audit (solo i nomi dei campi modificati, mai i valori sensibili). */
function changedFields(before: Party, after: PartyInput): string[] {
  const next: Record<string, unknown> = {
    displayName: after.displayName,
    roles: [...after.roles].sort().join(","),
    taxCode: after.taxCode ?? null,
    email: after.email ?? null,
    pec: after.pec ?? null,
    phone: after.phone ?? null,
    address: after.address ?? null,
    notes: after.notes ?? null,
  };
  const prev: Record<string, unknown> = { ...before, roles: [...before.roles].sort().join(",") };
  return Object.keys(next).filter((k) => prev[k] !== next[k]);
}

export async function createParty(deps: DirectoryDeps, input: unknown): Promise<Result<Party>> {
  const parsed = partyInputSchema.safeParse(input);
  if (!parsed.success) return fail(zodIssuesToErrors(parsed.error));
  const created = await deps.repo.insert(parsed.data);
  await deps.audit.record({
    action: "party.create",
    entityType: "party",
    entityId: created.id,
    diff: { displayName: created.displayName, roles: created.roles },
  });
  return ok(created);
}

export async function updateParty(deps: DirectoryDeps, id: string, input: unknown): Promise<Result<Party>> {
  const parsed = partyInputSchema.safeParse(input);
  if (!parsed.success) return fail(zodIssuesToErrors(parsed.error));
  const before = await deps.repo.get(id);
  if (!before) return failGeneral("Contatto non trovato");
  const updated = await deps.repo.update(id, parsed.data);
  if (!updated) return failGeneral("Contatto non trovato");
  await deps.audit.record({
    action: "party.update",
    entityType: "party",
    entityId: id,
    diff: { changed: changedFields(before, parsed.data) },
  });
  return ok(updated);
}

export async function setPartyArchived(deps: DirectoryDeps, id: string, archived: boolean): Promise<Result<Party>> {
  const updated = await deps.repo.setArchived(id, archived);
  if (!updated) return failGeneral("Contatto non trovato");
  await deps.audit.record({
    action: archived ? "party.archive" : "party.restore",
    entityType: "party",
    entityId: id,
    diff: {},
  });
  return ok(updated);
}

/**
 * Restituisce il contatto "proprietario" (la persona che usa l'app), creandolo alla prima richiesta.
 * Serve a registrare i diritti di proprieta' senza far inserire a mano se' stessi.
 */
export async function ensureOwnerParty(
  deps: DirectoryDeps,
  owner: { displayName: string; email?: string },
): Promise<Party> {
  const existing = await deps.repo.findByRole("owner");
  if (existing) return existing;
  const created = await deps.repo.insert({
    displayName: owner.displayName,
    roles: ["owner"],
    email: owner.email,
  });
  await deps.audit.record({
    action: "party.create_owner",
    entityType: "party",
    entityId: created.id,
    diff: { displayName: created.displayName },
  });
  return created;
}

export const listParties = (
  repo: PartyRepository,
  args: { query?: string; role?: PartyRole; includeArchived?: boolean },
) => repo.list(args);

export const getParty = (repo: PartyRepository, id: string) => repo.get(id);
