import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Building2, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { ASSET_KINDS, listAssets, type AssetKind } from "@/modules/assets";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("assets");
  return { title: t("title") };
}

export default async function AssetsPage({ searchParams }: PageProps<"/immobili">) {
  await requireOwner();
  const t = await getTranslations("assets");
  const tc = await getTranslations("common");
  const params = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

  const query = first(params.q);
  const kindParam = first(params.tipo);
  const kind = (ASSET_KINDS as readonly string[]).includes(kindParam) ? (kindParam as AssetKind) : undefined;
  const includeArchived = first(params.archiviati) === "1";

  const assets = await listAssets(getDb(), { query, kind, includeArchived });
  const filtering = Boolean(query || kind || includeArchived);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <Link href="/immobili/nuovo" className={buttonVariants()}>
          <Plus aria-hidden /> {t("add")}
        </Link>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3" role="search">
        <div className="flex min-w-56 flex-1 flex-col gap-2">
          <Label htmlFor="q">{t("searchLabel")}</Label>
          <Input id="q" name="q" defaultValue={query} />
        </div>
        <div className="flex w-52 flex-col gap-2">
          <Label htmlFor="tipo">{t("kindFilter")}</Label>
          <NativeSelect id="tipo" name="tipo" defaultValue={kind ?? ""}>
            <option value="">{t("allKinds")}</option>
            {ASSET_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`kind.${k}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex items-center gap-2 pb-1.5">
          <input id="archiviati" name="archiviati" type="checkbox" value="1" defaultChecked={includeArchived} className="size-4" />
          <Label htmlFor="archiviati">{t("showArchived")}</Label>
        </div>
        <Button type="submit" variant="secondary">
          {tc("search")}
        </Button>
      </form>

      {assets.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
          <Building2 className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">{filtering ? t("noResults") : t("emptyTitle")}</p>
          {filtering ? null : <p className="max-w-md text-sm text-muted-foreground">{t("emptyBody")}</p>}
        </div>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border" data-testid="asset-list">
          {assets.map((a) => (
            <li key={a.id}>
              <Link href={`/immobili/${a.id}`} className="flex flex-col gap-1 p-4 hover:bg-accent/50 focus-visible:bg-accent/50">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{a.name}</span>
                  <Badge variant="secondary">{t(`kind.${a.kind}`)}</Badge>
                  {a.archived ? <Badge variant="outline">{t("archivedBadge")}</Badge> : null}
                </span>
                <span className="text-sm text-muted-foreground">
                  {[a.address, a.locality, a.territoryLabel].filter(Boolean).join(" · ")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
