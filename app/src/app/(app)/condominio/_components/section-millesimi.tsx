import { getTranslations } from "next-intl/server";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMilli, type CondominiumDetail } from "@/modules/condominium";
import { InlineForm } from "@/components/inline-form";
import { createTableAction, saveOthersAction, saveSharesAction } from "../actions";

export async function MillesimiSection({ condo }: { condo: CondominiumDetail }) {
  const t = await getTranslations("condominium.tables");

  return (
    <div className="flex flex-col gap-6">
      {condo.tables.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
      {condo.tables.map((table) => {
        const byAsset = new Map(table.shares.map((s) => [s.assetId, s.milli]));
        const initial = Object.fromEntries(condo.members.map((m) => [`milli_${m.assetId}`, byAsset.has(m.assetId) ? formatMilli(byAsset.get(m.assetId)!) : ""]));
        return (
          <Card key={table.id} data-testid="millesimal-table">
            <CardHeader>
              <CardTitle>
                <h2>{table.name}</h2>
              </CardTitle>
              {table.note ? <p className="text-sm text-muted-foreground">{table.note}</p> : null}
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p className="text-sm font-medium">{t("total", { total: formatMilli(table.total) })}</p>
              {table.differsFromThousand && table.shares.length > 0 ? (
                <Alert>
                  <AlertDescription>{t("totalWarning")}</AlertDescription>
                </Alert>
              ) : null}
              {condo.members.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("needMembers")}</p>
              ) : (
                <InlineForm
                  key={JSON.stringify(initial)}
                  idPrefix={`shares-${table.id}`}
                  title={t("save")}
                  fields={condo.members.map((m) => ({ kind: "text" as const, name: `milli_${m.assetId}`, label: m.unitLabel ? `${m.assetName} (${m.unitLabel})` : m.assetName, inputMode: "decimal" as const, maxLength: 12 }))}
                  initial={initial}
                  submitLabel={t("save")}
                  onSubmit={saveSharesAction.bind(null, condo.id, table.id)}
                />
              )}
              <p className="text-sm text-muted-foreground">{t("valuesHint")}</p>
              <p className="text-sm text-muted-foreground">{t("othersIntro")}</p>
              {table.others.length > 0 ? <p className="text-sm font-medium" data-testid="others-total">{t("othersTotal", { total: formatMilli(table.othersTotal) })}</p> : null}
              <InlineForm
                key={JSON.stringify(table.others)}
                idPrefix={`others-${table.id}`}
                title={t("othersHeading")}
                fields={Array.from({ length: table.others.length + 2 }, (_, i) => [
                  { kind: "text" as const, name: `otherLabel_${i}`, label: t("othersLabel", { n: i + 1 }), maxLength: 120 },
                  { kind: "text" as const, name: `otherValue_${i}`, label: t("othersValue", { n: i + 1 }), inputMode: "decimal" as const, maxLength: 12 },
                ]).flat()}
                initial={Object.fromEntries(Array.from({ length: table.others.length + 2 }, (_, i) => [[`otherLabel_${i}`, table.others[i]?.label ?? ""], [`otherValue_${i}`, table.others[i] ? formatMilli(table.others[i]!.milli) : ""]]).flat())}
                submitLabel={t("othersSave")}
                onSubmit={saveOthersAction.bind(null, condo.id, table.id)}
              />
            </CardContent>
          </Card>
        );
      })}

      <InlineForm
        idPrefix="table"
        title={t("addHeading")}
        fields={[
          { kind: "text", name: "name", label: t("name"), maxLength: 120 },
          { kind: "text", name: "note", label: t("note"), maxLength: 500 },
        ]}
        initial={{ name: "", note: "" }}
        submitLabel={t("add")}
        onSubmit={createTableAction.bind(null, condo.id)}
      />
    </div>
  );
}
