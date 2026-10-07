import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { KeyRound, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { listAssets } from "@/modules/assets";
import { LETTING_STATUSES, listLettings } from "@/modules/lettings";
import { isUuid } from "@/lib/ids";
import { formatDate, formatEuro } from "@/lib/format";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("lettings");
  return { title: t("title") };
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function LettingsPage({ searchParams }: PageProps<"/locazioni">) {
  await requireOwner();
  const t = await getTranslations("lettings");
  const tg = await getTranslations("gestore.links");
  const params = await searchParams;
  const status = (LETTING_STATUSES as readonly string[]).includes(first(params.stato)) ? first(params.stato) : undefined;
  const assetId = isUuid(first(params.immobile)) ? first(params.immobile) : undefined;
  const includeEnded = first(params.concluse) === "1";
  const db = getDb();
  const [lettings, assets] = await Promise.all([listLettings(db, { status, assetId, includeEnded }), listAssets(db)]);
  const filtering = Boolean(status || assetId || includeEnded);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <Link href="/locazioni/nuova" className={buttonVariants()}>
          <Plus aria-hidden /> {t("add")}
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
      <nav aria-label={tg("label")} className="flex flex-wrap gap-4 text-sm">
        <Link href="/locazioni/rendiconto" className="underline underline-offset-2">
          {tg("statement")}
        </Link>
        <Link href="/locazioni/calendario" className="underline underline-offset-2">
          {tg("calendar")}
        </Link>
        <Link href="/locazioni/mandati" className="underline underline-offset-2">
          {tg("mandates")}
        </Link>
      </nav>

      <form method="get" className="flex flex-wrap items-end gap-3" role="search">
        <div className="flex w-52 flex-col gap-2">
          <Label htmlFor="stato">{t("filters.status")}</Label>
          <NativeSelect id="stato" name="stato" defaultValue={status ?? ""}>
            <option value="">{t("filters.openOnes")}</option>
            {LETTING_STATUSES.map((s) => (
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
          <input id="concluse" name="concluse" type="checkbox" value="1" defaultChecked={includeEnded} className="size-4" />
          <Label htmlFor="concluse">{t("filters.ended")}</Label>
        </div>
        <Button type="submit" variant="secondary">
          {t("filters.apply")}
        </Button>
      </form>

      {lettings.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
          <KeyRound className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">{filtering ? t("noResults") : t("emptyTitle")}</p>
          {filtering ? null : <p className="max-w-md text-sm text-muted-foreground">{t("emptyBody")}</p>}
        </div>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border" data-testid="letting-list">
          {lettings.map((l) => (
            <li key={l.id}>
              <Link href={`/locazioni/${l.id}`} className="flex flex-col gap-1 p-4 hover:bg-accent/50 focus-visible:bg-accent/50">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{l.title}</span>
                  <Badge variant="secondary">{t(`types.${l.type}`)}</Badge>
                  <Badge variant={l.status === "ended" ? "outline" : "secondary"}>{t(`status.${l.status}`)}</Badge>
                  {l.overdueRents > 0 ? <Badge variant="destructive">{t("line.overdue", { count: l.overdueRents })}</Badge> : null}
                </span>
                <span className="text-sm text-muted-foreground">
                  {[
                    l.assetName,
                    l.people.length > 0 ? l.people.join(", ") : l.managerName,
                    l.startsOn && l.endsOn ? t("line.period", { from: formatDate(l.startsOn), to: formatDate(l.endsOn) }) : l.startsOn ? t("line.from", { date: formatDate(l.startsOn) }) : l.endsOn ? t("line.until", { date: formatDate(l.endsOn) }) : null,
                    l.monthlyRentCents !== null ? t("line.rent", { amount: formatEuro(l.monthlyRentCents) }) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
