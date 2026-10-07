import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { DOSSIER_STATUSES, getDossier, listLinkableDocuments, listDossierCategories, type DossierItemView } from "@/modules/dossier";
import { describeTerritories } from "@/modules/territory";
import { isUuid } from "@/lib/ids";
import { TraceText, useFactLabels } from "../../../regole/_components/condition-text";
import { PrintButton } from "@/components/print-button";
import { AddItemForm, DeleteItemButton, EvaluateButton, LinkDocument, NoteForm, StatusSelect, UnlinkButton } from "./_components/dossier-controls";

type Props = PageProps<"/immobili/[id]/dossier">;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dossier");
  return { title: t("title") };
}

const date = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("it-IT");

export default async function DossierPage({ params }: Props) {
  await requireOwner();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const db = getDb();
  const dossier = await getDossier(db, id);
  if (!dossier) notFound();
  const t = await getTranslations("dossier");
  const tr = await getTranslations("rules");

  const [linkable, categories] = await Promise.all([listLinkableDocuments(db), listDossierCategories(db)]);
  const territoryIds = [...new Set([...dossier.categories.flatMap((c) => c.items.flatMap((i) => (i.explanation?.territoryId ? [i.explanation.territoryId] : []))), ...dossier.notices.flatMap((n) => (n.explanation.territoryId ? [n.explanation.territoryId] : []))])];
  const territoryLabels = new Map((await describeTerritories(db, territoryIds)).map((x) => [x.id, x.label]));
  const documentOptions = linkable.map((d) => ({ id: d.id, label: d.title }));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("title")}: {dossier.assetName}
          </h1>
          <Link href={`/immobili/${id}`} className="text-sm underline underline-offset-2 print:hidden">
            {t("back")}
          </Link>
        </div>
        <div className="flex gap-2">
          <PrintButton />
        </div>
      </div>

      <Alert>
        <AlertDescription>{t("disclaimer")}</AlertDescription>
      </Alert>

      <section aria-labelledby="summary-heading" className="flex flex-col gap-2 rounded-lg border p-4">
        <h2 id="summary-heading" className="text-lg font-medium">
          {t("summary.heading")} · {t("summary.total", { count: dossier.summary.total })}
        </h2>
        <ul className="flex flex-wrap gap-2" data-testid="dossier-summary">
          {DOSSIER_STATUSES.map((s) => (
            <li key={s}>
              <Badge variant={dossier.summary.byStatus[s] > 0 ? "secondary" : "outline"}>
                {t(`status.${s}`)}: {dossier.summary.byStatus[s]}
              </Badge>
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">{t("summary.note")}</p>
      </section>

      <EvaluateButton assetId={id} />

      {dossier.notices.length > 0 ? (
        <section aria-labelledby="notices-heading" className="flex flex-col gap-2 rounded-lg border p-4" data-testid="dossier-notices">
          <h2 id="notices-heading" className="text-lg font-medium">
            {t("notices.heading")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("notices.body")}</p>
          <ul className="flex flex-col gap-2">
            {dossier.notices.map((n) => (
              <li key={`${n.ruleKey}/${n.outcomeKey}`} className="flex flex-col gap-1 text-sm">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{n.title}</span>
                  <Badge variant="secondary">{tr(`level.${n.explanation.level}`)}</Badge>
                  {n.explanation.verificationStatus === "draft" || n.explanation.verificationStatus === "to_verify" ? <Badge variant="outline">{t("unverified")}</Badge> : null}
                </span>
                <span>{n.message}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {dossier.staleCount > 0 ? (
        <Alert>
          <AlertTriangle aria-hidden />
          <AlertDescription>{t("staleHelp")}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-8">
        {dossier.categories.map(({ category, items }) => (
          <section key={category.id} aria-labelledby={`cat-${category.code}`} data-testid={`category-${category.code}`}>
            <h2 id={`cat-${category.code}`} className="mb-2 text-lg font-medium">
              {category.name}
            </h2>
            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("empty")}</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {items.map((item) => (
                  <li key={item.id}>
                    <ItemCard assetId={id} item={item} documentOptions={documentOptions} territoryLabels={territoryLabels} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      <AddItemForm assetId={id} categories={categories.map((c) => ({ id: c.id, name: c.name }))} />
    </div>
  );
}

function ItemCard({ assetId, item, documentOptions, territoryLabels }: { assetId: string; item: DossierItemView; documentOptions: { id: string; label: string }[]; territoryLabels: Map<string, string> }) {
  const t = useTranslations("dossier");
  const ti = useTranslations("dossier.item");
  const tr = useTranslations("rules");
  const labels = useFactLabels();
  const exp = item.explanation;
  const linkedIds = new Set(item.documents.map((d) => d.id));

  return (
    <article className="flex flex-col gap-3 rounded-lg border p-4" data-testid="dossier-item" aria-label={item.title}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h3 className="font-medium">{item.title}</h3>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{item.origin === "rule" ? t("origin.rule") : t("origin.manual")}</Badge>
            {exp ? <Badge variant="secondary">{tr(`level.${exp.level}`)}</Badge> : null}
            {item.unverifiedRule ? <Badge variant="outline">{t("unverified")}</Badge> : null}
            {item.stale ? <Badge variant="destructive">{t("stale")}</Badge> : null}
          </div>
        </div>
        <StatusSelect key={`${item.id}-${item.status}`} assetId={assetId} itemId={item.id} status={item.status} title={item.title} />
      </div>

      {item.expectedDocumentCategoryName ? <p className="text-sm text-muted-foreground">{ti("expectedCategory", { name: item.expectedDocumentCategoryName })}</p> : null}
      {item.ruleNote ? <p className="text-sm text-muted-foreground">{item.ruleNote}</p> : null}

      <div className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{ti("documents")}</span>
        {item.documents.length === 0 ? (
          <span className="text-muted-foreground">{ti("noDocuments")}</span>
        ) : (
          <ul className="flex flex-col gap-1">
            {item.documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2">
                <Link href={`/documenti/${d.id}`} className="underline underline-offset-2">
                  {d.title}
                </Link>
                {d.expired && d.validTo ? <Badge variant="destructive">{ti("expiredDocument", { date: date(d.validTo) })}</Badge> : null}
                <UnlinkButton assetId={assetId} itemId={item.id} documentId={d.id} documentTitle={d.title} />
              </li>
            ))}
          </ul>
        )}
      </div>
      <LinkDocument assetId={assetId} itemId={item.id} options={documentOptions.filter((o) => !linkedIds.has(o.id))} title={item.title} />

      <NoteForm key={`${item.id}-${item.ownerNote ?? ""}`} assetId={assetId} itemId={item.id} note={item.ownerNote ?? ""} title={item.title} />

      {exp ? (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">{ti("why")}</summary>
          <div className="mt-2 flex flex-col gap-2">
            <p>{ti("ruleLine", { title: exp.ruleTitle, number: exp.versionNo })}</p>
            <p>{ti("level", { level: tr(`level.${exp.level}`) })}</p>
            {exp.territoryId ? <p>{ti("territory", { territory: territoryLabels.get(exp.territoryId) ?? "" })}</p> : null}
            <p>{ti("verification", { status: tr(`verification.${exp.verificationStatus}`) })}</p>
            <p>{ti("source", { source: exp.sourceText })}</p>
            <div>
              <p className="font-medium">{ti("conditions")}</p>
              {exp.trace ? <TraceText trace={exp.trace} /> : <p className="text-muted-foreground">{ti("noConditions")}</p>}
            </div>
            {exp.facts.length > 0 ? (
              <div>
                <p className="font-medium">{ti("facts")}</p>
                <ul className="ml-5 list-disc">
                  {exp.facts.map((f) => (
                    <li key={f.path}>
                      {labels.fact(f.path)}: {labels.value(f.path, f.value)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </details>
      ) : null}

      {item.origin === "manual" ? (
        <div>
          <DeleteItemButton assetId={assetId} itemId={item.id} title={item.title} />
        </div>
      ) : null}
    </article>
  );
}
