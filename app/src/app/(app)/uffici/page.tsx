import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Building, ListChecks } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { listOfficesOverview } from "@/modules/offices";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("offices");
  return { title: t("title") };
}

const date = (v: string) => new Date(`${v}T00:00:00`).toLocaleDateString("it-IT");

export default async function OfficesPage() {
  await requireOwner();
  const t = await getTranslations("offices");
  const { offices, mattersWithoutOffice } = await listOfficesOverview(getDb());

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <div className="flex flex-wrap gap-2">
          <Link href="/uffici/regole" className={buttonVariants({ variant: "outline" })}>
            <ListChecks aria-hidden /> {t("rulesLink")}
          </Link>
          <Link href="/pratiche" className={buttonVariants({ variant: "outline" })}>
            {t("mattersLink")}
          </Link>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
      {mattersWithoutOffice > 0 ? <p className="text-sm" data-testid="without-office">{t("withoutOffice", { count: mattersWithoutOffice })}</p> : null}

      {offices.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
          <Building className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">{t("emptyTitle")}</p>
          <p className="max-w-md text-sm text-muted-foreground">{t("emptyBody")}</p>
          <Link href="/rubrica?ruolo=public_office" className={buttonVariants({ variant: "secondary" })}>
            {t("toDirectory")}
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border" data-testid="office-list">
          {offices.map(({ party, counts }) => (
            <li key={party.id}>
              <Link href={`/uffici/${party.id}`} className="flex flex-col gap-2 p-4 hover:bg-accent/50 focus-visible:bg-accent/50">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{party.displayName}</span>
                  {counts.overdue > 0 ? <Badge variant="destructive">{t("counts.overdue")}: {counts.overdue}</Badge> : null}
                </span>
                <span className="text-sm text-muted-foreground">
                  {[
                    `${t("counts.matters")}: ${counts.openMatters}`,
                    `${t("counts.requests")}: ${counts.openRequests}`,
                    `${t("counts.deadlines")}: ${counts.openDeadlines}`,
                    `${t("counts.answers")}: ${counts.answers}`,
                    `${t("counts.nextDue")}: ${counts.nextDueOn ? date(counts.nextDueOn) : t("none")}`,
                  ].join(" · ")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
