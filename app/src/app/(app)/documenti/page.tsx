import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FileText, Files, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { listAssets } from "@/modules/assets";
import {
  CONFIDENTIALITY,
  VERIFICATION_STATUS,
  countDocuments,
  listDocumentCategories,
  listDocuments,
  type Confidentiality,
  type VerificationStatus,
} from "@/modules/documents";
import { isUuid } from "@/lib/ids";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("documents");
  return { title: t("title") };
}

const date = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("it-IT");

/** Quanti documenti per pagina: con migliaia di file l'elenco resta veloce e leggibile. */
const PAGE_SIZE = 50;

export default async function DocumentsPage({ searchParams }: PageProps<"/documenti">) {
  await requireOwner();
  const t = await getTranslations("documents");
  const tc = await getTranslations("common");
  const tb = await getTranslations("bulkUpload");
  const params = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

  const db = getDb();
  const [categories, assets] = await Promise.all([listDocumentCategories(db), listAssets(db)]);

  const query = first(params.q);
  const categoryId = isUuid(first(params.categoria)) ? first(params.categoria) : undefined;
  const assetId = isUuid(first(params.immobile)) ? first(params.immobile) : undefined;
  const status = (VERIFICATION_STATUS as readonly string[]).includes(first(params.stato)) ? (first(params.stato) as VerificationStatus) : undefined;
  const confidentiality = (CONFIDENTIALITY as readonly string[]).includes(first(params.riservatezza))
    ? (first(params.riservatezza) as Confidentiality)
    : undefined;
  const includeArchived = first(params.archiviati) === "1";

  const filters = { query, categoryId, assetId, verificationStatus: status, confidentiality, includeArchived };
  const total = await countDocuments(db, filters);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const requested = Number(first(params.pagina));
  const page = Number.isInteger(requested) && requested >= 1 ? Math.min(requested, pages) : 1;
  const documents = await listDocuments(db, { ...filters, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  const pageHref = (n: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      const v = Array.isArray(value) ? value[0] : value;
      if (v && key !== "pagina") search.set(key, v);
    }
    if (n > 1) search.set("pagina", String(n));
    const text = search.toString();
    return text ? `/documenti?${text}` : "/documenti";
  };
  const filtering = Boolean(query || categoryId || assetId || status || confidentiality || includeArchived);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <div className="flex flex-wrap gap-2">
          <Link href="/documenti/carica-piu" className={buttonVariants({ variant: "outline" })}>
            <Files aria-hidden /> {tb("link")}
          </Link>
          <Link href="/documenti/nuovo" className={buttonVariants()}>
            <Plus aria-hidden /> {t("add")}
          </Link>
        </div>
      </div>

      <form method="get" className="flex flex-col gap-3 print:hidden" role="search">
        <div className="flex flex-col gap-2">
          <Label htmlFor="q">{t("searchLabel")}</Label>
          <Input id="q" name="q" defaultValue={query} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="categoria">{t("categoryFilter")}</Label>
            <NativeSelect id="categoria" name="categoria" defaultValue={categoryId ?? ""}>
              <option value="">{t("allCategories")}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="immobile">{t("assetFilter")}</Label>
            <NativeSelect id="immobile" name="immobile" defaultValue={assetId ?? ""}>
              <option value="">{t("allAssets")}</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="stato">{t("statusFilter")}</Label>
            <NativeSelect id="stato" name="stato" defaultValue={status ?? ""}>
              <option value="">{t("allStatuses")}</option>
              {VERIFICATION_STATUS.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="riservatezza">{t("confidentialityFilter")}</Label>
            <NativeSelect id="riservatezza" name="riservatezza" defaultValue={confidentiality ?? ""}>
              <option value="">{t("allConfidentialities")}</option>
              {CONFIDENTIALITY.map((c) => (
                <option key={c} value={c}>
                  {t(`confidentiality.${c}`)}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <input id="archiviati" name="archiviati" type="checkbox" value="1" defaultChecked={includeArchived} className="size-4" />
            <Label htmlFor="archiviati">{t("showArchived")}</Label>
          </div>
          <Button type="submit" variant="secondary">
            {tc("search")}
          </Button>
        </div>
      </form>

      {documents.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
          <FileText className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">{filtering ? t("noResults") : t("emptyTitle")}</p>
          {filtering ? null : <p className="max-w-md text-sm text-muted-foreground">{t("emptyBody")}</p>}
        </div>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border" data-testid="document-list">
          {documents.map((d) => (
            <li key={d.id}>
              <Link href={`/documenti/${d.id}`} className="flex flex-col gap-1 p-4 hover:bg-accent/50 focus-visible:bg-accent/50">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{d.title}</span>
                  <Badge variant="secondary">{d.categoryName}</Badge>
                  <Badge variant="outline">{t(`status.${d.verificationStatus}`)}</Badge>
                  {d.confidentiality !== "ordinary" ? <Badge variant="outline">{t(`confidentiality.${d.confidentiality}`)}</Badge> : null}
                  {d.archived ? <Badge variant="outline">{t("archivedBadge")}</Badge> : null}
                </span>
                <span className="text-sm text-muted-foreground">
                  {[
                    t("versions", { count: d.versionCount }),
                    d.validTo ? t("validUntil", { date: date(d.validTo) }) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {total > 0 ? (
        <nav aria-label={t("pager.label")} className="flex flex-wrap items-center justify-between gap-3 text-sm print:hidden">
          <p data-testid="pager-summary">{t("pager.summary", { total, page, pages })}</p>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link href={pageHref(page - 1)} rel="prev" className={buttonVariants({ variant: "outline", size: "sm" })}>
                {t("pager.previous")}
              </Link>
            ) : null}
            {page < pages ? (
              <Link href={pageHref(page + 1)} rel="next" className={buttonVariants({ variant: "outline", size: "sm" })}>
                {t("pager.next")}
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}
    </div>
  );
}
