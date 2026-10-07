"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { runInUnitOfWork } from "@/platform/db/unit-of-work";
import { saveNotificationSettings } from "@/modules/deadlines";
import { runDailyJob, type DailyJobResult } from "@/lib/daily-job";
import type { FormValues, SimpleSaveResult } from "@/components/simple-form";

export async function saveSettingsAction(values: FormValues): Promise<SimpleSaveResult> {
  const owner = await requireOwner();
  const result = await runInUnitOfWork(getDb(), { type: "owner", id: owner.userId }, (uow) =>
    saveNotificationSettings(uow, { emailEnabled: values.emailEnabled === true, emailAddress: typeof values.emailAddress === "string" ? values.emailAddress : "" }),
  );
  if (!result.ok) return { errors: result.errors };
  revalidatePath("/impostazioni/notifiche");
  redirect("/impostazioni/notifiche?salvato=1");
}

export async function runNowAction(): Promise<DailyJobResult> {
  const owner = await requireOwner();
  const result = await runDailyJob(getDb(), { type: "owner", id: owner.userId });
  revalidatePath("/", "layout");
  return result;
}
