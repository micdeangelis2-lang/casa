import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Download } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { todayInItaly } from "@/platform/clock";
import { getPlantRegister, type DueState } from "@/modules/maintenance";
import { PrintButton } from "@/components/print-button";
import { ScrollRegion } from "@/components/scroll-region";
import { isUuid } from "@/lib/ids";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PLANT_TYPE_CODES, loadPlantTypes } from "./plant-types";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("impiantista");
  return { title: t("title") };
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
/** Finestra di visualizzazione di «in scadenza»: la sceglie il proprietario dal campo, questo e' solo il valore iniziale. */
const DEFAULT_WINDOW = 60;
const badgeVariant = (s: DueState) => (s === "overdue" ? "destructive" : s === "soon" ? "default" : "secondary");
const ALL_TYPES: string[] = [...PLANT_TYPE_CODES, "other"];

export default async function PlantRegisterPage({ searchParams }: PageProps<"/manutenzioni/impianti">) {
  await requireOwner();
  const t = await getTranslations("impiantista");
  const params = await searchParams;
  const view = first(params.vista) === "scadenza" ? "due" : "plant";
  const assetId = isUuid(first(params.immobile)) ? first(params.immobile) : undefined;
  const type = ALL_TYPES.includes(first(params.tipo)) ? first(params.tipo) : undefined;
  const windowAsked = Number(first(params.giorni));
  const soonDays = Number.isInteger(windowAsked) && windowAsked >= 1 && windowAsked <= 365 ? windowAsked : DEFAULT_WINDOW;
  const { defs, name: typeName } = await loadPlantTypes();
  const register = await getPlantRegister(getDb(), { assetId, type, types: defs, today: todayInItaly(), soonDays });
  const viewHref = (v: "plant" | "due") => {
    const q = new URLSearchParams({ vista: v === "due" ? "scadenza" : "impianto", giorni: String(soonDays) });
    if (assetId) q.set("immobile", assetId);
    if (type) q.set("tipo", type);
    return `/manutenzioni/impianti?${q.toString()}`;
  };

  const csvQuery = new URLSearchParams({ giorni: String(soonDays) });
  if (assetId) csvQuery.set("immobile", assetId);
  if (type) csvQuery.set("tipo", type);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <Alert>
        <AlertDescription>{t("intro")}</AlertDescription>
      </Alert>

      <form method="get" role="search" className="flex flex-wrap items-end gap-3 print:hidden">
        <input type="hidden" name="vista" value={view === "due" ? "scadenza" : "impianto"} />
        <div className="flex w-56 flex-col gap-2">
          <Label htmlFor="immobile">{t("filters.asset")}</Label>
          <NativeSelect id="immobile" name="immobile" defaultValue={assetId ?? ""}>
            <option value="">{t("filters.allAssets")}</option>
            {register.assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex w-56 flex-col gap-2">
          <Label htmlFor="tipo">{t("filters.type")}</Label>
          <NativeSelect id="tipo" name="tipo" defaultValue={type ?? ""}>
            <option value="">{t("filters.allTypes")}</option>
            {ALL_TYPES.map((c) => (
              <option key={c} value={c}>
                {typeName(c)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex w-40 flex-col gap-2">
          <Label htmlFor="giorni">{t("filters.window")}</Label>
          <Input id="giorni" name="giorni" type="number" min={1} max={365} defaultValue={soonDays} />
        </div>
        <Button type="submit" variant="secondary">
          {t("filters.apply")}
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <nav aria-label={t("viewsLabel")}>
          <ul className="flex gap-2">
            {(["plant", "due"] as const).map((v) => (
              <li key={v}>
                <Link href={viewHref(v)} aria-current={v === view ? "page" : undefined} className={cn(buttonVariants({ variant: v === view ? "secondary" : "outline", size: "sm" }), v === view && "font-semibold")}>
                  {t(`views.${v}`)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <PrintButton />
        <a href={`/api/manutenzioni/impianti?${csvQuery.toString()}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
          <Download aria-hidden /> {t("csv")}
        </a>
        <Link href={`/manutenzioni/impianti/nuovo${assetId ? `?immobile=${assetId}` : ""}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
          {t("plant.add")}
        </Link>
        <Link href="/manutenzioni?sezione=inspections" className={buttonVariants({ variant: "outline", size: "sm" })}>
          {t("actions.addPlan")}
        </Link>
        <Link href="/manutenzioni?sezione=warranties" className={buttonVariants({ variant: "outline", size: "sm" })}>
          {t("actions.addWarranty")}
        </Link>
        <Link href="/documenti" className={buttonVariants({ variant: "outline", size: "sm" })}>
          {t("actions.documents")}
        </Link>
      </div>

      {register.groups.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="plant-empty">
          {t("empty")}
        </p>
      ) : null}

      {view === "due" && register.groups.length > 0 ? (
        register.due.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noDue")}</p>
        ) : (
          <ScrollRegion label={t("due.tableLabel")}>
            <table className="w-full text-sm" data-testid="plant-due">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 pr-4 font-medium">{t("due.date")}</th>
                  <th className="py-2 pr-4 font-medium">{t("due.kind")}</th>
                  <th className="py-2 pr-4 font-medium">{t("due.title")}</th>
                  <th className="py-2 pr-4 font-medium">{t("due.asset")}</th>
                  <th className="py-2 pr-4 font-medium">{t("due.type")}</th>
                  <th className="py-2 font-medium">{t("due.state")}</th>
                </tr>
              </thead>
              <tbody>
                {register.due.map((d) => (
                  <tr key={`${d.kind}-${d.id}`} className="border-b">
                    <td className="py-2 pr-4 whitespace-nowrap">{formatDate(d.date)}</td>
                    <td className="py-2 pr-4">{t(`due.kinds.${d.kind}`)}</td>
                    <td className="py-2 pr-4">{d.title}</td>
                    <td className="py-2 pr-4">{d.assetName}</td>
                    <td className="py-2 pr-4">{typeName(d.type)}</td>
                    <td className="py-2">
                      <Badge variant={badgeVariant(d.state)}>{t(`state.${d.state}`)}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )
      ) : null}

      {view === "plant" ? (
        <ul className="flex flex-col gap-4" data-testid="plant-list">
          {register.groups.map((g) => (
            <li key={`${g.assetId}-${g.plant?.id ?? g.type}`}>
              <Card>
                <CardContent className="flex flex-col gap-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold">{g.plant ? g.plant.name : typeName(g.type)}</h2>
                    {g.plant ? <Badge variant="outline">{typeName(g.type)}</Badge> : null}
                    <span className="text-muted-foreground">{g.assetName}</span>
                    {g.nextDueOn ? <Badge variant={badgeVariant(g.nextState)}>{t(`state.${g.nextState}`)}</Badge> : null}
                    {g.plant ? (
                      <Link href={`/manutenzioni/impianti/${g.plant.id}`} className="ml-auto underline underline-offset-2 print:hidden">
                        {t("plant.open")}
                      </Link>
                    ) : null}
                    <Link href={`/manutenzioni/impianti/scheda?immobile=${g.assetId}`} className={g.plant ? "underline underline-offset-2 print:hidden" : "ml-auto underline underline-offset-2 print:hidden"}>
                      {t("group.sheet")}
                    </Link>
                  </div>
                  {g.plant ? (
                    <p className="text-muted-foreground" data-testid="plant-facts">
                      {[g.plant.installedOn ? t("plant.installedLine", { date: formatDate(g.plant.installedOn) }) : null, g.plant.serialNumber ? t("plant.serialLine", { serial: g.plant.serialNumber }) : null, g.plant.installerName ? t("plant.installerLine", { name: g.plant.installerName }) : null, g.plant.maintainerName ? t("plant.maintainerLine", { name: g.plant.maintainerName }) : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  ) : null}
                  <p>
                    {t("group.suppliers")}: {g.suppliers.length > 0 ? g.suppliers.join(", ") : t("group.none")}
                  </p>
                  <section aria-label={t("group.plans")}>
                    <h3 className="font-medium">{t("group.plans")}</h3>
                    {g.plans.length === 0 ? <p className="text-muted-foreground">{t("group.noPlans")}</p> : null}
                    <ul>
                      {g.plans.map((p) => (
                        <li key={p.id}>
                          {[p.title, t("group.every", { months: p.intervalMonths }), p.lastDoneOn ? t("group.last", { date: formatDate(p.lastDoneOn) }) : t("group.noLast"), p.nextDueOn ? t("group.next", { date: formatDate(p.nextDueOn) }) : t("group.noNext")].join(" · ")}
                          {p.deadlineId ? (
                            <>
                              {" "}
                              <Link href={`/scadenze/${p.deadlineId}`} className="underline underline-offset-2 print:hidden">
                                {t("group.openDeadline")}
                              </Link>
                            </>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </section>
                  <section aria-label={t("group.warranties")}>
                    <h3 className="font-medium">{t("group.warranties")}</h3>
                    {g.warranties.length === 0 ? <p className="text-muted-foreground">{t("group.noWarranties")}</p> : null}
                    <ul>
                      {g.warranties.map((w) => (
                        <li key={w.id}>{[w.title, w.startsOn ? t("group.warrantyRange", { from: formatDate(w.startsOn), to: formatDate(w.endsOn) }) : t("group.warrantyUntil", { to: formatDate(w.endsOn) }), w.supplierName].filter(Boolean).join(" · ")}</li>
                      ))}
                    </ul>
                  </section>
                  <section aria-label={t("group.works")}>
                    <h3 className="font-medium">{t("group.works")}</h3>
                    {g.works.length === 0 ? <p className="text-muted-foreground">{t("group.noWorks")}</p> : null}
                    <ul>
                      {g.works.map((w) => (
                        <li key={w.id}>
                          <Link href={`/manutenzioni/${w.id}`} className="underline underline-offset-2">
                            {w.title}
                          </Link>{" "}
                          · {t(`workStatus.${w.status as "planned"}`)}
                          {w.completedOn ? ` · ${formatDate(w.completedOn)}` : ""}
                        </li>
                      ))}
                    </ul>
                  </section>
                  <section aria-label={t("group.documents")}>
                    <h3 className="font-medium">{t("group.documents")}</h3>
                    {g.documents.length === 0 ? <p className="text-muted-foreground">{t("group.noDocuments")}</p> : null}
                    <ul>
                      {g.documents.map((d) => (
                        <li key={d.id}>
                          <Link href={`/documenti/${d.id}`} className="underline underline-offset-2">
                            {d.title}
                          </Link>{" "}
                          · {d.categoryName}
                          {d.validTo ? ` · ${t("group.validTo", { date: formatDate(d.validTo) })}` : ""}
                        </li>
                      ))}
                    </ul>
                  </section>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
