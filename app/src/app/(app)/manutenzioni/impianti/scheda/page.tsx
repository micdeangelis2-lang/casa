import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { todayInItaly } from "@/platform/clock";
import { getPlantRegister } from "@/modules/maintenance";
import { PrintButton } from "@/components/print-button";
import { isUuid } from "@/lib/ids";
import { formatDate } from "@/lib/format";
import { loadPlantTypes } from "../plant-types";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("impiantista.sheet");
  return { title: t("title") };
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Scheda stampabile per il tecnico: cio' che risulta dai dati di un immobile, con spazi da compilare a mano. */
export default async function PlantSheetPage({ searchParams }: PageProps<"/manutenzioni/impianti/scheda">) {
  await requireOwner();
  const t = await getTranslations("impiantista");
  const params = await searchParams;
  const assetId = isUuid(first(params.immobile)) ? first(params.immobile) : undefined;
  const { defs, name: typeName } = await loadPlantTypes();
  const today = todayInItaly();
  const register = await getPlantRegister(getDb(), { assetId, types: defs, today, soonDays: 60 });
  const asset = register.assets.find((a) => a.id === assetId);

  if (!asset) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("sheet.title")}</h1>
        <form method="get" className="flex items-end gap-3">
          <div className="flex w-64 flex-col gap-2">
            <Label htmlFor="immobile">{t("sheet.pickAsset")}</Label>
            <NativeSelect id="immobile" name="immobile" defaultValue="">
              {register.assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button type="submit">{t("sheet.choose")}</Button>
        </form>
      </div>
    );
  }

  const blanks = (["doneOn", "outcome", "nextIndicated", "notes", "signature"] as const).map((f) => t(`sheet.fields.${f}`));
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("sheet.title")} · {asset.name}
        </h1>
        <div className="flex gap-2 print:hidden">
          <Link href="/manutenzioni/impianti" className="self-center text-sm underline underline-offset-2">
            {t("sheet.back")}
          </Link>
          <PrintButton />
        </div>
      </div>
      <Alert>
        <AlertDescription>{t("sheet.intro")}</AlertDescription>
      </Alert>
      <p className="text-sm text-muted-foreground">{t("sheet.printedOn", { date: formatDate(today) })}</p>
      {register.groups.length === 0 ? <p className="text-sm">{t("sheet.noGroups")}</p> : null}
      {register.groups.map((g) => (
        <section key={g.plant?.id ?? g.type} aria-label={g.plant ? `${typeName(g.type)}: ${g.plant.name}` : typeName(g.type)} className="flex break-inside-avoid flex-col gap-2 rounded-lg border p-4 text-sm">
          <h2 className="text-base font-semibold">{g.plant ? `${typeName(g.type)}: ${g.plant.name}` : typeName(g.type)}</h2>
          {g.plant ? (
            <p>
              {[g.plant.installedOn ? t("plant.installedLine", { date: formatDate(g.plant.installedOn) }) : null, g.plant.serialNumber ? t("plant.serialLine", { serial: g.plant.serialNumber }) : null, g.plant.installerName ? t("plant.installerLine", { name: g.plant.installerName }) : null, g.plant.maintainerName ? t("plant.maintainerLine", { name: g.plant.maintainerName }) : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
          <p>
            {t("group.suppliers")}: {g.suppliers.length > 0 ? g.suppliers.join(", ") : t("group.none")}
          </p>
          <ul>
            {g.plans.map((p) => (
              <li key={p.id}>{[p.title, t("group.every", { months: p.intervalMonths }), p.lastDoneOn ? t("group.last", { date: formatDate(p.lastDoneOn) }) : t("group.noLast"), p.nextDueOn ? t("group.next", { date: formatDate(p.nextDueOn) }) : t("group.noNext")].join(" · ")}</li>
            ))}
            {g.warranties.map((w) => (
              <li key={w.id}>{[w.title, w.startsOn ? t("group.warrantyRange", { from: formatDate(w.startsOn), to: formatDate(w.endsOn) }) : t("group.warrantyUntil", { to: formatDate(w.endsOn) })].join(" · ")}</li>
            ))}
            {g.documents.map((d) => (
              <li key={d.id}>{[d.title, d.categoryName, d.validTo ? t("group.validTo", { date: formatDate(d.validTo) }) : null].filter(Boolean).join(" · ")}</li>
            ))}
          </ul>
          <dl className="mt-2 grid gap-3">
            {blanks.map((label) => (
              <div key={label} className="flex items-end gap-2">
                <dt className="w-64 shrink-0 text-muted-foreground">{label}</dt>
                <dd className="h-6 flex-1 border-b" aria-hidden />
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
