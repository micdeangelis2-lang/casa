import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { runChecks, type DoctorInput, type DoctorLevel } from "@/platform/doctor/checks";
import { collectDatabase, probeFolder, type DoctorCollected } from "@/platform/doctor/collect";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("installStatus");
  return { title: t("title") };
}

// La diagnosi legge l'ambiente e il database di adesso: non si mette in cache.
export const dynamic = "force-dynamic";

const ICONS: Record<DoctorLevel, typeof CheckCircle2> = { ok: CheckCircle2, avviso: AlertTriangle, errore: XCircle };

export default async function InstallStatusPage() {
  await requireOwner();
  const t = await getTranslations("installStatus");
  const env = process.env;

  let collected: DoctorCollected = { database: null, migrations: null, ownerCount: null, lastBackupAt: null, audit: null };
  try {
    collected = await collectDatabase(getDb(), "drizzle/meta/_journal.json");
  } catch {
    // Journal non raggiungibile o database in errore: i controlli corrispondenti risultano «non verificabili».
  }
  const input: DoctorInput = {
    env,
    production: env.NODE_ENV === "production" || env.VERCEL_ENV === "production",
    now: new Date(),
    ...collected,
    storageBackend: env.BLOB_READ_WRITE_TOKEN ? "blob" : "disk",
    storage: env.BLOB_READ_WRITE_TOKEN ? null : await probeFolder(env.STORAGE_DIR || ".storage"),
    backupDir: await probeFolder(env.BACKUP_DIR || "backups"),
  };
  const outcomes = runChecks(input);
  const counts = { ok: 0, avviso: 0, errore: 0 } satisfies Record<DoctorLevel, number>;
  for (const o of outcomes) counts[o.level] += 1;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("intro")}</p>
      </div>
      <p data-testid="status-summary" className="text-sm">
        {t("summary", { ok: counts.ok, warnings: counts.avviso, errors: counts.errore })}
      </p>
      <ul data-testid="status-list" className="flex flex-col gap-3">
        {outcomes.map((o) => {
          const Icon = ICONS[o.level];
          return (
            <li key={o.id} className="flex gap-3 rounded-lg border p-3">
              <Icon aria-hidden className="mt-0.5 size-5 shrink-0" />
              <div className="flex flex-col gap-1">
                <p className="text-sm">
                  <span className="font-medium">{t(`levels.${o.level}`)}.</span> {o.message}
                </p>
                {o.remedy ? <p className="text-sm text-muted-foreground">{o.remedy}</p> : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
