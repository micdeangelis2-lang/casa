"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { runBackup } from "@/modules/backup";

export type RunBackupResult = { ok: true; warning: string | null } | { ok: false; message: string };

export async function runBackupAction(): Promise<RunBackupResult> {
  const owner = await requireOwner();
  const outcome = await runBackup(getDb(), { type: "owner", id: owner.userId }, "manual");
  revalidatePath("/impostazioni/backup");
  return outcome.ok ? { ok: true, warning: outcome.run.message } : { ok: false, message: outcome.message };
}
