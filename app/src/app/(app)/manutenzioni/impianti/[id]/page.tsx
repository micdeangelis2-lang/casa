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
import { listDocumentOptions } from "@/modules/documents";
import { getPlantDetail, listInspectionPlans, listWarranties, listWorks } from "@/modules/maintenance";
import { ActionButton } from "@/components/action-button";
import { InlineForm } from "@/components/inline-form";
import { isUuid } from "@/lib/ids";
import { formatDate } from "@/lib/format";
import { loadPlantTypes } from "../plant-types";
import { archivePlantAction, attachPlantItemAction, detachPlantItemAction, linkPlantDocumentAction, unlinkPlantDocumentAction } from "../actions";

type Props = PageProps<"/manutenzioni/impianti/[id]">;

async function load(id: string) {
  return isUuid(id) ? getPlantDetail(getDb(), id) : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: (await load((await params).id))?.name ?? "Impianto" };
}

export default async function PlantPage({ params }: Props) {
  await requireOwner();
  const { id } = await params;
  const p = await load(id);
  if (!p) notFound();
  const t = await getTranslations("impiantista.plant");
  const { name: typeName } = await loadPlantTypes();
  const db = getDb();
  const [plans, warranties, works, documents] = await Promise.all([listInspectionPlans(db, { assetId: p.assetId }), listWarranties(db, { assetId: p.assetId }), listWorks(db, { assetId: p.assetId, includeClosed: true }), listDocumentOptions(db)]);
  const items = [
    ...plans.map((x) => ({ kind: "plan" as const, id: x.id, title: x.title, plantId: x.plantId, href: "/manutenzioni?sezione=inspections" })),
    ...warranties.map((x) => ({ kind: "warranty" as const, id: x.id, title: x.title, plantId: x.plantId, href: "/manutenzioni?sezione=warranties" })),
    ...works.map((x) => ({ kind: "work" as const, id: x.id, title: x.title, plantId: x.plantId, href: `/manutenzioni/${x.id}` })),
  ];
  const linked = items.filter((i) => i.plantId === p.id);
  const free = items.filter((i) => i.plantId === null);
  const kindLabel = { plan: t("kindPlan"), warranty: t("kindWarranty"), work: t("kindWork") } as const;
  const linkedDocuments = new Set(p.documents.map((d) => d.id));
  const facts = [
    p.installedOn ? t("installedLine", { date: formatDate(p.installedOn) }) : null,
    p.serialNumber ? t("serialLine", { serial: p.serialNumber }) : null,
    p.installerName ? t("installerLine", { name: p.installerName }) : null,
    p.maintainerName ? t("maintainerLine", { name: p.maintainerName }) : null,
  ].filter(Boolean);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Link href="/manutenzioni/impianti" className="text-sm underline underline-offset-2 print:hidden">
            {t("back")}
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{p.name}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{typeName(p.kind)}</Badge>
            <span className="text-sm text-muted-foreground">{p.assetName}</span>
          </div>
          {facts.length > 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="plant-facts">
              {facts.join(" · ")}
            </p>
          ) : null}
          {p.note ? <p className="whitespace-pre-wrap text-sm">{p.note}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Link href={`/manutenzioni/impianti/${p.id}/modifica`} className={buttonVariants({ variant: "outline" })}>
            <Pencil aria-hidden /> {t("edit")}
          </Link>
          <ActionButton variant="outline" size="default" action={archivePlantAction.bind(null, p.id, !p.archived)}>
            {p.archived ? t("restore") : t("archive")}
          </ActionButton>
        </div>
      </div>
      {p.archived ? (
        <Alert>
          <AlertDescription>{t("archivedNotice")}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("links")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {linked.length === 0 ? <p className="text-sm text-muted-foreground">{t("noLinks")}</p> : null}
          <ul className="flex flex-col gap-1 text-sm" data-testid="plant-links">
            {linked.map((i) => (
              <li key={`${i.kind}-${i.id}`} className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{kindLabel[i.kind]}</Badge>
                <Link href={i.href} className="underline underline-offset-2">
                  {i.title}
                </Link>
                <ActionButton action={detachPlantItemAction.bind(null, p.id, i.kind, i.id)} srLabel={i.title}>
                  {t("detach")}
                </ActionButton>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">{t("attachHint")}</p>
          {free.length === 0 ? <p className="text-sm text-muted-foreground">{t("attachNone")}</p> : null}
          {(["plan", "warranty", "work"] as const).map((kind) => {
            const options = free.filter((i) => i.kind === kind).map((i) => ({ value: i.id, label: i.title }));
            if (options.length === 0) return null;
            return (
              <InlineForm
                key={kind}
                idPrefix={`attach-${kind}`}
                title={`${t("attach")}: ${kindLabel[kind]}`}
                fields={[{ kind: "select", name: "itemId", label: kindLabel[kind], options, emptyLabel: t("attachChoose") }]}
                initial={{ itemId: "" }}
                submitLabel={t("attachButton")}
                onSubmit={attachPlantItemAction.bind(null, p.id, kind)}
              />
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("documents")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {p.documents.length === 0 ? <p className="text-sm text-muted-foreground">{t("noDocuments")}</p> : null}
          <ul className="flex flex-col gap-1 text-sm" data-testid="plant-documents">
            {p.documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2">
                <Link href={`/documenti/${d.id}`} className="underline underline-offset-2">
                  {d.title}
                </Link>
                <ActionButton action={unlinkPlantDocumentAction.bind(null, p.id, d.id)} srLabel={d.title}>
                  {t("unlink")}
                </ActionButton>
              </li>
            ))}
          </ul>
          <InlineForm
            idPrefix="plant-doc"
            title={t("linkDocument")}
            fields={[{ kind: "select", name: "documentId", label: t("linkDocument"), options: documents.filter((d) => !linkedDocuments.has(d.value)), emptyLabel: t("chooseDocument") }]}
            initial={{ documentId: "" }}
            submitLabel={t("linkButton")}
            onSubmit={linkPlantDocumentAction.bind(null, p.id)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
