import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, Download } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { adviserSummary, todayInItaly, yearsWithData } from "@/modules/taxes";
import { PrintButton } from "@/components/print-button";
import { ScrollRegion } from "@/components/scroll-region";
import { formatDate, formatEuro } from "@/lib/format";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("taxes.summary");
  return { title: t("title") };
}

export default async function TaxSummaryPage({ searchParams }: PageProps<"/tributi/riepilogo">) {
  await requireOwner();
  const t = await getTranslations("taxes.summary");
  const ts = await getTranslations("taxes");
  const raw = (await searchParams).anno;
  const asked = Array.isArray(raw) ? raw[0] : raw;
  const db = getDb();
  const currentYear = Number(todayInItaly().slice(0, 4));
  const years = await yearsWithData(db);
  const year = asked && /^\d{4}$/.test(asked) ? Number(asked) : (years[0] ?? currentYear);
  const yearOptions = [...new Set([...years, currentYear, year])].sort((a, b) => b - a);
  const s = await adviserSummary(db, year);
  const empty = s.items.length === 0 && s.returns.length === 0;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <Link href="/tributi" className={buttonVariants({ variant: "ghost", size: "sm" }) + " w-fit print:hidden"}>
        <ArrowLeft aria-hidden /> {t("back")}
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">
        {t("title")} {year}
      </h1>
      <p className="text-sm text-muted-foreground">{t("intro")}</p>

      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <form method="get" className="flex items-end gap-3" role="search">
          <div className="flex w-40 flex-col gap-2">
            <Label htmlFor="anno">{t("year")}</Label>
            <NativeSelect id="anno" name="anno" defaultValue={String(year)}>
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button type="submit" variant="secondary">
            {t("show")}
          </Button>
        </form>
        <PrintButton />
        <a href={`/api/tributi/riepilogo?anno=${year}`} className={buttonVariants({ variant: "outline" })}>
          <Download aria-hidden /> {t("csv")}
        </a>
      </div>

      {empty ? (
        <p className="text-sm text-muted-foreground">{t("noData")}</p>
      ) : (
        <>
          <section className="flex flex-col gap-3" aria-labelledby="items-heading">
            <h2 id="items-heading" className="text-lg font-medium">
              {t("items")}
            </h2>
            <p className="text-sm" data-testid="summary-totals">
              {t("total", { expected: formatEuro(s.totals.expectedCents), paid: formatEuro(s.totals.paidCents) })}
              {s.totals.withoutExpected > 0 ? ` · ${t("withoutExpected", { count: s.totals.withoutExpected })}` : ""}
            </p>
            {s.withoutProof > 0 ? <p className="text-sm">{t("withoutProof", { count: s.withoutProof })}</p> : null}
            <ScrollRegion label={t("title")}>
              <table className="w-full text-left text-sm" data-testid="summary-table">
                <thead>
                  <tr className="border-b">
                    {(["asset", "type", "due", "expected", "paid", "situation"] as const).map((c) => (
                      <th key={c} scope="col" className="py-2 pr-4 font-medium">
                        {t(c)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {s.items.map((i) => (
                    <tr key={i.id} className="border-b align-top">
                      <td className="py-2 pr-4">{i.assetName}</td>
                      <td className="py-2 pr-4">
                        <Link href={`/tributi/${i.id}`} className="underline underline-offset-2">
                          {i.typeName}
                          {i.label ? ` – ${i.label}` : ""}
                        </Link>
                      </td>
                      <td className="py-2 pr-4">{i.dueOn ? formatDate(i.dueOn) : "—"}</td>
                      <td className="py-2 pr-4">{i.expectedCents !== null ? `${formatEuro(i.expectedCents)} €` : "—"}</td>
                      <td className="py-2 pr-4">{formatEuro(i.paidCents)} €</td>
                      <td className="py-2 pr-4">{ts(`state.${i.state}`)}{i.overdue ? ` · ${ts("overdueBadge")}` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          </section>

          <section className="flex flex-col gap-2" aria-labelledby="ask-heading">
            <h2 id="ask-heading" className="text-lg font-medium">
              {t("toAsk")}
            </h2>
            {s.toAsk.obligations.length + s.toAsk.returns.length === 0 ? <p className="text-sm text-muted-foreground">{t("toAskNone")}</p> : null}
            <ul className="list-disc pl-5 text-sm">
              {s.toAsk.obligations.map((i) => (
                <li key={i.id}>
                  {i.typeName}
                  {i.label ? ` – ${i.label}` : ""} ({i.assetName}){i.note ? `: ${i.note}` : ""}
                </li>
              ))}
              {s.toAsk.returns.map((r) => (
                <li key={r.id}>
                  {r.title}
                  {r.note ? `: ${r.note}` : ""}
                </li>
              ))}
            </ul>
          </section>

          <section className="flex flex-col gap-2" aria-labelledby="returns-heading">
            <h2 id="returns-heading" className="text-lg font-medium">
              {t("returns")}
            </h2>
            {s.returns.length === 0 ? <p className="text-sm text-muted-foreground">{t("noReturns")}</p> : null}
            <ul className="list-disc pl-5 text-sm">
              {s.returns.map((r) => (
                <li key={r.id}>
                  {[r.title, r.assetName, r.dueOn ? `${ts("returns.dueLine", { date: formatDate(r.dueOn) })}` : null, r.filedOn ? ts("returns.filedLine", { date: formatDate(r.filedOn) }) : null, r.protocol ? ts("returns.protocolLine", { protocol: r.protocol }) : null, ts(`returns.state.${r.state}`)].filter(Boolean).join(" · ")}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <Alert>
        <AlertDescription>{ts("notice")}</AlertDescription>
      </Alert>
    </div>
  );
}
