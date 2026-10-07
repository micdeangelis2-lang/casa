import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Pencil } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { getAssetDetail } from "@/modules/assets";
import { listDocuments } from "@/modules/documents";
import { DOSSIER_STATUSES, getDossier } from "@/modules/dossier";
import { isUuid } from "@/lib/ids";
import { ArchiveButton } from "../_components/archive-button";

type Props = PageProps<"/immobili/[id]">;

async function load(id: string) {
  if (!isUuid(id)) return null;
  return getAssetDetail(getDb(), id);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const detail = await load((await params).id);
  return { title: detail?.name ?? "Immobile" };
}

const date = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("it-IT");
const euro = (cents: number) => (cents / 100).toLocaleString("it-IT", { style: "currency", currency: "EUR" });

export default async function AssetPage({ params }: Props) {
  await requireOwner();
  const { id } = await params;
  const asset = await load(id);
  if (!asset) notFound();
  const t = await getTranslations("assets");
  const tc = await getTranslations("common");
  const td = await getTranslations("documents");
  const documents = await listDocuments(getDb(), { assetId: asset.id });
  const dossier = await getDossier(getDb(), asset.id);
  const tdo = await getTranslations("dossier");
  const ttec = await getTranslations("tecnico");
  const tn = await getTranslations("notaio");
  const tag = await getTranslations("agente");

  const period = (from: string | null, to: string | null) =>
    [from ? t("detail.from", { date: date(from) }) : null, to ? t("detail.to", { date: date(to) }) : null].filter(Boolean).join(" ");

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{asset.name}</h1>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{t(`kind.${asset.kind}`)}</Badge>
            {asset.useType ? <Badge variant="outline">{t(`use.${asset.useType}`)}</Badge> : null}
            {asset.inCondominium ? <Badge variant="outline">{t("detail.condominiumYes")}</Badge> : null}
            {asset.archived ? <Badge variant="destructive">{t("archivedBadge")}</Badge> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/immobili/${asset.id}/notaio`} className={buttonVariants({ variant: "outline" })}>
            {tn("open")}
          </Link>
          <Link href={`/immobili/${asset.id}/scheda-agente`} className={buttonVariants({ variant: "outline" })}>
            {tag("open")}
          </Link>
          <Link href={`/immobili/${asset.id}/modifica`} className={buttonVariants({ variant: "outline" })}>
            <Pencil aria-hidden /> {tc("edit")}
          </Link>
          <ArchiveButton assetId={asset.id} archived={asset.archived} />
        </div>
      </div>

      {asset.archived ? (
        <Alert>
          <AlertDescription>{t("detail.archivedNotice")}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("detail.details")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted-foreground">{t("form.territory")}</dt>
            <dd>{asset.territoryLabel}</dd>
            {asset.locality ? (
              <>
                <dt className="text-muted-foreground">{t("form.locality")}</dt>
                <dd>{asset.locality}</dd>
              </>
            ) : null}
            {asset.address || asset.postalCode ? (
              <>
                <dt className="text-muted-foreground">{t("form.address")}</dt>
                <dd>{[asset.address, asset.postalCode].filter(Boolean).join(" – ")}</dd>
              </>
            ) : null}
            {asset.notes ? (
              <>
                <dt className="text-muted-foreground">{t("form.notes")}</dt>
                <dd className="whitespace-pre-wrap">{asset.notes}</dd>
              </>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("form.ownership")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {asset.rights.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("detail.noRights")}</p>
          ) : (
            <ul className="flex flex-col gap-3 text-sm" data-testid="rights">
              {asset.rights.map((r) => (
                <li key={r.id}>
                  <span className="font-medium">{r.holder.displayName}</span> – {t(`right.${r.rightType}`)},{" "}
                  {t("detail.quota", { numerator: r.quotaNumerator, denominator: r.quotaDenominator })}
                  {period(r.validFrom, r.validTo) ? <span className="text-muted-foreground"> ({period(r.validFrom, r.validTo)})</span> : null}
                  {r.notes ? <p className="text-muted-foreground">{r.notes}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("form.cadastral")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {asset.cadastral.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("detail.noCadastral")}</p>
          ) : (
            <ul className="flex flex-col gap-3 text-sm" data-testid="cadastral">
              {asset.cadastral.map((c) => (
                <li key={c.id}>
                  {[
                    c.sheet ? `${t("form.sheet")} ${c.sheet}` : null,
                    c.parcel ? `${t("form.parcel")} ${c.parcel}` : null,
                    c.subunit ? `${t("form.subunit")} ${c.subunit}` : null,
                    c.cadastralCategory ? `${t("form.cadastralCategory")} ${c.cadastralCategory}` : null,
                    c.cadastralClass ? `${t("form.cadastralClass")} ${c.cadastralClass}` : null,
                    c.consistency ? `${t("form.consistency")} ${c.consistency}` : null,
                    c.incomeCents !== null ? t("detail.income", { amount: euro(c.incomeCents) }) : null,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                  {period(c.validFrom, c.validTo) ? <span className="text-muted-foreground"> ({period(c.validFrom, c.validTo)})</span> : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("form.attributes")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {Object.keys(asset.attributes).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("detail.noAttributes")}</p>
          ) : (
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[14rem_1fr]" data-testid="attributes">
              {Object.entries(asset.attributes).map(([name, value]) => (
                <div key={name} className="contents">
                  <dt className="font-mono text-muted-foreground">{name}</dt>
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
            <h2>{t("form.links")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          {asset.linkedTo.length === 0 && asset.linkedFrom.length === 0 ? (
            <p className="text-muted-foreground">{t("detail.noLinks")}</p>
          ) : null}
          {asset.linkedTo.length > 0 ? (
            <div>
              <h3 className="mb-1 font-medium">{t("detail.linkedTo")}</h3>
              <ul className="flex flex-col gap-1" data-testid="linked-to">
                {asset.linkedTo.map((l) => (
                  <li key={l.id}>
                    <Link href={`/immobili/${l.asset.id}`} className="underline underline-offset-2">
                      {l.asset.name}
                    </Link>{" "}
                    <Badge variant="outline">{t(`linkValidation.${l.validationStatus}`)}</Badge>
                    {l.declaredBasis ? <span className="text-muted-foreground"> – {l.declaredBasis}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {asset.linkedFrom.length > 0 ? (
            <div>
              <h3 className="mb-1 font-medium">{t("detail.linkedFrom")}</h3>
              <ul className="flex flex-col gap-1" data-testid="linked-from">
                {asset.linkedFrom.map((l) => (
                  <li key={l.id}>
                    <Link href={`/immobili/${l.asset.id}`} className="underline underline-offset-2">
                      {l.asset.name}
                    </Link>{" "}
                    <Badge variant="outline">{t(`linkValidation.${l.validationStatus}`)}</Badge>
                    {l.declaredBasis ? <span className="text-muted-foreground"> – {l.declaredBasis}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle>
            <h2>{tdo("forAsset.title")}</h2>
          </CardTitle>
          <Link href={`/immobili/${asset.id}/dossier`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            {tdo("forAsset.open")}
          </Link>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <p className="text-muted-foreground">{tdo("forAsset.body")}</p>
          {dossier && dossier.summary.total > 0 ? (
            <ul className="flex flex-wrap gap-2" data-testid="dossier-glance">
              {DOSSIER_STATUSES.filter((s) => dossier.summary.byStatus[s] > 0).map((s) => (
                <li key={s}>
                  <Badge variant="secondary">
                    {tdo(`status.${s}`)}: {dossier.summary.byStatus[s]}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle>
            <h2>{ttec("link")}</h2>
          </CardTitle>
          <Link href={`/immobili/${asset.id}/scheda-tecnica`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            {ttec("link")}
          </Link>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">{ttec("linkHint")}</CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle>
            <h2>{td("forAsset.title")}</h2>
          </CardTitle>
          <Link href={`/documenti/nuovo?bene=${asset.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            {td("forAsset.add")}
          </Link>
        </CardHeader>
        <CardContent className="text-sm">
          {documents.length === 0 ? (
            <p className="text-muted-foreground">{td("forAsset.none")}</p>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="asset-documents">
              {documents.map((d) => (
                <li key={d.id}>
                  <Link href={`/documenti/${d.id}`} className="underline underline-offset-2">
                    {d.title}
                  </Link>{" "}
                  <Badge variant="outline">{d.categoryName}</Badge>
                </li>
              ))}
              <li>
                <Link href={`/documenti?immobile=${asset.id}`} className="text-muted-foreground underline underline-offset-2">
                  {td("forAsset.all")}
                </Link>
              </li>
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
