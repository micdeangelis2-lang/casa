import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Building, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { listCondominiums } from "@/modules/condominium";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("condominium");
  return { title: t("title") };
}

export default async function CondominiumListPage({ searchParams }: PageProps<"/condominio">) {
  await requireOwner();
  const t = await getTranslations("condominium");
  const params = await searchParams;
  const includeArchived = (Array.isArray(params.archiviati) ? params.archiviati[0] : params.archiviati) === "1";
  const condos = await listCondominiums(getDb(), includeArchived);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <Link href="/condominio/nuovo" className={buttonVariants()}>
          <Plus aria-hidden /> {t("add")}
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
      <p className="text-sm">
        <Link href="/condominio/controllo" className="underline underline-offset-4">
          {(await getTranslations("condominioAdmin"))("link")}
        </Link>
      </p>

      <form method="get" className="flex flex-wrap items-center gap-3" role="search">
        <input id="archiviati" name="archiviati" type="checkbox" value="1" defaultChecked={includeArchived} className="size-4" />
        <Label htmlFor="archiviati">{t("showArchived")}</Label>
        <Button type="submit" variant="secondary" size="sm">
          {t("apply")}
        </Button>
      </form>

      {condos.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
          <Building className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">{t("emptyTitle")}</p>
          <p className="max-w-md text-sm text-muted-foreground">{t("emptyBody")}</p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border" data-testid="condominium-list">
          {condos.map((c) => (
            <li key={c.id}>
              <Link href={`/condominio/${c.id}`} className="flex flex-col gap-1 p-4 hover:bg-accent/50 focus-visible:bg-accent/50">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{c.name}</span>
                  {c.archived ? <Badge variant="outline">{t("archivedBadge")}</Badge> : null}
                </span>
                <span className="text-sm text-muted-foreground">
                  {[c.address, t("members", { count: c.memberCount }), c.administratorName ? t("administrator", { name: c.administratorName }) : null].filter(Boolean).join(" · ")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
