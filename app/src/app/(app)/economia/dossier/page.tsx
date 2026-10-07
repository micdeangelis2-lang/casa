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
import { todayInItaly } from "@/platform/clock";
import { economyYears, getDossier } from "@/modules/economy";
import { PrintButton } from "@/components/print-button";
import { ScrollRegion } from "@/components/scroll-region";
import { formatDate, formatEuro } from "@/lib/format";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("commercialista");
  return { title: t("title") };
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function AdviserDossierPage({ searchParams }: PageProps<"/economia/dossier">) {
  await requireOwner();
  const t = await getTranslations("commercialista");
  const ta = await getTranslations("assets");
  const te = await getTranslations("economy");
  const db = getDb();
  const currentYear = Number(todayInItaly().slice(0, 4));
  const years = await economyYears(db);
  const asked = first((await searchParams).anno);
  const year = /^\d{4}$/.test(asked) ? Number(asked) : (years[0] ?? currentYear);
  const yearOptions = [...new Set([...years, currentYear, year])].sort((a, b) => b - a);
  const d = await getDossier(db, year);
  const money = (cents: number) => te("amount", { amount: formatEuro(cents) });
  const dash = "—";

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <Link href="/economia" className={buttonVariants({ variant: "ghost", size: "sm" }) + " w-fit print:hidden"}>
        <ArrowLeft aria-hidden /> {t("back")}
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">
        {t("title")} {year}
      </h1>
      <Alert>
        <AlertDescription>{t("intro")}</AlertDescription>
      </Alert>

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
        <a href={`/api/economia/dossier?anno=${year}`} className={buttonVariants({ variant: "outline" })}>
          <Download aria-hidden /> {t("csv")}
        </a>
      </div>

      <section aria-labelledby="gaps-heading" className="flex flex-col gap-3">
        <h2 id="gaps-heading" className="text-lg font-medium">
          {t("gaps.heading")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("gaps.intro")}</p>
        {d.gaps.length === 0 ? (
          <p className="text-sm" data-testid="gaps-none">
            {t("gaps.none")}
          </p>
        ) : (
          <ScrollRegion label={t("gaps.heading")}>
            <table className="w-full text-left text-sm" data-testid="gaps-table">
              <thead>
                <tr className="border-b">
                  {(["kind", "subject", "asset", "date", "amount"] as const).map((c) => (
                    <th key={c} scope="col" className="py-2 pr-4 font-medium">
                      {t(`gaps.col.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.gaps.map((g, i) => (
                  <tr key={`${g.kind}-${i}`} className="border-b align-top">
                    <td className="py-2 pr-4">{t(`gaps.kind.${g.kind}`)}</td>
                    <td className="py-2 pr-4">
                      <Link href={g.href} className="underline underline-offset-2">
                        {g.subject}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">{g.assetName ?? dash}</td>
                    <td className="py-2 pr-4">{g.date ? formatDate(g.date) : dash}</td>
                    <td className="py-2 pr-4">{g.amountCents !== null ? money(g.amountCents) : dash}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}
      </section>

      <section aria-labelledby="assets-heading" className="flex flex-col gap-3">
        <h2 id="assets-heading" className="text-lg font-medium">
          {t("assets.heading")}
        </h2>
        {d.assets.length === 0 ? <p className="text-sm text-muted-foreground">{t("assets.none")}</p> : null}
        {d.assets.map((a) => (
          <div key={a.id} className="flex flex-col gap-1 border-b pb-3 text-sm" data-testid="dossier-asset">
            <Link href={`/immobili/${a.id}`} className="font-medium underline underline-offset-2">
              {a.name}
            </Link>
            <p className="text-muted-foreground">{[a.address, a.territoryLabel].filter(Boolean).join(" · ")}</p>
            <p>
              {t("assets.rights")}:{" "}
              {a.rights.length === 0
                ? t("assets.noneRegistered")
                : a.rights.map((r) => `${r.holderName}, ${ta(`right.${r.rightType as "full"}`)} ${r.quotaNumerator}/${r.quotaDenominator}`).join("; ")}
            </p>
            <p>
              {t("assets.cadastral")}:{" "}
              {a.cadastral.length === 0
                ? t("assets.noneRegistered")
                : a.cadastral
                    .map((c) =>
                      [
                        c.sheet ? t("assets.sheet", { value: c.sheet }) : null,
                        c.parcel ? t("assets.parcel", { value: c.parcel }) : null,
                        c.subunit ? t("assets.subunit", { value: c.subunit }) : null,
                        c.category ? t("assets.category", { value: c.category }) : null,
                        c.incomeCents !== null ? t("assets.income", { amount: formatEuro(c.incomeCents) }) : null,
                      ]
                        .filter(Boolean)
                        .join(", "),
                    )
                    .join("; ")}
            </p>
          </div>
        ))}
      </section>

      <section aria-labelledby="lettings-heading" className="flex flex-col gap-3">
        <h2 id="lettings-heading" className="text-lg font-medium">
          {t("lettings.heading")}
        </h2>
        {d.lettings.length === 0 ? <p className="text-sm text-muted-foreground">{t("lettings.none")}</p> : null}
        <ul className="list-disc pl-5 text-sm">
          {d.lettings.map((l) => (
            <li key={l.id}>
              <Link href={`/locazioni/${l.id}`} className="underline underline-offset-2">
                {l.title}
              </Link>{" "}
              ({l.assetName}) · {t("lettings.collected", { amount: formatEuro(l.collectedCents), count: l.collectedCount })}
              {l.registeredOn || l.registrationNumber ? ` · ${t("lettings.registration", { data: [l.registeredOn ? formatDate(l.registeredOn) : null, l.registrationNumber, l.registrationOffice].filter(Boolean).join(", ") })}` : ""}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="moves-heading" className="flex flex-col gap-3">
        <h2 id="moves-heading" className="text-lg font-medium">
          {t("movements.heading")}
        </h2>
        <ul className="text-sm" data-testid="area-totals">
          {d.areaTotals.map((a) => (
            <li key={a.area}>{t("movements.areaLine", { area: te(`areas.${a.area}`), amount: formatEuro(a.totalCents), count: a.count, missing: a.withoutProof })}</li>
          ))}
        </ul>
        {d.movements.length === 0 ? (
          <p className="text-sm text-muted-foreground">{te("empty", { year })}</p>
        ) : (
          <ScrollRegion label={t("movements.heading")}>
            <table className="w-full text-left text-sm" data-testid="dossier-movements">
              <thead>
                <tr className="border-b">
                  {(["date", "area", "description", "asset", "amount", "proof"] as const).map((c) => (
                    <th key={c} scope="col" className="py-2 pr-4 font-medium">
                      {t(`movements.col.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.movements.map((m) => (
                  <tr key={`${m.area}-${m.id}`} className="border-b align-top">
                    <td className="py-2 pr-4">{formatDate(m.date)}</td>
                    <td className="py-2 pr-4">{te(`areas.${m.area}`)}</td>
                    <td className="py-2 pr-4">
                      <Link href={m.href} className="underline underline-offset-2">
                        {m.label}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">{m.assetName ?? te("table.unassigned")}</td>
                    <td className="py-2 pr-4">{money(m.amountCents)}</td>
                    <td className="py-2 pr-4">
                      {t(`movements.proof.${m.proof}`)}
                      {m.taxDetail && (m.taxDetail.kind !== "ordinary" || m.taxDetail.penaltyCents !== null || m.taxDetail.interestCents !== null) ? (
                        <span className="block text-xs text-muted-foreground" data-testid="movement-tax-detail">
                          {[
                            m.taxDetail.kind !== "ordinary" ? t(`movements.taxKind.${m.taxDetail.kind}`) : null,
                            m.taxDetail.penaltyCents !== null ? t("movements.penalty", { amount: formatEuro(m.taxDetail.penaltyCents) }) : null,
                            m.taxDetail.interestCents !== null ? t("movements.interest", { amount: formatEuro(m.taxDetail.interestCents) }) : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}
      </section>

      <section aria-labelledby="tax-heading" className="flex flex-col gap-2">
        <h2 id="tax-heading" className="text-lg font-medium">
          {t("tax.heading")}
        </h2>
        <p className="text-sm">
          <Link href={`/tributi/riepilogo?anno=${year}`} className="underline underline-offset-2">
            {t("tax.fullSummary")}
          </Link>
        </p>
        {d.tax.items.length + d.tax.returns.length === 0 ? <p className="text-sm text-muted-foreground">{t("tax.none")}</p> : null}
        <ul className="list-disc pl-5 text-sm">
          {d.tax.items.map((i) => (
            <li key={i.id}>
              {i.typeName}
              {i.label ? ` – ${i.label}` : ""} ({i.assetName}) · {i.expectedCents !== null ? t("tax.expected", { amount: formatEuro(i.expectedCents) }) : t("tax.noExpected")} · {t("tax.paid", { amount: formatEuro(i.paidCents) })}
            </li>
          ))}
          {d.tax.returns.map((r) => (
            <li key={r.id}>
              {r.title} · {r.filedOn ? t("tax.filedOn", { date: formatDate(r.filedOn) }) : t("tax.notFiled")}
              {r.protocol ? ` · ${r.protocol}` : ""}
            </li>
          ))}
        </ul>
        <h3 className="mt-2 text-base font-medium">{t("tax.toAsk")}</h3>
        {d.tax.toAsk.obligations.length + d.tax.toAsk.returns.length === 0 ? <p className="text-sm text-muted-foreground">{t("tax.toAskNone")}</p> : null}
        <ul className="list-disc pl-5 text-sm" data-testid="to-ask">
          {d.tax.toAsk.obligations.map((i) => (
            <li key={i.id}>
              {i.typeName}
              {i.label ? ` – ${i.label}` : ""} ({i.assetName}){i.note ? `: ${i.note}` : ""}
            </li>
          ))}
          {d.tax.toAsk.returns.map((r) => (
            <li key={r.id}>
              {r.title}
              {r.note ? `: ${r.note}` : ""}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
