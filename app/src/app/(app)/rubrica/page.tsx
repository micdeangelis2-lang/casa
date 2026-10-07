import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { listParties, PARTY_ROLES, type PartyRole } from "@/modules/directory";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("directory");
  return { title: t("title") };
}

export default async function DirectoryPage({ searchParams }: PageProps<"/rubrica">) {
  await requireOwner();
  const t = await getTranslations("directory");
  const tc = await getTranslations("common");
  const params = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

  const query = first(params.q);
  const roleParam = first(params.ruolo);
  const role = (PARTY_ROLES as readonly string[]).includes(roleParam) ? (roleParam as PartyRole) : undefined;
  const includeArchived = first(params.archiviati) === "1";

  const parties = await listParties(getDb(), { query, role, includeArchived });
  const filtering = Boolean(query || role || includeArchived);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <Link href="/rubrica/nuovo" className={buttonVariants()}>
          <Plus aria-hidden /> {t("add")}
        </Link>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3" role="search">
        <div className="flex min-w-56 flex-1 flex-col gap-2">
          <Label htmlFor="q">{t("searchLabel")}</Label>
          <Input id="q" name="q" defaultValue={query} />
        </div>
        <div className="flex w-60 flex-col gap-2">
          <Label htmlFor="ruolo">{t("roleFilter")}</Label>
          <NativeSelect id="ruolo" name="ruolo" defaultValue={role ?? ""}>
            <option value="">{t("allRoles")}</option>
            {PARTY_ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`role.${r}`)}
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

      {parties.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
          <Users className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">{filtering ? t("noResults") : t("emptyTitle")}</p>
          {filtering ? null : <p className="max-w-md text-sm text-muted-foreground">{t("emptyBody")}</p>}
        </div>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border" data-testid="party-list">
          {parties.map((p) => (
            <li key={p.id}>
              <Link href={`/rubrica/${p.id}/modifica`} className="flex flex-col gap-1 p-4 hover:bg-accent/50 focus-visible:bg-accent/50">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{p.displayName}</span>
                  {p.roles.map((r) => (
                    <Badge key={r} variant="secondary">
                      {t(`role.${r}`)}
                    </Badge>
                  ))}
                  {p.archived ? <Badge variant="outline">{t("archivedBadge")}</Badge> : null}
                </span>
                <span className="text-sm text-muted-foreground">{[p.email, p.phone].filter(Boolean).join(" · ")}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
