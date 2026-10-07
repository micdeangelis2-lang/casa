import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { MIN_QUERY, PER_GROUP, cleanQuery, searchAll } from "@/modules/search";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("search");
  return { title: t("title") };
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function SearchPage({ searchParams }: PageProps<"/cerca">) {
  await requireOwner();
  const t = await getTranslations("search");
  const raw = first((await searchParams).q);
  const outcome = await searchAll(getDb(), raw);
  const typed = raw.trim().length > 0;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">{t("intro")}</p>

      <form method="get" action="/cerca" role="search" aria-label={t("title")} className="flex flex-wrap items-end gap-3 print:hidden">
        <div className="flex min-w-64 flex-1 flex-col gap-2">
          <Label htmlFor="q">{t("label")}</Label>
          <Input id="q" name="q" type="search" defaultValue={cleanQuery(raw) ?? raw} maxLength={100} />
        </div>
        <Button type="submit">
          <Search aria-hidden /> {t("button")}
        </Button>
      </form>

      {typed && !outcome ? <p className="text-sm text-muted-foreground">{t("tooShort", { min: MIN_QUERY })}</p> : null}

      {outcome && outcome.groups.length === 0 ? <p className="text-sm" data-testid="search-empty">{t("noResults", { query: outcome.query })}</p> : null}

      {outcome && outcome.groups.length > 0 ? (
        <>
          <p className="text-sm font-medium" data-testid="search-summary">
            {t("summary", { total: outcome.total, query: outcome.query })}
          </p>
          {outcome.groups.map((g) => (
            <section key={g.group} aria-labelledby={`group-${g.group}`} className="flex flex-col gap-2" data-testid={`group-${g.group}`}>
              <h2 id={`group-${g.group}`} className="text-lg font-medium">
                {t(`groups.${g.group}`)} <span className="text-sm font-normal text-muted-foreground">({g.total})</span>
              </h2>
              <ul className="flex flex-col divide-y rounded-lg border">
                {g.items.map((item) => (
                  <li key={`${item.group}-${item.id}`}>
                    <Link href={item.href} className="flex flex-col gap-0.5 p-3 hover:bg-accent/50 focus-visible:bg-accent/50">
                      <span className="font-medium">{item.title}</span>
                      {item.subtitle ? <span className="text-sm text-muted-foreground">{item.subtitle}</span> : null}
                    </Link>
                  </li>
                ))}
              </ul>
              {g.total > PER_GROUP ? (
                g.group === "documents" ? (
                  <Link href={`/documenti?q=${encodeURIComponent(outcome.query)}`} className="w-fit text-sm underline underline-offset-2">
                    {t("allDocuments")}
                  </Link>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("more", { count: g.total - PER_GROUP })}</p>
                )
              ) : null}
            </section>
          ))}
        </>
      ) : null}
    </div>
  );
}
