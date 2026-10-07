import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getDb } from "@/platform/db/client";
import { listAssets } from "@/modules/assets";
import { listParties } from "@/modules/directory";
import { listDocumentOptions } from "@/modules/documents";
import { listWarranties, listWorks } from "@/modules/maintenance";
import { ActionButton } from "@/components/action-button";
import { InlineForm } from "@/components/inline-form";
import { formatDate } from "@/lib/format";
import { archiveWarrantyAction, createWarrantyAction } from "../actions";

export async function SectionWarranties() {
  const t = await getTranslations("maintenance.warranties");
  const db = getDb();
  const [warranties, assets, parties, documents, works] = await Promise.all([listWarranties(db), listAssets(db), listParties(db), listDocumentOptions(db), listWorks(db, { includeClosed: true })]);

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
      {warranties.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
      <ul className="flex flex-col gap-4" data-testid="warranty-list">
        {warranties.map((w) => (
          <li key={w.id}>
            <Card>
              <CardContent className="flex flex-col gap-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{w.title}</span>
                  <Badge variant={w.state === "expired" ? "outline" : w.state === "expiring" ? "destructive" : "secondary"}>{t(`state.${w.state}`)}</Badge>
                  <ActionButton action={archiveWarrantyAction.bind(null, w.id, true)} srLabel={w.title}>
                    {t("archive")}
                  </ActionButton>
                </div>
                <p className="text-muted-foreground">
                  {[w.assetName, w.supplierName, w.startsOn ? t("from", { date: formatDate(w.startsOn) }) : null, t("until", { date: formatDate(w.endsOn) }), w.workTitle ? t("forWork", { title: w.workTitle }) : null].filter(Boolean).join(" · ")}
                </p>
                {w.documentId && w.documentTitle ? (
                  <Link href={`/documenti/${w.documentId}`} className="underline underline-offset-2">
                    {w.documentTitle}
                  </Link>
                ) : null}
                {w.note ? <p className="whitespace-pre-wrap">{w.note}</p> : null}
                {w.deadlineId ? (
                  <Link href={`/scadenze/${w.deadlineId}`} className="underline underline-offset-2">
                    {t("openDeadline")}
                  </Link>
                ) : null}
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      <InlineForm
        idPrefix="warranty"
        title={t("addHeading")}
        fields={[
          { kind: "select", name: "assetId", label: t("asset"), options: assets.map((a) => ({ value: a.id, label: a.name })), emptyLabel: t("chooseAsset") },
          { kind: "text", name: "title", label: t("title"), maxLength: 200 },
          { kind: "date", name: "startsOn", label: t("startsOn") },
          { kind: "date", name: "endsOn", label: t("endsOn") },
          { kind: "select", name: "supplierPartyId", label: t("supplier"), options: parties.map((p) => ({ value: p.id, label: p.displayName })), emptyLabel: "—" },
          { kind: "select", name: "workId", label: t("work"), options: works.map((w) => ({ value: w.id, label: `${w.title} (${w.assetName})` })), emptyLabel: "—" },
          { kind: "select", name: "documentId", label: t("document"), options: documents, emptyLabel: "—" },
          { kind: "text", name: "note", label: t("note"), maxLength: 500 },
          { kind: "checkbox", name: "createDeadline", label: t("createDeadline") },
        ]}
        initial={{ assetId: "", title: "", startsOn: "", endsOn: "", supplierPartyId: "", workId: "", documentId: "", note: "", createDeadline: false }}
        submitLabel={t("add")}
        onSubmit={createWarrantyAction}
      />
    </div>
  );
}
