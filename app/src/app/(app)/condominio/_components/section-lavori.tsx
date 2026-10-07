import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/platform/db/client";
import { listDocumentOptions } from "@/modules/documents";
import { WORK_ENTRY_KINDS, WORK_STATUSES, type CondominiumDetail } from "@/modules/condominium";
import { InlineForm } from "@/components/inline-form";
import { formatDate, formatEuro } from "@/lib/format";
import { addWorkEntryAction, createWorkAction, updateWorkStatusAction } from "../actions";

export async function LavoriSection({ condo }: { condo: CondominiumDetail }) {
  const t = await getTranslations("condominium.works");
  const documents = await listDocumentOptions(getDb());
  const statusOptions = WORK_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) }));

  return (
    <div className="flex flex-col gap-6">
      {condo.works.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
      {condo.works.map((w) => (
        <Card key={w.id} data-testid="work">
          <CardHeader>
            <CardTitle>
              <h2>{w.title}</h2>
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={w.status === "completed" ? "outline" : "secondary"}>{t(`status.${w.status as (typeof WORK_STATUSES)[number]}`)}</Badge>
              {w.budgetCents !== null ? <span>{t("budgetLine", { amount: formatEuro(w.budgetCents) })}</span> : null}
              {w.invoicedCents > 0 ? <span>{t("invoiced", { amount: formatEuro(w.invoicedCents) })}</span> : null}
            </div>
            {w.note ? <p className="text-sm text-muted-foreground">{w.note}</p> : null}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <h3 className="text-sm font-medium">{t("entries")}</h3>
            {w.entries.length === 0 ? <p className="text-sm text-muted-foreground">{t("noEntries")}</p> : null}
            <ul className="flex flex-col divide-y text-sm">
              {w.entries.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2 py-2">
                  <Badge variant="outline">{t(`entryKind.${e.kind}`)}</Badge>
                  <span className="font-medium">{e.title}</span>
                  {e.amountCents !== null ? <span>{formatEuro(e.amountCents)} €</span> : null}
                  {e.entryOn ? <span className="text-muted-foreground">{formatDate(e.entryOn)}</span> : null}
                  {e.documentId && e.documentTitle ? (
                    <Link href={`/documenti/${e.documentId}`} className="underline underline-offset-2">
                      {e.documentTitle}
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
            <InlineForm
              key={`${w.id}-${w.status}`}
              idPrefix={`work-status-${w.id}`}
              title={t("updateStatus")}
              fields={[{ kind: "select", name: "status", label: t("statusLabel"), options: statusOptions }]}
              initial={{ status: w.status }}
              submitLabel={t("updateStatus")}
              onSubmit={updateWorkStatusAction.bind(null, condo.id, w.id, { title: w.title, budget: w.budgetCents !== null ? formatEuro(w.budgetCents) : "", note: w.note ?? "", resolutionId: w.resolutionId ?? "" })}
            />
            <InlineForm
              idPrefix={`work-entry-${w.id}`}
              title={t("entryAdd")}
              fields={[
                { kind: "select", name: "kind", label: t("entryKindLabel"), options: WORK_ENTRY_KINDS.map((k) => ({ value: k, label: t(`entryKind.${k}`) })) },
                { kind: "text", name: "title", label: t("entryTitle"), maxLength: 200 },
                { kind: "text", name: "amount", label: t("entryAmount"), inputMode: "decimal", maxLength: 14 },
                { kind: "date", name: "entryOn", label: t("entryDate") },
                { kind: "select", name: "documentId", label: t("entryDocument"), options: documents, emptyLabel: "—" },
              ]}
              initial={{ kind: "quote", title: "", amount: "", entryOn: "", documentId: "" }}
              submitLabel={t("entryAdd")}
              onSubmit={addWorkEntryAction.bind(null, condo.id, w.id)}
            />
          </CardContent>
        </Card>
      ))}

      <InlineForm
        idPrefix="work"
        title={t("addHeading")}
        fields={[
          { kind: "text", name: "title", label: t("title"), maxLength: 200 },
          { kind: "select", name: "status", label: t("statusLabel"), options: statusOptions },
          { kind: "text", name: "budget", label: t("budget"), inputMode: "decimal", maxLength: 14 },
          { kind: "text", name: "note", label: t("note"), maxLength: 1000 },
        ]}
        initial={{ title: "", status: "planned", budget: "", note: "" }}
        submitLabel={t("add")}
        onSubmit={createWorkAction.bind(null, condo.id)}
      />
    </div>
  );
}
