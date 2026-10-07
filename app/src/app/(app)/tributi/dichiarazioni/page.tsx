import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireOwner } from "@/platform/auth/owner";
import { getDb } from "@/platform/db/client";
import { listAssets } from "@/modules/assets";
import { listDocumentOptions } from "@/modules/documents";
import { listReturns, listTaxTypes, todayInItaly, type ReturnItem } from "@/modules/taxes";
import { InlineForm } from "@/components/inline-form";
import type { FieldSpec } from "@/components/simple-form";
import { formatDate } from "@/lib/format";
import { createReturnAction, updateReturnAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("taxes.returns");
  return { title: t("title") };
}

const initialOf = (r: ReturnItem) => ({
  title: r.title,
  taxTypeId: r.taxTypeId ?? "",
  assetId: r.assetId ?? "",
  year: String(r.year),
  dueOn: r.dueOn ?? "",
  filedOn: r.filedOn ?? "",
  protocol: r.protocol ?? "",
  documentId: r.documentId ?? "",
  askAdviser: r.askAdviser,
  note: r.note ?? "",
  createDeadline: false,
});

export default async function ReturnsPage() {
  await requireOwner();
  const t = await getTranslations("taxes.returns");
  const db = getDb();
  const [returns, assets, types, documents] = await Promise.all([listReturns(db), listAssets(db), listTaxTypes(db), listDocumentOptions(db)]);

  const base: FieldSpec[] = [
    { kind: "text", name: "title", label: t("title_"), maxLength: 160 },
    { kind: "select", name: "taxTypeId", label: t("type"), options: types.map((x) => ({ value: x.id, label: x.name })), emptyLabel: t("noneOption") },
    { kind: "select", name: "assetId", label: t("asset"), options: assets.map((a) => ({ value: a.id, label: a.name })), emptyLabel: t("noneOption") },
    { kind: "text", name: "year", label: t("year"), inputMode: "numeric", maxLength: 4 },
    { kind: "date", name: "dueOn", label: t("dueOn") },
    { kind: "date", name: "filedOn", label: t("filedOn") },
    { kind: "text", name: "protocol", label: t("protocol"), maxLength: 80 },
    { kind: "select", name: "documentId", label: t("proof"), options: documents, emptyLabel: t("noneOption") },
    { kind: "text", name: "note", label: t("note"), maxLength: 1000 },
    { kind: "checkbox", name: "askAdviser", label: t("askAdviser") },
  ];
  const addFields: FieldSpec[] = [...base, { kind: "checkbox", name: "createDeadline", label: t("createDeadline") }];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <Link href="/tributi" className={buttonVariants({ variant: "ghost", size: "sm" }) + " w-fit print:hidden"}>
        <ArrowLeft aria-hidden /> {t("back")}
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">{t("intro")}</p>

      {returns.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
      <ul className="flex flex-col gap-4" data-testid="returns">
        {returns.map((r) => (
          <li key={r.id}>
            <Card>
              <CardContent className="flex flex-col gap-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {r.title} {r.year}
                  </span>
                  <Badge variant={r.state === "filed" ? "secondary" : r.state === "overdue" ? "destructive" : "outline"}>{t(`state.${r.state}`)}</Badge>
                </div>
                <p className="text-muted-foreground">
                  {[r.assetName, r.typeName, r.dueOn ? t("dueLine", { date: formatDate(r.dueOn) }) : null, r.filedOn ? t("filedLine", { date: formatDate(r.filedOn) }) : null, r.protocol ? t("protocolLine", { protocol: r.protocol }) : null].filter(Boolean).join(" · ")}
                </p>
                {r.documentId && r.documentTitle ? (
                  <Link href={`/documenti/${r.documentId}`} className="underline underline-offset-2">
                    {r.documentTitle}
                  </Link>
                ) : null}
                {r.note ? <p className="whitespace-pre-wrap">{r.note}</p> : null}
                <details className="print:hidden">
                  <summary className="cursor-pointer text-muted-foreground">
                    {t("update")}
                    <span className="sr-only">: {r.title}</span>
                  </summary>
                  <InlineForm key={JSON.stringify(initialOf(r))} idPrefix={`return-${r.id}`} title={t("update")} fields={base} initial={initialOf(r)} submitLabel={t("update")} onSubmit={updateReturnAction.bind(null, r.id)} />
                </details>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      <InlineForm
        idPrefix="return-new"
        title={t("addHeading")}
        fields={addFields}
        initial={{ title: "", taxTypeId: "", assetId: "", year: todayInItaly().slice(0, 4), dueOn: "", filedOn: "", protocol: "", documentId: "", askAdviser: false, note: "", createDeadline: false }}
        submitLabel={t("add")}
        onSubmit={createReturnAction}
      />
    </div>
  );
}
