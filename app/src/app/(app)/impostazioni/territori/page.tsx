import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { countTerritories, TERRITORY_KINDS } from "@/modules/territory";
import { TerritoryForm } from "./_components/territory-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("territories");
  return { title: t("title") };
}

export default async function TerritoriesPage() {
  await requireOwner();
  const t = await getTranslations("territories");
  const counts = await countTerritories(getDb());
  const hasItaly = (counts.municipality ?? 0) > 0;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">{t("intro")}</p>

      {hasItaly ? null : (
        <Alert>
          <AlertDescription>{t("noItalyData")}</AlertDescription>
        </Alert>
      )}

      <section aria-labelledby="stats-title" className="flex flex-col gap-2">
        <h2 id="stats-title" className="text-lg font-medium">
          {t("stats")}
        </h2>
        <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5" data-testid="territory-stats">
          {TERRITORY_KINDS.map((k) => (
            <div key={k} className="rounded-lg border p-3">
              <dt className="text-muted-foreground">{t(`kind.${k}`)}</dt>
              <dd className="text-lg font-semibold">{(counts[k] ?? 0).toLocaleString("it-IT")}</dd>
            </div>
          ))}
        </dl>
      </section>

      <TerritoryForm />
    </div>
  );
}
