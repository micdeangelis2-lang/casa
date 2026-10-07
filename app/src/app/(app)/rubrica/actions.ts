"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { createParty, setPartyArchived, updateParty } from "@/modules/directory";
import { isUuid } from "@/lib/ids";
import type { FieldErrors } from "@/shared/result";

export type SaveResult = { errors: FieldErrors } | undefined;

export async function savePartyAction(partyId: string | null, payload: unknown): Promise<SaveResult> {
  const owner = await requireOwner();
  if (partyId !== null && !isUuid(partyId)) return { errors: { _: ["Contatto non trovato"] } };

  const result = await runInUnitOfWork(getDb(), { type: "owner", id: owner.userId }, (uow) =>
    partyId ? updateParty(uow, partyId, payload) : createParty(uow, payload),
  );
  if (!result.ok) return { errors: result.errors };

  revalidatePath("/rubrica");
  redirect("/rubrica");
}

export async function archivePartyAction(partyId: string, archived: boolean): Promise<void> {
  const owner = await requireOwner();
  if (!isUuid(partyId)) return;
  await runInUnitOfWork(getDb(), { type: "owner", id: owner.userId }, (uow) => setPartyArchived(uow, partyId, archived));
  revalidatePath("/rubrica");
  redirect("/rubrica");
}
