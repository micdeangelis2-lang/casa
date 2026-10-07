import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ShieldCheck } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { ScrollRegion } from "@/components/scroll-region";
import { auditHead, listAuditAreas, listAuditEntries, verifyAuditChain, type AuditEntry } from "@/platform/audit";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auditLog");
  return { title: t("title") };
}

/** Righe per pagina: il registro cresce con ogni modifica, quindi si legge a pagine. */
const PAGE_SIZE = 50;
const MAX_DETAIL = 160;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const when = (at: Date) => at.toLocaleString("it-IT", { timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Il dettaglio di una riga in una riga di testo: «chiave: valore, …», troncato. */
function detail(diff: AuditEntry["diff"]): string {
  const text = Object.entries(diff)
    .map(([key, value]) => `${key}: ${typeof value === "object" && value !== null ? JSON.stringify(value) : String(value)}`)
    .join(", ");
  return text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL)}…` : text;
}

export default async function AuditLogPage({ searchParams }: PageProps<"/impostazioni/registro">) {
  await requireOwner();
  const t = await getTranslations("auditLog");
  const params = await searchParams;
  const db = getDb();

  const areas = await listAuditAreas(db);
  const requestedArea = first(params.area);
  const area = areas.includes(requestedArea) ? requestedArea : undefined;
  const verify = first(params.verifica) === "1";

  const probe = await listAuditEntries(db, { area, limit: 1, offset: 0 });
  const pages = Math.max(1, Math.ceil(probe.total / PAGE_SIZE));
  const requested = Number(first(params.pagina));
  const page = Number.isInteger(requested) && requested >= 1 ? Math.min(requested, pages) : 1;
  const [{ rows }, head, verification] = await Promise.all([listAuditEntries(db, { area, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }), auditHead(db), verify ? verifyAuditChain(db) : Promise.resolve(null)]);

  const pageHref = (n: number) => {
    const search = new URLSearchParams();
    if (area) search.set("area", area);
    if (n > 1) search.set("pagina", String(n));
    const text = search.toString();
    return text ? `/impostazioni/registro?${text}` : "/impostazioni/registro";
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">{t("intro")}</p>

      <section aria-labelledby="head-heading" className="flex flex-col gap-3 rounded-lg border p-4">
        <h2 id="head-heading" className="text-lg font-medium">
          {t("head.title")}
        </h2>
        {head ? (
          <dl className="grid gap-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
            <dt className="text-muted-foreground">{t("head.value", { seq: head.seq })}</dt>
            <dd className="break-all font-mono text-xs" data-testid="audit-head">
              <span className="sr-only">{t("head.hashLabel")}: </span>
              {head.hash}
            </dd>
          </dl>
        ) : (
          <p className="text-sm">{t("head.empty")}</p>
        )}
        <p className="text-sm text-muted-foreground">{t("head.compare")}</p>
        <form method="get" className="flex flex-wrap items-center gap-3 print:hidden">
          {area ? <input type="hidden" name="area" value={area} /> : null}
          <input type="hidden" name="verifica" value="1" />
          <Button type="submit" variant="secondary">
            <ShieldCheck aria-hidden /> {t("verify.button")}
          </Button>
        </form>
        {verification ? (
          <p role="status" className="text-sm font-medium" data-testid="audit-verification">
            {verification.intact ? t("verify.ok", { rows: verification.rows }) : t("verify.broken", { seq: verification.firstBrokenSeq })}
          </p>
        ) : null}
      </section>

      <form method="get" className="flex flex-wrap items-end gap-3 print:hidden" role="search" aria-label={t("filters.label")}>
        <div className="flex w-56 flex-col gap-2">
          <Label htmlFor="area">{t("filters.area")}</Label>
          <NativeSelect id="area" name="area" defaultValue={area ?? ""}>
            <option value="">{t("filters.allAreas")}</option>
            {areas.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" variant="secondary">
          {t("filters.apply")}
        </Button>
      </form>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm">{head ? t("empty") : t("head.empty")}</p>
      ) : (
        <ScrollRegion label={t("table.region")}>
          <table className="w-full text-left text-sm" data-testid="audit-table">
            <caption className="sr-only">{t("table.caption")}</caption>
            <thead>
              <tr className="border-b">
                <th scope="col" className="py-2 pr-4 font-medium">
                  {t("table.when")}
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  {t("table.action")}
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  {t("table.actor")}
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  {t("table.entity")}
                </th>
                <th scope="col" className="py-2 font-medium">
                  {t("table.details")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.seq} className="border-b align-top">
                  <td className="whitespace-nowrap py-2 pr-4 tabular-nums">{when(r.at)}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{r.action}</td>
                  <td className="py-2 pr-4">{r.actorType === "owner" || r.actorType === "system" ? t(`actors.${r.actorType}`) : r.actorType}</td>
                  <td className="py-2 pr-4 font-mono text-xs break-all">
                    {r.entityType} {r.entityId.slice(0, 8)}
                  </td>
                  <td className="py-2 font-mono text-xs break-all text-muted-foreground">{detail(r.diff) || t("table.none")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      )}

      {probe.total > 0 ? (
        <nav aria-label={t("pager.label")} className="flex flex-wrap items-center justify-between gap-3 text-sm print:hidden">
          <p data-testid="pager-summary">{t("pager.summary", { total: probe.total, page, pages })}</p>
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
