import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/platform/db/client";
import { listDocumentOptions } from "@/modules/documents";
import { DOCUMENT_KINDS, type CondominiumDetail } from "@/modules/condominium";
import { ActionButton } from "@/components/action-button";
import { InlineForm } from "@/components/inline-form";
import { linkDocumentAction, unlinkDocumentAction } from "../actions";

export async function DocumentiSection({ condo }: { condo: CondominiumDetail }) {
  const t = await getTranslations("condominium.documents");
  const linked = new Set(condo.documents.map((d) => d.documentId));
  const available = (await listDocumentOptions(getDb())).filter((d) => !linked.has(d.value));

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("heading")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {condo.documents.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
          <ul className="flex flex-col gap-1 text-sm" data-testid="condo-documents">
            {condo.documents.map((d) => (
              <li key={d.documentId} className="flex flex-wrap items-center gap-2">
                <Link href={`/documenti/${d.documentId}`} className="underline underline-offset-2">
                  {d.title}
                </Link>
                <span className="text-muted-foreground">({t(`kind.${d.kind as (typeof DOCUMENT_KINDS)[number]}`)})</span>
                <ActionButton action={unlinkDocumentAction.bind(null, condo.id, d.documentId)} srLabel={d.title}>
                  {t("unlink")}
                </ActionButton>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <InlineForm
        idPrefix="condo-doc"
        title={t("link")}
        fields={[
          { kind: "select", name: "documentId", label: t("link"), options: available, emptyLabel: t("choose") },
          { kind: "select", name: "kind", label: t("kindLabel"), options: DOCUMENT_KINDS.map((k) => ({ value: k, label: t(`kind.${k}`) })) },
        ]}
        initial={{ documentId: "", kind: "regulation" }}
        submitLabel={t("linkButton")}
        onSubmit={linkDocumentAction.bind(null, condo.id)}
      />
    </div>
  );
}
