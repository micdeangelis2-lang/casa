import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Handshake, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { listAssets } from "@/modules/assets";
import { MATTER_STATUSES, listMatters, type MatterStatus } from "@/modules/matters";
import { isUuid } from "@/lib/ids";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("matters");
  return { title: t("title") };
}

const date = (v: string) => new Date(`${v}T00:00:00`).toLocaleDateString("it-IT");

export default async function MattersPage({ searchParams }: PageProps<"/pratiche">) {
  await requireOwner();
  const t = await getTranslations("matters");
  const params = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const status = (MATTER_STATUSES as readonly string[]).includes(first(params.stato)) ? (first(params.stato) as MatterStatus) : undefined;
  const assetId = isUuid(first(params.immobile)) ? first(params.immobile) : undefined;
  const includeClosed = first(params.chiuse) === "1";
  const db = getDb();
  const [matters, assets] = await Promise.all([listMatters(db, { status, assetId, includeClosed }), listAssets(db)]);
  const filtering = Boolean(status || assetId || includeClosed);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <div className="flex flex-wrap gap-2">
          <Link href="/uffici" className={buttonVariants({ variant: "outline" })}>
            {t("byOffice")}
          </Link>
          <Link href="/pratiche/nuova" className={buttonVariants()}>
            <Plus aria-hidden /> {t("add")}
          </Link>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{t("intro")}</p>

      <form method="get" className="flex flex-wrap items-end gap-3" role="search">
        <div className="flex w-48 flex-col gap-2">
          <Label htmlFor="stato">{t("filters.status")}</Label>
          <NativeSelect id="stato" name="stato" defaultValue={status ?? ""}>
            <option value="">{t("filters.all")}</option>
            {MATTER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex w-56 flex-col gap-2">
          <Label htmlFor="immobile">{t("filters.asset")}</Label>
          <NativeSelect id="immobile" name="immobile" defaultValue={assetId ?? ""}>
            <option value="">{t("filters.allAssets")}</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex items-center gap-2 pb-1.5">
          <input id="chiuse" name="chiuse" type="checkbox" value="1" defaultChecked={includeClosed} className="size-4" />
          <Label htmlFor="chiuse">{t("filters.closed")}</Label>
        </div>
        <Button type="submit" variant="secondary">
          {t("filters.apply")}
        </Button>
      </form>

      {matters.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
          <Handshake className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">{filtering ? t("noResults") : t("emptyTitle")}</p>
          {filtering ? null : <p className="max-w-md text-sm text-muted-foreground">{t("emptyBody")}</p>}
        </div>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border" data-testid="matter-list">
          {matters.map((m) => (
            <li key={m.id}>
              <Link href={`/pratiche/${m.id}`} className="flex flex-col gap-1 p-4 hover:bg-accent/50 focus-visible:bg-accent/50">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{m.title}</span>
                  <Badge variant={m.status === "closed" ? "outline" : "secondary"}>{t(`status.${m.status}`)}</Badge>
                </span>
                <span className="text-sm text-muted-foreground">
                  {[m.assetName, m.assignees.length > 0 ? m.assignees.join(", ") : null, t("openedOn", { date: date(m.openedOn) })].filter(Boolean).join(" · ")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
