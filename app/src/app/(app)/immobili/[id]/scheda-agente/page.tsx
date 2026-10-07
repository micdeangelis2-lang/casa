import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { PrintButton } from "@/components/print-button";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { getAssetDetail } from "@/modules/assets";
import { agentPackageHref, getAgentSheet, type Level } from "@/modules/agent";
import { getParty, listParties } from "@/modules/directory";
import { listDocumentCategories } from "@/modules/documents";
import { formatDate, formatEuro } from "@/lib/format";
import { isUuid } from "@/lib/ids";
import { ListingSection } from "./_components/listing-section";

type Props = PageProps<"/immobili/[id]/scheda-agente">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations("agente");
  const { id } = await params;
  const asset = isUuid(id) ? await getAssetDetail(getDb(), id) : null;
  return { title: asset ? `${t("title")} – ${asset.name}` : t("title") };
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const many = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).filter(isUuid);
const LEVELS: Level[] = ["ordinary", "reserved", "highly_reserved"];

export default async function AgentSheetPage({ params, searchParams }: Props) {
  await requireOwner();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const query = await searchParams;
  const db = getDb();
  const levelParam = first(query.livello);
  const cap: Level = LEVELS.includes(levelParam as Level) ? (levelParam as Level) : "ordinary";
  const focusIds = many(query.categoria);
  const includeRights = first(query.titolari) === "1";
  const sheet = await getAgentSheet(db, id, { cap, focusCategoryIds: focusIds.length > 0 ? focusIds : null, includeRights });
  if (!sheet) notFound();

  const t = await getTranslations("agente");
  const ta = await getTranslations("assets");
  const tc = await getTranslations("common");
  const ts = await getTranslations("sharing");
  const td = await getTranslations("documents");
  const tdo = await getTranslations("dossier");
  const tl = await getTranslations("lettings");
  const tm = await getTranslations("maintenance");
  const tma = await getTranslations("matters");
  const [categories, agents] = await Promise.all([listDocumentCategories(db), listParties(db, { role: "agent" })]);
  const contactParam = first(query.contatto);
  const contact = contactParam && isUuid(contactParam) ? await getParty(db, contactParam) : null;
  const { asset } = sheet;

  const period = (from: string | null, to: string | null) => [from ? t("letting.from", { date: formatDate(from) }) : null, to ? t("letting.to", { date: formatDate(to) }) : null].filter(Boolean).join(" ");
  const packageHref = agentPackageHref({ assetId: asset.id, categoryIds: focusIds, contactId: contact?.id, level: cap });

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <Link href={`/immobili/${asset.id}`} className={buttonVariants({ variant: "ghost", size: "sm" }) + " w-fit print:hidden"}>
        <ArrowLeft aria-hidden /> {t("back")}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("title")}: {asset.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("preparedOn", { date: formatDate(sheet.today) })}
            {contact ? ` · ${t("preparedFor", { name: contact.displayName })}` : ""}
          </p>
        </div>
        <PrintButton />
      </div>
      <p className="text-sm text-muted-foreground">{t("intro")}</p>

      <form method="get" className="flex flex-col gap-4 print:hidden" aria-label={t("title")}>
        <div className="flex max-w-sm flex-col gap-2">
          <Label htmlFor="contatto">{t("form.contact")}</Label>
          <NativeSelect id="contatto" name="contatto" defaultValue={contact?.id ?? ""}>
            <option value="">{t("form.none")}</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.displayName}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex max-w-sm flex-col gap-2">
          <Label htmlFor="livello">{t("form.level")}</Label>
          <NativeSelect id="livello" name="livello" defaultValue={cap}>
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {ts(`confidentiality.${l}`)}
              </option>
            ))}
          </NativeSelect>
          <p className="text-sm text-muted-foreground">{t("form.levelHint")}</p>
        </div>
        <div className="flex items-center gap-3">
          <input id="titolari" type="checkbox" name="titolari" value="1" defaultChecked={includeRights} className="size-6" />
          <Label htmlFor="titolari">{t("form.rights")}</Label>
        </div>
        <p className="text-sm text-muted-foreground">{t("form.rightsHint")}</p>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">{t("form.categoriesLegend")}</legend>
          <p className="text-sm text-muted-foreground">{t("form.categoriesHint")}</p>
          <ul className="flex flex-col gap-1">
            {categories.map((c) => (
              <li key={c.id} className="flex items-center gap-3">
                <input id={`c-${c.id}`} type="checkbox" name="categoria" value={c.id} defaultChecked={focusIds.includes(c.id)} className="size-6" />
                <Label htmlFor={`c-${c.id}`}>{c.name}</Label>
              </li>
            ))}
          </ul>
        </fieldset>
        <div>
          <Button type="submit" variant="secondary">
            {t("form.show")}
          </Button>
        </div>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("identification.title")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]" data-testid="agent-identification">
            <dt className="text-muted-foreground">{ta("form.kind")}</dt>
            <dd>
              {ta(`kind.${asset.kind}`)}
              {asset.useType ? ` · ${ta(`use.${asset.useType}`)}` : ""}
            </dd>
            <dt className="text-muted-foreground">{t("identification.territory")}</dt>
            <dd>{asset.territoryLabel}</dd>
            {asset.locality ? (
              <>
                <dt className="text-muted-foreground">{t("identification.locality")}</dt>
                <dd>{asset.locality}</dd>
              </>
            ) : null}
            {asset.address || asset.postalCode ? (
              <>
                <dt className="text-muted-foreground">{t("identification.address")}</dt>
                <dd>{[asset.address, asset.postalCode].filter(Boolean).join(" – ")}</dd>
              </>
            ) : null}
            {asset.notes ? (
              <>
                <dt className="text-muted-foreground">{t("identification.notes")}</dt>
                <dd className="whitespace-pre-wrap">{asset.notes}</dd>
              </>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("characteristics.title")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {Object.keys(asset.attributes).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("characteristics.none")}</p>
          ) : (
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[14rem_1fr]" data-testid="agent-attributes">
              {Object.entries(asset.attributes).map(([name, value]) => (
                <div key={name} className="contents">
                  <dt className="text-muted-foreground">{name}</dt>
                  <dd>{typeof value === "boolean" ? (value ? tc("yes") : tc("no")) : String(value)}</dd>
                </div>
              ))}
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("cadastral.title")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {asset.cadastral.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("cadastral.none")}</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm" data-testid="agent-cadastral">
              {asset.cadastral.map((c) => (
                <li key={c.id}>
                  {[
                    c.sheet ? `${ta("form.sheet")} ${c.sheet}` : null,
                    c.parcel ? `${ta("form.parcel")} ${c.parcel}` : null,
                    c.subunit ? `${ta("form.subunit")} ${c.subunit}` : null,
                    c.cadastralCategory ? `${ta("form.cadastralCategory")} ${c.cadastralCategory}` : null,
                    c.cadastralClass ? `${ta("form.cadastralClass")} ${c.cadastralClass}` : null,
                    c.consistency ? `${ta("form.consistency")} ${c.consistency}` : null,
                    c.incomeCents !== null ? ta("detail.income", { amount: `${formatEuro(c.incomeCents)} €` }) : null,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                  {c.validFrom || c.validTo ? ` (${[c.validFrom ? ta("detail.from", { date: formatDate(c.validFrom) }) : null, c.validTo ? ta("detail.to", { date: formatDate(c.validTo) }) : null].filter(Boolean).join(" ")})` : ""}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("holders.title")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm" data-testid="agent-holders">
          {!includeRights ? (
            <p className="text-muted-foreground">{t("holders.hidden")}</p>
          ) : asset.rights.length === 0 ? (
            <p className="text-muted-foreground">{t("holders.none")}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {asset.rights.map((r) => (
                <li key={r.id}>
                  {r.holder.displayName} – {ta(`right.${r.rightType}`)}, {ta("detail.quota", { numerator: r.quotaNumerator, denominator: r.quotaDenominator })}
                  {period(r.validFrom, r.validTo) ? ` (${period(r.validFrom, r.validTo)})` : ""}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("condominium.title")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm" data-testid="agent-condominium">
          {!sheet.condominium ? (
            <p className="text-muted-foreground">{t("condominium.none")}</p>
          ) : (
            <>
              <p>
                {t("condominium.name")}: {sheet.condominium.name}
                {sheet.condominium.unitLabel ? ` · ${t("condominium.unit")}: ${sheet.condominium.unitLabel}` : ""}
                {sheet.condominium.administratorName ? ` · ${t("condominium.administrator")}: ${sheet.condominium.administratorName}` : ""}
              </p>
              <h3 className="font-medium">{t("condominium.expensesTitle")}</h3>
              {sheet.condominium.expenses.length === 0 ? (
                <p className="text-muted-foreground">{t("condominium.expensesNone")}</p>
              ) : (
                <ul className="list-disc pl-5">
                  {sheet.condominium.expenses.map((e, i) => (
                    <li key={i}>{t("condominium.expensesLine", { year: e.yearLabel, title: e.title, due: formatEuro(e.dueCents), paid: formatEuro(e.paidCents) })}</li>
                  ))}
                </ul>
              )}
              <p className="text-muted-foreground">{t("condominium.expensesNote")}</p>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("works.title")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm" data-testid="agent-works">
          {sheet.works.length === 0 ? (
            <p className="text-muted-foreground">{t("works.none")}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {sheet.works.map((w) => (
                <li key={w.id}>
                  {t("works.line", { title: w.title, status: tm(`status.${w.status as "planned"}`) })} · {w.referenceOn ? t("works.dateOn", { date: formatDate(w.referenceOn) }) : t("works.noDate")}
                  {w.supplierName ? ` · ${t("works.supplier", { name: w.supplierName })}` : ""}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("letting.title")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm" data-testid="agent-letting">
          {sheet.lettings.length === 0 ? (
            <p className="text-muted-foreground">{t("letting.none")}</p>
          ) : (
            <>
              <ul className="flex flex-col gap-1">
                {sheet.lettings.map((l) => (
                  <li key={l.id}>
                    {[l.title, tl(`types.${l.type}`), tl(`status.${l.status}`), period(l.startsOn, l.endsOn) || null, l.monthlyRentCents !== null ? t("letting.rent", { amount: formatEuro(l.monthlyRentCents) }) : null].filter(Boolean).join(" · ")}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-muted-foreground">{t("letting.note")}</p>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("documents.title")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm" data-testid="agent-documents">
          {sheet.documents.groups.every((g) => g.documents.length === 0) ? <p className="text-muted-foreground">{t("documents.none")}</p> : null}
          {sheet.documents.groups
            .filter((g) => g.documents.length > 0)
            .map((g) => (
              <div key={g.category.id}>
                <h3 className="font-medium">{g.category.name}</h3>
                <ul className="list-disc pl-5">
                  {g.documents.map((d) => (
                    <li key={d.id}>
                      {[d.title, d.issuedOn ? t("documents.issued", { date: formatDate(d.issuedOn) }) : null, d.validTo ? t("documents.validTo", { date: formatDate(d.validTo) }) : null, td(`status.${d.verificationStatus as "draft"}`)].filter(Boolean).join(" · ")}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          {sheet.documents.withheldTotal > 0 ? <p className="text-muted-foreground">{t("documents.withheld", { count: sheet.documents.withheldTotal })}</p> : null}
        </CardContent>
      </Card>

      <Card data-testid="agent-checklist">
        <CardHeader>
          <CardTitle>
            <h2>{t("checklist.title")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <p className="text-muted-foreground">{t("checklist.intro")}</p>
          {sheet.documents.checklist.length === 0 ? (
            <p>{t("checklist.empty")}</p>
          ) : (
            <ul className="list-none pl-0">
              {sheet.documents.checklist.map((c, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span aria-hidden>☐</span>
                  <span>
                    {c.kind === "category_empty" ? t("checklist.category_empty", { name: c.categoryName }) : null}
                    {c.kind === "category_withheld" ? t("checklist.category_withheld", { name: c.categoryName, count: c.count }) : null}
                    {c.kind === "document_expired" ? t("checklist.document_expired", { title: c.title, date: formatDate(c.validTo) }) : null}
                    {c.kind === "dossier_open" ? t("checklist.dossier_open", { title: c.title, status: tdo(`status.${c.status as "missing"}`) }) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Alert>
        <AlertDescription>{t("notice")}</AlertDescription>
      </Alert>

      <Card className="print:hidden">
        <CardHeader>
          <CardTitle>
            <h2>{t("share.title")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p>{t("share.body")}</p>
          <Link href={packageHref} className={buttonVariants({ variant: "outline" }) + " w-fit"}>
            {t("share.open")}
          </Link>
        </CardContent>
      </Card>

      <Card className="print:hidden" data-testid="agent-tracking">
        <CardHeader>
          <CardTitle>
            <h2>{t("tracking.title")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p className="text-muted-foreground">{t("tracking.intro")}</p>
          <h3 className="font-medium">{t("tracking.matters")}</h3>
          {sheet.tracking.matters.length === 0 ? (
            <p className="text-muted-foreground">{t("tracking.noMatters")}</p>
          ) : (
            <ul className="list-disc pl-5">
              {sheet.tracking.matters.map((m) => (
                <li key={m.id}>
                  <Link href={`/pratiche/${m.id}`} className="underline underline-offset-2">
                    {m.title}
                  </Link>{" "}
                  · {tma(`status.${m.status as "open"}`)}
                  {m.assignees.length > 0 ? ` · ${m.assignees.join(", ")}` : ""}
                </li>
              ))}
            </ul>
          )}
          <Link href={`/pratiche/nuova?immobile=${asset.id}`} className={buttonVariants({ variant: "outline", size: "sm" }) + " w-fit"}>
            {t("tracking.newMatter")}
          </Link>
          <h3 className="font-medium">{t("tracking.deadlines")}</h3>
          {sheet.tracking.deadlines.length === 0 ? (
            <p className="text-muted-foreground">{t("tracking.noDeadlines")}</p>
          ) : (
            <ul className="list-disc pl-5">
              {sheet.tracking.deadlines.map((d) => (
                <li key={`${d.id}-${d.dueOn}`}>
                  <Link href={`/scadenze/${d.id}`} className="underline underline-offset-2">
                    {d.title}
                  </Link>{" "}
                  · {formatDate(d.dueOn)}
                </li>
              ))}
            </ul>
          )}
          <Link href={`/scadenze/nuova?immobile=${asset.id}`} className={buttonVariants({ variant: "outline", size: "sm" }) + " w-fit"}>
            {t("tracking.newDeadline")}
          </Link>
        </CardContent>
      </Card>

      <ListingSection assetId={asset.id} />
    </div>
  );
}
