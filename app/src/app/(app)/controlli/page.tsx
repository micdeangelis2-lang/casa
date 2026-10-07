import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ClipboardCheck } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { ATTENTION_AREAS, countBySeverity, getAttention } from "@/modules/attention";
import { AttentionList } from "./_components/attention-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("attention");
  return { title: t("title") };
}

export default async function AttentionPage() {
  await requireOwner();
  const t = await getTranslations("attention");
  const findings = await getAttention(getDb());
  const counts = countBySeverity(findings);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <Alert>
        <AlertDescription>{t("intro")}</AlertDescription>
      </Alert>

      {findings.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
          <ClipboardCheck className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">{t("emptyTitle")}</p>
          <p className="max-w-md text-sm text-muted-foreground">{t("emptyBody")}</p>
        </div>
      ) : (
        <>
          <p className="text-sm font-medium" data-testid="attention-summary">
            {t("summary", counts)}
          </p>
          {ATTENTION_AREAS.map((area) => {
            const list = findings.filter((f) => f.area === area);
            if (list.length === 0) return null;
            return (
              <section key={area} aria-labelledby={`area-${area}`} className="flex flex-col gap-2" data-testid={`area-${area}`}>
                <h2 id={`area-${area}`} className="text-lg font-medium">
                  {t(`areas.${area}`)}
                </h2>
                <AttentionList findings={list} testId={`list-${area}`} />
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
