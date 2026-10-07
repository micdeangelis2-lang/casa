import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { PrintButton } from "@/components/print-button";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { getAssetDetail } from "@/modules/assets";
import { getParty, listParties } from "@/modules/directory";
import { listDocumentCategories, listDocumentOptions } from "@/modules/documents";
import { ENCUMBRANCE_KINDS, PROVENANCE_KINDS, getNotarySheet, notaryPackageHref, type Gap } from "@/modules/notary";
import { ActionButton } from "@/components/action-button";
import { InlineForm } from "@/components/inline-form";
import { formatDate, formatEuro } from "@/lib/format";
import { isUuid } from "@/lib/ids";
import { addEncumbranceAction, addProvenanceAction, removeEncumbranceAction, removeProvenanceAction } from "./actions";

type Props = PageProps<"/immobili/[id]/notaio">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations("notaio");
  const { id } = await params;
  const asset = isUuid(id) ? await getAssetDetail(getDb(), id) : null;
  return { title: asset ? `${t("title")} – ${asset.name}` : t("title") };
}

const many = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).filter(isUuid);

export default async function NotarySheetPage({ params, searchParams }: Props) {
  await requireOwner();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const query = await searchParams;
  const db = getDb();
  const focusCategoryIds = many(query.categoria);
  const sheet = await getNotarySheet(db, id, { focusCategoryIds });
  if (!sheet) notFound();

  const t = await getTranslations("notaio");
  const ta = await getTranslations("assets");
  const td = await getTranslations("documents");
  const tdo = await getTranslations("dossier");
  const [categories, notaries, allParties, documentOptions] = await Promise.all([listDocumentCategories(db), listParties(db, { role: "notary" }), listParties(db), listDocumentOptions(db)]);
  const partyOptions = allParties.map((p) => ({ value: p.id, label: p.displayName }));
  const contactParam = Array.isArray(query.contatto) ? query.contatto[0] : query.contatto;
  const contact = contactParam && isUuid(contactParam) ? await getParty(db, contactParam) : null;

  const { asset } = sheet;
  const period = (from: string | null, to: string | null) =>
    [from ? ta("detail.from", { date: formatDate(from) }) : null, to ? ta("detail.to", { date: formatDate(to) }) : null].filter(Boolean).join(" ");
  const notIndicated = t("holders.notIndicated");
  const focusIds = sheet.documentGroups.filter((g) => g.focus).map((g) => g.category.id);

  const gapText = (gap: Gap): string => {
    const params: Record<string, string | number> = { ...gap.params };
    if (typeof params.fields === "string") params.fields = params.fields.split(",").map((f) => t(`gaps.field.${f as "taxCode"}`)).join(", ");
    if (typeof params.rightType === "string") params.rightType = ta(`right.${params.rightType as "full"}`);
    return t(`gaps.${gap.code}`, params);
  };

  const cadastralLine = (c: (typeof sheet.cadastralCurrent)[number]) =>
    [
      c.sheet ? `${ta("form.sheet")} ${c.sheet}` : null,
      c.parcel ? `${ta("form.parcel")} ${c.parcel}` : null,
      c.subunit ? `${ta("form.subunit")} ${c.subunit}` : null,
      c.cadastralCategory ? `${ta("form.cadastralCategory")} ${c.cadastralCategory}` : null,
      c.cadastralClass ? `${ta("form.cadastralClass")} ${c.cadastralClass}` : null,
      c.consistency ? `${ta("form.consistency")} ${c.consistency}` : null,
      c.incomeCents !== null ? ta("detail.income", { amount: `${formatEuro(c.incomeCents)} €` }) : null,
    ]
      .filter(Boolean)
      .join(", ");

  const packageHref = notaryPackageHref({ assetIds: [asset.id, ...sheet.related.map((r) => r.id)], categoryIds: focusIds, contactId: contact?.id });

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
            {contact ? ` · ${t("contact.preparedFor", { name: contact.displayName })}` : ""}
          </p>
        </div>
        <PrintButton />
      </div>
      <p className="text-sm text-muted-foreground">{t("intro")}</p>

      <form method="get" className="flex flex-col gap-4 print:hidden" aria-label={t("categoriesLegend")}>
        <div className="flex max-w-sm flex-col gap-2">
          <Label htmlFor="contatto">{t("contact.label")}</Label>
          <NativeSelect id="contatto" name="contatto" defaultValue={contact?.id ?? ""}>
            <option value="">{t("contact.none")}</option>
            {notaries.map((n) => (
              <option key={n.id} value={n.id}>
                {n.displayName}
              </option>
            ))}
          </NativeSelect>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">{t("categoriesLegend")}</legend>
          <p className="text-sm text-muted-foreground">{t("categoriesHint")}</p>
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
            {t("contact.show")}
          </Button>
        </div>
      </form>

      <Card data-testid="notary-gaps">
        <CardHeader>
          <CardTitle>
            <h2>{t("gaps.title")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <p className="text-muted-foreground">{t("gaps.intro")}</p>
          {sheet.gaps.length === 0 ? (
            <p>{t("gaps.empty")}</p>
          ) : (
            <ul className="list-disc pl-5">
              {sheet.gaps.map((g, i) => (
                <li key={`${g.code}-${i}`}>{gapText(g)}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("asset.title")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted-foreground">{t("asset.kind")}</dt>
            <dd>{ta(`kind.${asset.kind as "dwelling"}`)}</dd>
            <dt className="text-muted-foreground">{t("asset.territory")}</dt>
            <dd>{asset.territoryLabel}</dd>
            <dt className="text-muted-foreground">{t("asset.address")}</dt>
            <dd>{[asset.address, asset.postalCode, asset.locality].filter(Boolean).join(" – ") || notIndicated}</dd>
            {asset.useType ? (
              <>
                <dt className="text-muted-foreground">{t("asset.use")}</dt>
                <dd>{ta(`use.${asset.useType as "other"}`)}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">{t("asset.condominium")}</dt>
            <dd>{asset.inCondominium ? ta("detail.condominiumYes") : "–"}</dd>
            {asset.notes ? (
              <>
                <dt className="text-muted-foreground">{t("asset.notes")}</dt>
                <dd className="whitespace-pre-wrap">{asset.notes}</dd>
              </>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("holders.title")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          {sheet.holders.length === 0 ? <p className="text-muted-foreground">{t("holders.empty")}</p> : null}
          <ul className="flex flex-col gap-4" data-testid="notary-holders">
            {sheet.holders.map((h, i) => (
              <li key={`${h.holder.id}-${h.rightType}-${i}`} className="flex flex-col gap-1">
                <p>
                  <span className="font-medium">{h.holder.displayName}</span> – {ta(`right.${h.rightType as "full"}`)}, {ta("detail.quota", { numerator: h.quotaNumerator, denominator: h.quotaDenominator })}{" "}
                  <Badge variant={h.current ? "secondary" : "outline"}>{h.current ? t("holders.current") : t("holders.past")}</Badge>
                  {period(h.validFrom, h.validTo) ? <span className="text-muted-foreground"> ({period(h.validFrom, h.validTo)})</span> : null}
                </p>
                <p className="text-muted-foreground">
                  {t("holders.taxCode")}: {h.party?.taxCode ?? notIndicated} · {t("holders.address")}: {h.party?.address ?? notIndicated}
                  {h.party?.pec ? ` · ${t("holders.pec")}: ${h.party.pec}` : ""}
                </p>
                {h.notes ? (
                  <p>
                    <span className="text-muted-foreground">{t("holders.provenanceNote")}:</span> {h.notes}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          {sheet.quotaTotals.length > 0 ? (
            <div>
              <h3 className="font-medium">{t("holders.totals")}</h3>
              <ul className="list-disc pl-5" data-testid="notary-quota-totals">
                {sheet.quotaTotals.map((q) => (
                  <li key={q.rightType}>
                    {t("holders.totalLine", { type: ta(`right.${q.rightType as "full"}`), sum: `${q.numerator}/${q.denominator}` })} ({q.whole ? t("holders.totalWhole") : t("holders.totalPartial")})
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("cadastral.title")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {asset.cadastral.length === 0 ? <p className="text-muted-foreground">{t("cadastral.empty")}</p> : null}
          {asset.cadastral.length > 0 ? (
            <div>
              <h3 className="font-medium">{t("cadastral.current")}</h3>
              {sheet.cadastralCurrent.length === 0 ? <p className="text-muted-foreground">{t("cadastral.none")}</p> : null}
              <ul className="flex flex-col gap-1" data-testid="notary-cadastral">
                {sheet.cadastralCurrent.map((c, i) => (
                  <li key={i}>
                    {cadastralLine(c)}
                    {period(c.validFrom, c.validTo) ? <span className="text-muted-foreground"> ({period(c.validFrom, c.validTo)})</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {sheet.cadastralHistory.length > 0 ? (
            <div>
              <h3 className="font-medium">{t("cadastral.history")}</h3>
              <ul className="flex flex-col gap-1" data-testid="notary-cadastral-history">
                {sheet.cadastralHistory.map((c, i) => (
                  <li key={i}>
                    {cadastralLine(c)}
                    {period(c.validFrom, c.validTo) ? <span className="text-muted-foreground"> ({period(c.validFrom, c.validTo)})</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("documents.title")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p className="text-muted-foreground">{t("documents.totals", sheet.documentTotals)}</p>
          <ul className="flex flex-col gap-3" data-testid="notary-documents">
            {sheet.documentGroups.map((g) => (
              <li key={g.category.id}>
                <h3 className="font-medium">
                  {g.category.name} {g.focus ? <Badge variant="outline">{t("documents.focusBadge")}</Badge> : null}
                </h3>
                {g.documents.length === 0 ? (
                  <p className="text-muted-foreground">{t("documents.none")}</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {g.documents.map((d) => (
                      <li key={d.id}>
                        <Link href={`/documenti/${d.id}`} className="underline underline-offset-2">
                          {d.title}
                        </Link>{" "}
                        <Badge variant="outline">{td(`status.${d.verificationStatus as "draft"}`)}</Badge>
                        {d.issuedOn ? <span className="text-muted-foreground"> · {t("documents.issued", { date: formatDate(d.issuedOn) })}</span> : null}
                        {d.validTo ? <span className="text-muted-foreground"> · {t("documents.validTo", { date: formatDate(d.validTo) })}</span> : null}
                        {d.expired ? <Badge variant="destructive">{t("documents.expired")}</Badge> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("provenance.title")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p className="text-muted-foreground">{t("provenance.hint")}</p>
          {sheet.provenances.length === 0 ? <p data-testid="notary-provenance-empty">{t("provenance.empty")}</p> : null}
          <ul className="flex flex-col gap-2" data-testid="notary-provenance">
            {sheet.provenances.map((p) => (
              <li key={p.id} className="flex flex-col gap-1">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{t(`provenance.kind.${p.kind as "purchase"}`)}</span>
                  {p.occurredOn ? <span>{t("provenance.occurredOn", { date: formatDate(p.occurredOn) })}</span> : null}
                  {p.fromName ? <span>{t("provenance.from", { name: p.fromName })}</span> : null}
                  {p.notaryName ? <span>{t("provenance.notary", { name: p.notaryName })}</span> : null}
                  <ActionButton action={removeProvenanceAction.bind(null, asset.id, p.id)} srLabel={t(`provenance.kind.${p.kind as "purchase"}`)}>
                    {t("provenance.remove")}
                  </ActionButton>
                </p>
                {p.deedReference ? <p className="text-muted-foreground">{t("provenance.deed", { reference: p.deedReference })}</p> : null}
                <p>
                  {p.documentId && p.documentTitle ? (
                    <Link href={`/documenti/${p.documentId}`} className="underline underline-offset-2">
                      {p.documentTitle}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">{t("provenance.noDocument")}</span>
                  )}
                </p>
                {p.note ? <p className="whitespace-pre-wrap">{p.note}</p> : null}
              </li>
            ))}
          </ul>
          <InlineForm
            idPrefix="provenance"
            title={t("provenance.add")}
            fields={[
              { kind: "select", name: "kind", label: t("provenance.addKind"), options: PROVENANCE_KINDS.map((k) => ({ value: k, label: t(`provenance.kind.${k}`) })), emptyLabel: t("provenance.addChoose") },
              { kind: "date", name: "occurredOn", label: t("provenance.addOccurredOn") },
              { kind: "select", name: "fromPartyId", label: t("provenance.addFrom"), options: partyOptions, emptyLabel: t("provenance.addNone") },
              { kind: "select", name: "notaryPartyId", label: t("provenance.addNotary"), options: partyOptions, emptyLabel: t("provenance.addNone") },
              { kind: "text", name: "deedReference", label: t("provenance.addDeed"), maxLength: 200 },
              { kind: "select", name: "documentId", label: t("provenance.addDocument"), options: documentOptions, emptyLabel: t("provenance.addNone") },
              { kind: "textarea", name: "note", label: t("provenance.addNote"), maxLength: 1000 },
            ]}
            initial={{ kind: "", occurredOn: "", fromPartyId: "", notaryPartyId: "", deedReference: "", documentId: "", note: "" }}
            submitLabel={t("provenance.addButton")}
            onSubmit={addProvenanceAction.bind(null, asset.id)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("encumbrances.title")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p className="text-muted-foreground">{t("encumbrances.hint")}</p>
          {sheet.encumbranceRecords.length === 0 ? <p data-testid="notary-encumbrances-empty">{t("encumbrances.empty")}</p> : null}
          <ul className="flex flex-col gap-2" data-testid="notary-encumbrance-records">
            {sheet.encumbranceRecords.map((e) => (
              <li key={e.id} className="flex flex-col gap-1">
                <p className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{t(`encumbrances.kind.${e.kind as "mortgage"}`)}</Badge>
                  <span className="font-medium">{e.title}</span>
                  {e.registeredOn ? <span>{t("encumbrances.registeredOn", { date: formatDate(e.registeredOn) })}</span> : null}
                  {e.endedOn ? <span>{t("encumbrances.endedOn", { date: formatDate(e.endedOn) })}</span> : null}
                  <ActionButton action={removeEncumbranceAction.bind(null, asset.id, e.id)} srLabel={e.title}>
                    {t("encumbrances.remove")}
                  </ActionButton>
                </p>
                <p className="text-muted-foreground">
                  {[e.beneficiaryName ? t("encumbrances.beneficiary", { name: e.beneficiaryName }) : null, e.amountCents !== null ? t("encumbrances.amount", { amount: formatEuro(e.amountCents) }) : null, e.reference ? t("encumbrances.reference", { reference: e.reference }) : null].filter(Boolean).join(" · ")}
                </p>
                <p>
                  {e.documentId && e.documentTitle ? (
                    <Link href={`/documenti/${e.documentId}`} className="underline underline-offset-2">
                      {e.documentTitle}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">{t("encumbrances.noDocument")}</span>
                  )}
                </p>
                {e.note ? <p className="whitespace-pre-wrap">{e.note}</p> : null}
              </li>
            ))}
          </ul>
          <InlineForm
            idPrefix="encumbrance"
            title={t("encumbrances.add")}
            fields={[
              { kind: "select", name: "kind", label: t("encumbrances.addKind"), options: ENCUMBRANCE_KINDS.map((k) => ({ value: k, label: t(`encumbrances.kind.${k}`) })), emptyLabel: t("encumbrances.addChoose") },
              { kind: "text", name: "title", label: t("encumbrances.addTitle"), maxLength: 200 },
              { kind: "date", name: "registeredOn", label: t("encumbrances.addRegisteredOn") },
              { kind: "date", name: "endedOn", label: t("encumbrances.addEndedOn") },
              { kind: "select", name: "beneficiaryPartyId", label: t("encumbrances.addBeneficiary"), options: partyOptions, emptyLabel: t("encumbrances.addNone") },
              { kind: "text", name: "amount", label: t("encumbrances.addAmount"), inputMode: "decimal", maxLength: 14 },
              { kind: "text", name: "reference", label: t("encumbrances.addReference"), maxLength: 200 },
              { kind: "select", name: "documentId", label: t("encumbrances.addDocument"), options: documentOptions, emptyLabel: t("encumbrances.addNone") },
              { kind: "textarea", name: "note", label: t("encumbrances.addNote"), maxLength: 1000 },
            ]}
            initial={{ kind: "", title: "", registeredOn: "", endedOn: "", beneficiaryPartyId: "", amount: "", reference: "", documentId: "", note: "" }}
            submitLabel={t("encumbrances.addButton")}
            onSubmit={addEncumbranceAction.bind(null, asset.id)}
          />
          {sheet.encumbrances.length > 0 ? (
            <div>
              <h3 className="font-medium">{t("encumbrances.mentionsTitle")}</h3>
              <p className="text-muted-foreground">{t("encumbrances.mentionsHint")}</p>
              <ul className="list-disc pl-5" data-testid="notary-encumbrances">
                {sheet.encumbrances.map((e, i) => (
                  <li key={i}>
                    {e.title} – {e.source === "document" ? t("encumbrances.document") : t("encumbrances.dossier")}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("dossier.title")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {sheet.dossierOpen.length === 0 ? (
            <p className="text-muted-foreground">{t("dossier.empty")}</p>
          ) : (
            <ul className="list-disc pl-5">
              {sheet.dossierOpen.map((i, n) => (
                <li key={n}>{t("dossier.line", { title: i.title, category: i.categoryName, status: tdo(`status.${i.status as "missing"}`) })}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("related.title")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {sheet.related.length === 0 ? <p className="text-muted-foreground">{t("related.empty")}</p> : null}
          <ul className="flex flex-col gap-2" data-testid="notary-related">
            {sheet.related.map((r) => (
              <li key={`${r.direction}-${r.id}`}>
                <span className="font-medium">{r.name}</span> ({ta(`kind.${r.kind as "dwelling"}`)}) – {t(`related.${r.direction}`)}{" "}
                <Badge variant="outline">{ta(`linkValidation.${r.validationStatus as "declared"}`)}</Badge>
                {r.declaredBasis ? <span className="text-muted-foreground"> – {r.declaredBasis}</span> : null}
                <br />
                <span className="text-muted-foreground">{t("related.line", { rights: r.rightsCount, cadastral: r.currentCadastralCount })}</span>{" "}
                <Link href={`/immobili/${r.id}/notaio`} className="underline underline-offset-2 print:hidden">
                  {t("related.open")}
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card className="print:hidden">
        <CardHeader>
          <CardTitle>
            <h2>{t("package.title")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p className="text-muted-foreground">{t("package.body")}</p>
          <div>
            <Link href={packageHref} className={buttonVariants({ variant: "outline" })}>
              {t("package.open")}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
