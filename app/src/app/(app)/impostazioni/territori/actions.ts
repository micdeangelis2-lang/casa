"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { createTerritory } from "@/modules/territory";
import type { FieldErrors } from "@/shared/result";

export type AddTerritoryResult = { ok: true; label: string } | { ok: false; errors: FieldErrors };

export async function addTerritoryAction(payload: unknown): Promise<AddTerritoryResult> {
  const owner = await requireOwner();
  const result = await runInUnitOfWork(getDb(), { type: "owner", id: owner.userId }, (uow) => createTerritory(uow, payload));
  if (!result.ok) return { ok: false, errors: result.errors };
  revalidatePath("/impostazioni/territori");
  return { ok: true, label: result.value.name };
}
