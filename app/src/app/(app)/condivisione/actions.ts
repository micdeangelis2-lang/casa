"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { createPackage, revokePackage } from "@/modules/sharing";
import { isUuid } from "@/lib/ids";
import type { FieldErrors } from "@/shared/result";

export async function createPackageAction(payload: unknown): Promise<{ errors: FieldErrors } | undefined> {
  const owner = await requireOwner();
  const result = await runInUnitOfWork(getDb(), { type: "owner", id: owner.userId }, (uow) => createPackage(uow, payload));
  if (!result.ok) return { errors: result.errors };
  revalidatePath("/condivisione");
  redirect(`/condivisione/${result.value.id}`);
}

export async function revokePackageAction(packageId: string): Promise<void> {
  const owner = await requireOwner();
  if (!isUuid(packageId)) return;
  await runInUnitOfWork(getDb(), { type: "owner", id: owner.userId }, (uow) => revokePackage(uow, packageId));
  revalidatePath("/condivisione");
  revalidatePath(`/condivisione/${packageId}`);
}
